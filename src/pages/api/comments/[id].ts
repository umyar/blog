import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { auth } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { comment } from '../../../lib/db/schema';
import { isAdmin } from '../../../lib/admin';

export const prerender = false;

// Author or admin (§7) — resolved in favor of self-service delete over §11's
// stricter "only admin hide/delete" wording; confirmed with the user.
export const DELETE: APIRoute = async ({ params, request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 });
  }

  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: 'invalid_id' }), { status: 400 });
  }

  const [existing] = await db
    .select({ userId: comment.userId })
    .from(comment)
    .where(eq(comment.id, id));
  if (!existing) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  const isOwner = existing.userId === session.user.id;
  if (!isOwner && !isAdmin(session.user.id)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  await db.delete(comment).where(eq(comment.id, id));
  return new Response(null, { status: 204 });
};

// Admin-only. Hide/unhide (§9 task 2) — a soft alternative to DELETE that GET
// /api/comments already respects, since it only ever selects status = 'visible'.
export const PATCH: APIRoute = async ({ params, request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 });
  }

  const id = params.id;
  if (!id) {
    return new Response(JSON.stringify({ error: 'invalid_id' }), { status: 400 });
  }

  if (!isAdmin(session.user.id)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (status !== 'visible' && status !== 'hidden') {
    return new Response(JSON.stringify({ error: 'invalid_status' }), { status: 400 });
  }

  await db.update(comment).set({ status }).where(eq(comment.id, id));
  return new Response(null, { status: 204 });
};
