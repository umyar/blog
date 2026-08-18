import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { db } from './db';
import * as schema from './db/schema';
import { sendMagicLinkEmail, sendOtpEmail } from './email';
import { consume, hashEmail } from './rate-limit';
import { isBotHeaders } from './honeypot';

export const auth = betterAuth({
  baseURL: import.meta.env.DEV ? 'http://localhost:4321' : import.meta.env.BETTER_AUTH_URL,
  secret: import.meta.env.BETTER_AUTH_SECRET,
  trustedOrigins: import.meta.env.DEV
    ? ['http://localhost:4321', 'http://127.0.0.1:4321']
    : undefined,
  database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: false }),
  emailAndPassword: { enabled: false },
  user: {
    // Better Auth's own `name` and `image` fields are remapped onto the columns
    // that already held this data, so the table has no dead columns
    // (COMMENTS_V2.md §4.1). These strings are resolved field *names*, and the
    // Drizzle adapter indexes the table object by JS property — so they must
    // match schema.ts's property names, not its SQL column names.
    //
    // The cost, stated plainly: in app code the first name is `session.user.name`
    // and the avatar is `session.user.image`. The columns are still honestly
    // called `first_name` and `avatar_url`.
    fields: {
      name: 'firstName',
      image: 'avatarUrl',
    },
    additionalFields: {
      // No defaultValue on purpose — that is what keeps it out of the INSERT so
      // the GENERATED ALWAYS identity can assign it. `input: false` stops any API
      // payload from trying to set it.
      userNumber: { type: 'number', required: false, input: false },
      lastName: { type: 'string', required: false },
      avatarSource: { type: 'string', required: false },
      profileComplete: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },

  // The fix for the live hole under feedback #2 (COMMENTS_V2.md §5.1). The
  // default storage is `memory`, which on Vercel is per-invocation — so in
  // production the magic-link and OTP endpoints were effectively unlimited.
  // `database` puts the counters in Neon, where every invocation sees them.
  //
  // `enabled: true` rather than the default (production-only) so the limits are
  // exercised in dev too; a limiter first tried in production is a limiter that
  // has never been tested.
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 30,
    // Checked after the plugin's own rules and therefore winning over them
    // (api/rate-limiter/index.mjs — customRules are resolved last). Keyed by IP.
    customRules: {
      '/email-otp/send-verification-otp': { window: 3600, max: 5 },
      '/sign-in/email-otp': { window: 300, max: 10 },
      '/sign-in/magic-link': { window: 3600, max: 5 },
    },
  },

  hooks: {
    // Honeypot and submit timing for the sign-in dialog, the counterpart of the
    // same two checks on the subscribe form (COMMENTS_V2.md §5.4). AuthDialog
    // sends both as headers because the plugin's body schema is fixed and would
    // strip an extra field; see lib/honeypot.ts for what counts as evidence.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/email-otp/send-verification-otp') return;

      const headers = ctx.headers ?? ctx.request?.headers;
      if (headers && isBotHeaders(headers)) {
        throw new APIError('BAD_REQUEST', { message: 'Invalid submission.' });
      }
    }),
  },

  plugins: [
    // Primary sign-in path: a 6-digit code the reader types without ever leaving
    // the page (COMMENTS_V2.md §3). `type: 'sign-in'` both signs in an existing
    // reader and creates the row for a new one, so there is a single flow.
    //
    // That single flow is also what makes the endpoint enumeration-safe for free
    // (§5.5): `shouldSendOTP` in the plugin's route is
    // `type === 'sign-in' && !disableSignUp`, so with sign-up left enabled the
    // known-address and unknown-address branches both end in `{ success: true }`
    // — there is no response difference to measure. Setting `disableSignUp`
    // here would silently reintroduce one.
    emailOTP({
      otpLength: 6,
      expiresIn: 600, // 10 minutes
      allowedAttempts: 3,

      // Encrypted at rest with BETTER_AUTH_SECRET instead of the default plain
      // text, so the `verification` table stops being a list of live sign-in
      // codes. Reuse below still works — `retrieveOTP` can decrypt, and only the
      // `hashed` option would be one-way.
      storeOTP: 'encrypted',

      // Required by the per-address cooldown below, not a preference. The
      // default (`rotate`) mints a fresh code on every send, so suppressing a
      // send would leave the reader holding a code the server has replaced.
      // `reuse` resends the same one and extends its expiry, which makes
      // "quietly send nothing" a correct answer rather than a broken one.
      resendStrategy: 'reuse',

      sendVerificationOTP: async ({ email, otp }) => {
        // Better Auth's limiter is keyed by IP, so it protects *us* from one
        // host flooding the endpoint. It does nothing for a recipient targeted
        // from many hosts, which is the case this covers (COMMENTS_V2.md §5.3) —
        // mirroring `subscriber.confirmSentAt` on the newsletter side.
        //
        // Returning without sending, rather than throwing: the reader keeps the
        // code they already have (see `resendStrategy` above) and it still
        // works, and the caller learns nothing it could use to probe the list.
        const { allowed } = await consume(`otp-send:${await hashEmail(email)}`, {
          window: 60,
          max: 1,
        });
        if (!allowed) return;

        await sendOtpEmail(email, otp);
      },
    }),
    // Kept registered only so magic links already sitting in inboxes keep
    // working — nothing in the UI offers it any more.
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
  ],
});
