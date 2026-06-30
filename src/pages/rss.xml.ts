import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getAllPosts, getPostLangs, type Lang } from '../lib/posts';

export async function GET(context: APIContext) {
  const posts = await getAllPosts();
  const items = [];
  for (const post of posts) {
    const langs = await getPostLangs(post.slug);
    for (const lang of langs as Lang[]) {
      items.push({
        title: post.entry.title[lang],
        description: post.entry.excerpt[lang],
        pubDate: new Date(post.entry.date),
        link: `/posts/${lang}/${post.slug}/`,
      });
    }
  }
  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return rss({
    title: 'umyar — blog',
    description: 'Notes by Umiar Iusupov — in RU, EN, PT.',
    site: context.site!,
    items,
  });
}
