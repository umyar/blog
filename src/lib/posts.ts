import { createReader } from '@keystatic/core/reader';
import Markdoc from '@markdoc/markdoc';
import keystaticConfig from '../../keystatic.config';

export type Lang = 'ru' | 'en' | 'pt';
export const LANGS: Lang[] = ['ru', 'en', 'pt'];

const reader = createReader(process.cwd(), keystaticConfig);

export async function getAllPosts() {
  const entries = await reader.collections.posts.all();
  return entries.filter((p) => p.entry.draft === false);
}

export async function getPostLangs(slug: string): Promise<Lang[]> {
  const entries = await getAllPosts();
  const post = entries.find((p) => p.slug === slug);
  if (!post) return [];
  const langs: Lang[] = [];
  for (const lang of LANGS) {
    const source = await post.entry[`body_${lang}`]();
    if (source.node.children.length > 0) langs.push(lang);
  }
  return langs;
}

export async function renderPostBody(slug: string, lang: Lang) {
  const entries = await getAllPosts();
  const post = entries.find((p) => p.slug === slug);
  if (!post) return null;
  const source = await post.entry[`body_${lang}`]();
  if (source.node.children.length === 0) return null;
  const transformed = Markdoc.transform(source.node);
  const html = Markdoc.renderers.html(transformed);
  return { entry: post.entry, html };
}
