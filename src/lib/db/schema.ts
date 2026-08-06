import { pgTable, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

// Better Auth core tables (standard shape expected by the Drizzle adapter),
// extended with the profile fields from COMMENTS.md §4.
// All timestamps use `withTimezone: true` (timestamptz) — plain `timestamp`
// round-trips through the neon-http driver using the server process's local
// offset instead of UTC, which silently shifted expires_at by an hour.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  firstName: text('first_name'),
  lastName: text('last_name'),
  avatarUrl: text('avatar_url'),
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

// Flat, text-anchored comments (COMMENTS.md §4). No parent_id — v1 is flat.
export const comment = pgTable('comment', {
  id: text('id').primaryKey(),
  postSlug: text('post_slug').notNull(),
  lang: text('lang').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  blockIndex: integer('block_index').notNull(),
  anchorExact: text('anchor_exact').notNull(),
  anchorPrefix: text('anchor_prefix'),
  anchorSuffix: text('anchor_suffix'),
  anchorOffsetHint: integer('anchor_offset_hint'),
  body: text('body').notNull(),
  status: text('status').notNull().default('visible'), // 'visible' | 'hidden' | 'pending'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
