import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Better Auth core tables (standard shape expected by the Drizzle adapter),
// extended with the profile fields from COMMENTS.md §4.
// All timestamps use `withTimezone: true` (timestamptz) — plain `timestamp`
// round-trips through the neon-http driver using the server process's local
// offset instead of UTC, which silently shifted expires_at by an hour.
// Six app columns, none dead (COMMENTS_V2.md §4.1). There is deliberately no
// `name` or `image` column: Better Auth's core fields by those names are pointed
// at `first_name` and `avatar_url` via `user.fields` in lib/auth.ts, so the
// columns that already did the job are the ones it writes to.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // The reader's permanent public identity, rendered as `u16`. Postgres issues it
  // — nobody picks it and nobody can change it, so the sequence itself is the
  // uniqueness guarantee and there is no availability check, no format rule and
  // no race to lose. Gaps (from a rolled-back signup) are fine: it's an
  // identifier, not a tally. GENERATED ALWAYS is what makes it un-writable; it
  // stays out of every INSERT because `input: false` keeps it undefined and
  // Better Auth omits undefined fields that have no default.
  userNumber: integer('user_number').generatedAlwaysAsIdentity(),

  // Better Auth's required core `name` field lives here. It writes "" at signup —
  // hence notNull().default('') rather than a genuinely required column, since
  // the row is created long before the profile step exists.
  firstName: text('first_name').notNull().default(''),
  // Nullable for the same reason. "Required" means *required to finish your
  // profile*, and POST /api/profile is the single place that enforces it.
  lastName: text('last_name'),
  // Better Auth's optional core `image` field lives here.
  avatarUrl: text('avatar_url'),
  // 'upload' | 'url' | null — lets a replacement del() the old blob instead of
  // orphaning it.
  avatarSource: text('avatar_source'),
  // Gates commenting. Flips only when both names are set; the avatar never
  // affects it.
  profileComplete: boolean('profile_complete').notNull().default(false),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Rate-limit counters, one row per bucket (COMMENTS_V2.md §5.1). The shape is
// dictated by Better Auth (@better-auth/core/dist/db/get-tables.mjs — `key`
// unique, `count`, `lastRequest` as a bigint), because it owns this table
// whenever `rateLimit.storage: 'database'` is set in lib/auth.ts.
//
// It has to be a real table rather than the default `memory` store: on Vercel
// each request can land in a fresh serverless invocation, so an in-process Map
// is per-invocation and the limit is effectively unlimited. That was the actual
// hole under feedback #2 — the auth mailer had no working limiter at all.
//
// `lastRequest` is epoch **milliseconds**, not a timestamp: Better Auth compares
// it numerically against Date.now(). mode:'number' keeps it a JS number on the
// way back out (Postgres returns bigint as a string otherwise).
//
// lib/rate-limit.ts shares this table for the app's own buckets, under keys
// prefixed `app:`. Better Auth's own keys are `${ip}|${path}` (core/utils/ip.mjs
// `createRateLimitKey`), so the two namespaces cannot collide.
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

// Flat comments (COMMENTS.md §4). No parent_id — still flat in v2.
//
// Two kinds share this one table: anchored to a passage, and plain
// whole-post (COMMENTS_V2.md §6.1). `anchor_exact IS NULL` *is* the plain kind —
// there is deliberately no type column, because a discriminator alongside the
// anchor fields would be a second source of truth that can disagree with them.
export const comment = pgTable('comment', {
  id: text('id').primaryKey(),
  postSlug: text('post_slug').notNull(),
  lang: text('lang').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  // Nullable as of phase 4: null on both means a plain comment. The API rejects
  // a half-filled anchor, so these are either all set or all null.
  blockIndex: integer('block_index'),
  anchorExact: text('anchor_exact'),
  anchorPrefix: text('anchor_prefix'),
  anchorSuffix: text('anchor_suffix'),
  anchorOffsetHint: integer('anchor_offset_hint'),
  body: text('body').notNull(),
  status: text('status').notNull().default('visible'), // 'visible' | 'hidden' | 'pending'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One like per reader per comment (COMMENTS_V2.md §8.1).
//
// As with `subscriber_email_idx` and `broadcast_post_slug_idx`, the unique index
// is the actual guard: a double-click, or two requests racing in separate
// serverless invocations, cannot produce two rows. The existence check in the
// route is only there to decide whether this press means like or unlike, and to
// answer with something friendlier than a constraint violation.
//
// Cascade on both foreign keys, so deleting a comment (or a whole account) takes
// its likes with it and leaves no orphan rows to filter out later.
export const commentLike = pgTable(
  'comment_like',
  {
    id: text('id').primaryKey(),
    commentId: text('comment_id')
      .notNull()
      .references(() => comment.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('comment_like_comment_user_idx').on(table.commentId, table.userId)]
);

// New-post email list. Deliberately independent of `user` — subscribing must not
// require an account, and signing in must not silently subscribe anyone.
// Double opt-in: a row lands as 'pending' and only becomes 'confirmed' once the
// emailed link is opened, so nobody can sign up an address they don't own.
export const subscriber = pgTable(
  'subscriber',
  {
    id: text('id').primaryKey(),
    // Stored lowercased/trimmed; the unique index below is what actually enforces
    // one row per address.
    email: text('email').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' | 'confirmed' | 'unsubscribed'

    // Single-use, expires. Cleared on confirm so a leaked link stops working.
    confirmToken: text('confirm_token'),
    confirmExpiresAt: timestamp('confirm_expires_at', { withTimezone: true }),
    // Throttles "resend the confirmation" for an address that's already pending.
    confirmSentAt: timestamp('confirm_sent_at', { withTimezone: true }),

    // Permanent and per-subscriber: it goes in every broadcast, so it must stay
    // valid indefinitely and must never be guessable from the email address.
    unsubscribeToken: text('unsubscribe_token').notNull(),

    // Consent evidence (GDPR art. 7(1) — the sender carries the burden of proof)
    // and the signal the signup rate limit is computed from.
    signupIp: text('signup_ip'),

    // Where the consent was given (COMMENTS_V2.md §9.3) — 'footer' | 'signin' |
    // 'welcome'. Part of the same evidence trail as signupIp/createdAt: for a row
    // that never received a confirmation email because the address was proven by
    // an OTP instead, this is what records why that was legitimate.
    source: text('source'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('subscriber_email_idx').on(table.email),
    uniqueIndex('subscriber_unsubscribe_token_idx').on(table.unsubscribeToken),
  ]
);

// One row per post that has been announced. The unique index on post_slug is the
// actual guard against a double-click mailing the whole list twice — the check in
// the API route is just there to return a friendlier error.
export const broadcast = pgTable(
  'broadcast',
  {
    id: text('id').primaryKey(),
    postSlug: text('post_slug').notNull(),
    lang: text('lang').notNull(), // language the announcement linked to
    recipientCount: integer('recipient_count').notNull(),
    failedCount: integer('failed_count').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('broadcast_post_slug_idx').on(table.postSlug)]
);
