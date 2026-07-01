import { createReader } from '@keystatic/core/reader';
import Markdoc from '@markdoc/markdoc';
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import keystaticConfig from '../../keystatic.config';

export type Lang = 'ru' | 'en' | 'pt';
export const LANGS: Lang[] = ['ru', 'en', 'pt'];

const reader = createReader(process.cwd(), keystaticConfig);

// Body images live in `src/assets/posts/**` and are referenced from the .mdoc files with
// Keystatic-relative paths like `../../../assets/posts/<slug>/<file>`. Those paths aren't served
// as-is, so we resolve each one through Astro's asset pipeline. Eager-globbing the assets gives us
// their processed ImageMetadata, keyed by the path segment after `assets/posts/`.
const imageModules = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/posts/**/*.{webp,png,jpg,jpeg,gif,avif}',
  { eager: true }
);

const imagesByRelPath = new Map<string, ImageMetadata>();
for (const [key, mod] of Object.entries(imageModules)) {
  const rel = key.split('/assets/posts/')[1];
  if (rel) imagesByRelPath.set(rel, mod.default);
}

// Rewrite each image node's `src` in-place to an Astro-optimized URL. Mutates the AST.
async function resolveBodyImages(node: Markdoc.Node) {
  const imageNodes = [...node.walk()].filter((n) => n.type === 'image');
  for (const imageNode of imageNodes) {
    const src = imageNode.attributes.src;
    if (typeof src !== 'string') continue;
    const rel = src.split('assets/posts/')[1];
    const meta = rel ? imagesByRelPath.get(rel) : undefined;
    if (!meta) continue;
    const optimized = await getImage({ src: meta });
    imageNode.attributes.src = optimized.src;
  }
}

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
  await resolveBodyImages(source.node);
  const transformed = Markdoc.transform(source.node);
  const html = Markdoc.renderers.html(transformed);
  return { entry: post.entry, html };
}
