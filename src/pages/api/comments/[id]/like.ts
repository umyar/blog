import type { APIRoute } from 'astro';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { comment, commentLike } from '../../../../lib/db/schema';
import { consume, rateLimitedResponse } from '../../../../lib/rate-limit';

export const prerender = false;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Toggle this reader's like on a comment (COMMENTS_V2.md §8.2).
 *
 * Returns `{ liked, count }` — the client renders optimistically and reconciles
 * against these, so the response has to carry the authoritative count rather
 * than just an acknowledgement.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: 'unauthenticated' }, 401);
  if (!session.user.profileComplete) return json({ error: 'profile_incomplete' }, 403);

  const commentId = params.id;
  if (!commentId) return json({ error: 'invalid_input' }, 400);

  // A toggle is trivially spammable and every press is a write, so it goes
  // through the shared limiter like every other mutating route (§8.2). Looser
  // than the comment limit — liking a page's worth of comments is normal.
  const limit = await consume(`like:user:${session.user.id}`, { window: 60, max: 30 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfter);

  // A hidden or pending comment answers exactly like one that doesn't exist, so
  // the endpoint can't be used to confirm that a moderated comment is still there.
  const [target] = await db
    .select({ id: comment.id })
    .from(comment)
    .where(and(eq(comment.id, commentId), eq(comment.status, 'visible')));
  if (!target) return json({ error: 'not_found' }, 404);

  const [existing] = await db
    .select({ id: commentLike.id })
    .from(commentLike)
    .where(and(eq(commentLike.commentId, commentId), eq(commentLike.userId, session.user.id)));

  let liked: boolean;
  if (existing) {
    await db.delete(commentLike).where(eq(commentLike.id, existing.id));
    liked = false;
  } else {
    // `onConflictDoNothing` rather than a bare insert: two concurrent presses
    // both miss the select above, and it is the unique index — not this
    // read-then-write — that keeps the second one from landing a second row.
    await db
      .insert(commentLike)
      .values({ id: crypto.randomUUID(), commentId, userId: session.user.id })
      .onConflictDoNothing();
    liked = true;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commentLike)
    .where(eq(commentLike.commentId, commentId));

  return json({ liked, count }, 200);
};
