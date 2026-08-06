import type { APIRoute } from 'astro';
import { and, asc, eq, gte } from 'drizzle-orm';
import { auth } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { comment, user } from '../../../lib/db/schema';
import { LANGS } from '../../../lib/posts';

export const prerender = false;

const MAX_BODY_LEN = 2000;
const MAX_ANCHOR_LEN = 500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const slug = url.searchParams.get('slug');
  const lang = url.searchParams.get('lang');
  if (!slug || !lang || !(LANGS as string[]).includes(lang)) {
    return json({ error: 'invalid_query' }, 400);
  }

  const rows = await db
    .select({
      id: comment.id,
      blockIndex: comment.blockIndex,
      anchorExact: comment.anchorExact,
      anchorPrefix: comment.anchorPrefix,
      anchorSuffix: comment.anchorSuffix,
      anchorOffsetHint: comment.anchorOffsetHint,
      body: comment.body,
      createdAt: comment.createdAt,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
    })
    .from(comment)
    .innerJoin(user, eq(comment.userId, user.id))
    .where(and(eq(comment.postSlug, slug), eq(comment.lang, lang), eq(comment.status, 'visible')))
    .orderBy(asc(comment.createdAt));

  return json(
    rows.map((r) => ({
      id: r.id,
      blockIndex: r.blockIndex,
      anchorExact: r.anchorExact,
      anchorPrefix: r.anchorPrefix,
      anchorSuffix: r.anchorSuffix,
      anchorOffsetHint: r.anchorOffsetHint,
      body: r.body,
      createdAt: r.createdAt,
      author: { firstName: r.firstName, lastName: r.lastName, avatarUrl: r.avatarUrl },
    })),
    200
  );
};

export const POST: APIRoute = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: 'unauthenticated' }, 401);
  if (!session.user.profileComplete) return json({ error: 'profile_incomplete' }, 403);

  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  const lang = typeof body?.lang === 'string' ? body.lang.trim() : '';
  const blockIndex = Number.isInteger(body?.blockIndex) ? body.blockIndex : null;
  const anchorExact = typeof body?.anchorExact === 'string' ? body.anchorExact.trim() : '';
  const anchorPrefix =
    typeof body?.anchorPrefix === 'string' ? body.anchorPrefix.slice(0, MAX_ANCHOR_LEN) : null;
  const anchorSuffix =
    typeof body?.anchorSuffix === 'string' ? body.anchorSuffix.slice(0, MAX_ANCHOR_LEN) : null;
  const anchorOffsetHint = Number.isInteger(body?.anchorOffsetHint) ? body.anchorOffsetHint : null;
  const text = typeof body?.body === 'string' ? body.body.trim() : '';

  if (
    !slug ||
    !(LANGS as string[]).includes(lang) ||
    blockIndex === null ||
    blockIndex < 0 ||
    !anchorExact ||
    anchorExact.length > MAX_ANCHOR_LEN ||
    !text ||
    text.length > MAX_BODY_LEN
  ) {
    return json({ error: 'invalid_input' }, 400);
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await db
    .select({ id: comment.id })
    .from(comment)
    .where(and(eq(comment.userId, session.user.id), gte(comment.createdAt, since)));
  if (recent.length >= RATE_LIMIT_MAX) {
    return json({ error: 'rate_limited' }, 429);
  }

  const [row] = await db
    .insert(comment)
    .values({
      id: crypto.randomUUID(),
      postSlug: slug,
      lang,
      userId: session.user.id,
      blockIndex,
      anchorExact,
      anchorPrefix,
      anchorSuffix,
      anchorOffsetHint,
      body: text,
    })
    .returning();

  return json({ id: row.id }, 201);
};
