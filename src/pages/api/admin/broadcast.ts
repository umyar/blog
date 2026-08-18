import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { auth } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { broadcast, subscriber } from '../../../lib/db/schema';
import { isAdmin } from '../../../lib/admin';
import { sendNewPostEmails } from '../../../lib/email';
import { siteUrl } from '../../../lib/site';
import { fetchPostIndex, broadcastLang, LANG_LABELS } from '../../../lib/post-index';

export const prerender = false;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// The manual trigger: announce one post to every confirmed subscriber.
export const POST: APIRoute = async ({ request }) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: 'unauthenticated' }, 401);
  if (!isAdmin(session.user.id)) return json({ error: 'forbidden' }, 403);

  const body = await request.json().catch(() => null);
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  const force = body?.force === true;
  if (!slug) return json({ error: 'invalid_slug' }, 400);

  const baseUrl = siteUrl(request);

  const posts = await fetchPostIndex(baseUrl).catch(() => null);
  if (!posts) return json({ error: 'post_index_unavailable' }, 500);

  const post = posts.find((p) => p.slug === slug);
  if (!post || post.langs.length === 0) return json({ error: 'post_not_found' }, 404);

  // Guarded here for a clear error message; the unique index on broadcast.post_slug
  // is what actually makes a double-click safe.
  const [already] = await db.select().from(broadcast).where(eq(broadcast.postSlug, slug));
  if (already && !force) {
    return json({ error: 'already_sent', sentAt: already.sentAt }, 409);
  }

  const recipients = await db
    .select({ email: subscriber.email, unsubscribeToken: subscriber.unsubscribeToken })
    .from(subscriber)
    .where(eq(subscriber.status, 'confirmed'));

  if (recipients.length === 0) return json({ error: 'no_subscribers' }, 400);

  const lang = broadcastLang(post.langs);
  const url = `${baseUrl}/posts/${lang}/${post.slug}`;

  const result = await sendNewPostEmails(
    recipients,
    {
      title: post.title[lang] ?? post.slug,
      excerpt: post.excerpt[lang] ?? '',
      url,
      coverUrl: post.cover ? `${baseUrl}${post.cover}` : undefined,
      otherLangs: post.langs
        .filter((l) => l !== lang)
        .map((l) => ({ label: LANG_LABELS[l], url: `${baseUrl}/posts/${l}/${post.slug}` })),
    },
    baseUrl
  );

  // Recorded even on a partial failure — the list has already been mailed, and
  // re-running the whole send would double up on everyone who did receive it.
  const row = {
    postSlug: slug,
    lang,
    recipientCount: result.sent,
    failedCount: result.failed,
    sentAt: new Date(),
  };

  if (already) {
    await db.update(broadcast).set(row).where(eq(broadcast.id, already.id));
  } else {
    await db.insert(broadcast).values({ id: crypto.randomUUID(), ...row });
  }

  return json({ sent: result.sent, failed: result.failed, errors: result.errors }, 200);
};
