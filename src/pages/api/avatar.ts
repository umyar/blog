import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { put, del } from '@vercel/blob';
import { auth } from '../../lib/auth';
import { db } from '../../lib/db';
import { user } from '../../lib/db/schema';
import { consume, rateLimitedResponse } from '../../lib/rate-limit';

export const prerender = false;

// The client re-encodes to a 256×256 WebP before uploading (see AvatarField in
// AuthDialog.astro), which lands around 20–40 KB. This ceiling exists to stop a
// hand-rolled request, not to accommodate real photos.
const MAX_BYTES = 512 * 1024;
const ACCEPTED = 'image/webp';

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: 'unauthenticated' }, 401);

  if (!import.meta.env.BLOB_READ_WRITE_TOKEN) {
    return json({ error: 'uploads_unconfigured' }, 503);
  }

  // Every accepted call writes a blob to Vercel storage, which the old
  // count-the-rows approach could not have limited at all — there is no row to
  // count. Ten replacements an hour is far past what changing your photo needs.
  const { allowed, retryAfter } = await consume(`avatar:user:${session.user.id}`, {
    window: 3600,
    max: 10,
  });
  if (!allowed) return rateLimitedResponse(retryAfter);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'no_file' }, 400);

  // Only WebP is accepted because that is the single format the client canvas
  // produces. Anything else means the bytes did not come through our re-encode,
  // and we are not in the business of parsing untrusted image formats
  // server-side (COMMENTS.md R4 stays intact — still no server-side fetch or
  // decode of user-supplied image data).
  if (file.type !== ACCEPTED) return json({ error: 'unsupported_type' }, 415);
  if (file.size === 0 || file.size > MAX_BYTES) return json({ error: 'too_large' }, 413);

  const [current] = await db
    .select({ avatarUrl: user.avatarUrl, avatarSource: user.avatarSource })
    .from(user)
    .where(eq(user.id, session.user.id));

  const blob = await put(`avatars/${session.user.id}.webp`, file, {
    access: 'public',
    addRandomSuffix: true,
    contentType: ACCEPTED,
  });

  await db
    .update(user)
    .set({ avatarUrl: blob.url, avatarSource: 'upload' })
    .where(eq(user.id, session.user.id));

  // Only ours to delete — a pasted URL points at someone else's server.
  if (current?.avatarSource === 'upload' && current.avatarUrl && current.avatarUrl !== blob.url) {
    await del(current.avatarUrl).catch(() => {
      // An orphaned blob is untidy, not broken; the new avatar is already saved
      // and failing the request here would be worse.
    });
  }

  return json({ url: blob.url }, 200);
};
