import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { db } from './db';
import * as schema from './db/schema';
import { sendMagicLinkEmail } from './email';

export const auth = betterAuth({
  baseURL: import.meta.env.DEV ? 'http://localhost:4321' : import.meta.env.BETTER_AUTH_URL,
  secret: import.meta.env.BETTER_AUTH_SECRET,
  trustedOrigins: import.meta.env.DEV
    ? ['http://localhost:4321', 'http://127.0.0.1:4321']
    : undefined,
  database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: false }),
  emailAndPassword: { enabled: false },
  user: {
    additionalFields: {
      firstName: { type: 'string', required: false },
      lastName: { type: 'string', required: false },
      avatarUrl: { type: 'string', required: false },
      profileComplete: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
  ],
});
