import type { APIRoute } from 'astro';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { auth } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { comment, commentLike, user } from '../../../lib/db/schema';
import { LANGS } from '../../../lib/posts';
import { clientIp, consume, rateLimitedResponse } from '../../../lib/rate-limit';

export const prerender = false;

const MAX_BODY_LEN = 2000;
const MAX_ANCHOR_LEN = 500;
// Past this the who-liked popover shows "+N more" instead of growing (§8.3).
const MAX_LIKERS = 12;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ url, request }) => {
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
      userId: comment.userId,
      userNumber: user.userNumber,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
    })
    .from(comment)
    .innerJoin(user, eq(comment.userId, user.id))
    .where(and(eq(comment.postSlug, slug), eq(comment.lang, lang), eq(comment.status, 'visible')))
    .orderBy(asc(comment.createdAt));

  // Like data travels inline rather than as a fetch per comment (§8.3): at this
  // blog's volume it is one extra query for the whole page — fetch every like on
  // the returned comments, merge in JS — so no lateral join and no N+1, and the
  // who-liked popover opens with zero round trips.
  const session = await auth.api.getSession({ headers: request.headers });
  const viewerId = session?.user.id ?? null;

  type Liker = {
    commentId: string;
    id: string;
    userNumber: number | null;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
  };
  const likesByComment = new Map<
    string,
    { count: number; likedByMe: boolean; likers: Liker[] }
  >();

  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const likerRows: Liker[] = await db
      .select({
        commentId: commentLike.commentId,
        id: user.id,
        userNumber: user.userNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
      })
      .from(commentLike)
      .innerJoin(user, eq(commentLike.userId, user.id))
      .where(inArray(commentLike.commentId, ids))
      .orderBy(asc(commentLike.createdAt));

    for (const like of likerRows) {
      let entry = likesByComment.get(like.commentId);
      if (!entry) {
        entry = { count: 0, likedByMe: false, likers: [] };
        likesByComment.set(like.commentId, entry);
      }
      entry.count += 1;
      if (like.id === viewerId) entry.likedByMe = true;
      if (entry.likers.length < MAX_LIKERS) entry.likers.push(like);
    }
  }

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
      likeCount: likesByComment.get(r.id)?.count ?? 0,
      likedByMe: likesByComment.get(r.id)?.likedByMe ?? false,
      // Each liker carries `id` as well as the fields §8.3 lists, because the
      // monogram fallback is seeded from the user id — without it a liker with no
      // photo would get different colours here than on their own comment.
      likers: (likesByComment.get(r.id)?.likers ?? []).map((l) => ({
        id: l.id,
        userNumber: l.userNumber,
        firstName: l.firstName,
        lastName: l.lastName,
        avatarUrl: l.avatarUrl,
      })),
      likerOverflow: Math.max(0, (likesByComment.get(r.id)?.count ?? 0) - MAX_LIKERS),
      author: {
        // The id is the monogram's seed, so a reader with no photo gets the same
        // colours everywhere rather than a per-surface guess.
        id: r.userId,
        userNumber: r.userNumber,
        firstName: r.firstName,
        lastName: r.lastName,
        avatarUrl: r.avatarUrl,
      },
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

  // Required of both comment kinds (COMMENTS_V2.md §6.2).
  if (!slug || !(LANGS as string[]).includes(lang) || !text || text.length > MAX_BODY_LEN) {
    return json({ error: 'invalid_input' }, 400);
  }

  // The anchor is the discriminator: present means anchored to a passage, absent
  // means a plain whole-post comment. Nothing else distinguishes them.
  const isAnchored = anchorExact !== '';

  if (isAnchored) {
    if (blockIndex === null || blockIndex < 0 || anchorExact.length > MAX_ANCHOR_LEN) {
      return json({ error: 'invalid_input' }, 400);
    }
  } else if (
    // Some anchor fields but no anchorExact is a bug in the caller, not a third
    // comment kind — storing it would produce a row that can never resolve and
    // would then read as an orphan (R3) forever.
    blockIndex !== null ||
    anchorPrefix !== null ||
    anchorSuffix !== null ||
    anchorOffsetHint !== null
  ) {
    return json({ error: 'invalid_input' }, 400);
  }

  // Was a count of this user's recent comment rows, which a moderator deleting a
  // spammer's comments would silently reset. Counters live outside the table now.
  const perUser = await consume(`comment:user:${session.user.id}`, { window: 60, max: 5 });
  if (!perUser.allowed) return rateLimitedResponse(perUser.retryAfter);

  // New in phase 3: the per-user limit alone was worth little, since signing up
  // costs one address and the limit resets per account. The per-IP bucket is
  // deliberately looser, because a household or office behind one NAT address is
  // a normal thing and shouldn't be punished for it.
  const ip = clientIp(request);
  if (ip) {
    const perIp = await consume(`comment:ip:${ip}`, { window: 60, max: 15 });
    if (!perIp.allowed) return rateLimitedResponse(perIp.retryAfter);
  }

  const [row] = await db
    .insert(comment)
    .values({
      id: crypto.randomUUID(),
      postSlug: slug,
      lang,
      userId: session.user.id,
      // All-or-nothing: a plain comment stores null across every anchor column,
      // so `anchor_exact IS NULL` is a reliable test for the kind.
      blockIndex: isAnchored ? blockIndex : null,
      anchorExact: isAnchored ? anchorExact : null,
      anchorPrefix: isAnchored ? anchorPrefix : null,
      anchorSuffix: isAnchored ? anchorSuffix : null,
      anchorOffsetHint: isAnchored ? anchorOffsetHint : null,
      body: text,
    })
    .returning();

  return json({ id: row.id }, 201);
};
