import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { del } from '@vercel/blob';
import { auth } from '../../lib/auth';
import { db } from '../../lib/db';
import { user } from '../../lib/db/schema';
import { isValidHttpUrl } from '../../lib/validate';
import { consume, rateLimitedResponse } from '../../lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 });
  }

  // Generous — this fires once at signup and then only when someone edits their
  // profile — but it stops a signed-in account rewriting its displayed name in a
  // loop, which shows up on every comment it has ever left.
  const { allowed, retryAfter } = await consume(`profile:user:${session.user.id}`, {
    window: 3600,
    max: 20,
  });
  if (!allowed) return rateLimitedResponse(retryAfter);

  const body = await request.json().catch(() => null);
  const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body?.lastName === 'string' ? body.lastName.trim() : '';
  const avatarUrl = typeof body?.avatarUrl === 'string' ? body.avatarUrl.trim() : '';

  // The only hard requirement, and the only place it is enforced: the DB columns
  // stay permissive because Better Auth creates the row at first sign-in, long
  // before this step exists (COMMENTS_V2.md §4.1).
  if (!firstName || firstName.length > 60 || !lastName || lastName.length > 60) {
    return new Response(JSON.stringify({ error: 'invalid_name' }), { status: 400 });
  }
  // Optional now. Validated only when actually supplied — a blank field means
  // "use the monogram", which is a legitimate answer rather than an error.
  if (avatarUrl && !isValidHttpUrl(avatarUrl)) {
    return new Response(JSON.stringify({ error: 'invalid_avatar_url' }), { status: 400 });
  }

  const [current] = await db
    .select({ avatarUrl: user.avatarUrl, avatarSource: user.avatarSource })
    .from(user)
    .where(eq(user.id, session.user.id));

  // An upload that came through /api/avatar has already written both columns.
  // Leave them alone unless this request actually carries a different value,
  // otherwise saving the name would silently wipe a just-uploaded photo.
  const avatarChanged = avatarUrl !== (current?.avatarUrl ?? '');

  await db
    .update(user)
    .set({
      firstName,
      lastName,
      profileComplete: true,
      ...(avatarChanged
        ? { avatarUrl: avatarUrl || null, avatarSource: avatarUrl ? 'url' : null }
        : {}),
    })
    .where(eq(user.id, session.user.id));

  // Replacing an uploaded avatar with a pasted URL (or with nothing) makes the
  // old blob unreachable — drop it rather than orphaning it.
  if (avatarChanged && current?.avatarSource === 'upload' && current.avatarUrl) {
    await del(current.avatarUrl).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
