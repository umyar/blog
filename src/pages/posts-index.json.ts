import type { APIRoute } from 'astro';
import { getAllPosts, getPostLangs, resolvePostImage, type Lang } from '../lib/posts';

// Prerendered on purpose (no `prerender = false`).
//
// Keystatic's reader resolves content off the filesystem at call time, which is
// only reliable during the build — inside a Vercel function `src/content/**`
// isn't part of the traced bundle, and the adapter's `includeFiles` escape hatch
// takes literal paths rather than globs, so it would need a manual edit per post.
// Emitting the metadata as a static file at build time sidesteps all of that:
// /admin/broadcast and /api/admin/broadcast just fetch this.
//
// Everything here is already public — it's the same data the homepage and RSS
// feed expose.
export const GET: APIRoute = async () => {
  const posts = await getAllPosts();

  const items = [];
  for (const post of posts) {
    const langs = (await getPostLangs(post.slug)) as Lang[];
    if (langs.length === 0) continue;

    items.push({
      slug: post.slug,
      date: post.entry.date,
      langs,
      title: Object.fromEntries(langs.map((l) => [l, post.entry.title[l]])),
      excerpt: Object.fromEntries(langs.map((l) => [l, post.entry.excerpt[l]])),
      // Resolved here rather than at send time so the broadcast route never has
      // to touch astro:assets — it only prefixes this with the site origin.
      cover: (await resolvePostImage(post.entry.cover)) ?? null,
    });
  }

  items.sort((a, b) => (a.date < b.date ? 1 : -1));

  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' },
  });
};
