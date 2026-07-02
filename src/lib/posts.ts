import { createReader } from '@keystatic/core/reader';
import Markdoc from '@markdoc/markdoc';
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import keystaticConfig from '../../keystatic.config';

export type Lang = 'ru' | 'en' | 'pt';
export const LANGS: Lang[] = ['ru', 'en', 'pt'];

const reader = createReader(process.cwd(), keystaticConfig);

// Build a GitHub-style anchor slug from a heading's text (Unicode-aware, so Cyrillic
// titles get usable ids too): lowercase, drop punctuation/emoji, spaces → hyphens.
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Concatenate all text/code content under a node so we can derive its slug.
function headingText(node: Markdoc.Node): string {
  return [...node.walk()]
    .filter((n) => n.type === 'text' || n.type === 'code')
    .map((n) => (typeof n.attributes.content === 'string' ? n.attributes.content : ''))
    .join('');
}

// A small link/chain icon revealed on heading hover.
const anchorIcon = new Markdoc.Tag(
  'svg',
  {
    class: 'heading-anchor-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  },
  [
    new Markdoc.Tag('path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }, []),
    new Markdoc.Tag('path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }, []),
  ]
);

// Per-render Markdoc config. Rebuilt for each post so the heading-id dedupe set
// starts fresh. Two customizations:
//   - links open in a new tab (target/rel appended),
//   - headings become deep-linkable anchors (stable id + a wrapping link that
//     updates the URL hash on click and reveals a chain icon on hover).
function createMarkdocConfig(): Markdoc.Config {
  const usedIds = new Set<string>();
  return {
    nodes: {
      link: {
        ...Markdoc.nodes.link,
        transform(node, config) {
          const attributes = node.transformAttributes(config);
          const children = node.transformChildren(config);
          return new Markdoc.Tag(
            'a',
            { ...attributes, target: '_blank', rel: 'noopener noreferrer' },
            children
          );
        },
      },
      heading: {
        ...Markdoc.nodes.heading,
        transform(node, config) {
          const children = node.transformChildren(config);
          const level = node.attributes.level ?? 2;

          let base = slugifyHeading(headingText(node)) || 'section';
          let id = base;
          for (let i = 2; usedIds.has(id); i++) id = `${base}-${i}`;
          usedIds.add(id);

          const link = new Markdoc.Tag(
            'a',
            { href: `#${id}`, class: 'heading-anchor', 'aria-label': 'Link to this section' },
            [...children, anchorIcon]
          );
          return new Markdoc.Tag(`h${level}`, { id, class: 'group' }, [link]);
        },
      },
    },
  };
}

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

// Resolve a Keystatic-relative asset path (e.g. `../../../assets/posts/<slug>/<file>`) to an
// Astro-optimized URL. Absolute URLs pass through untouched; unknown paths return undefined.
export async function resolvePostImage(
  src: string | null | undefined
): Promise<string | undefined> {
  if (!src) return undefined;
  if (src.startsWith('http')) return src;
  const rel = src.split('assets/posts/')[1];
  const meta = rel ? imagesByRelPath.get(rel) : undefined;
  if (!meta) return undefined;
  const optimized = await getImage({ src: meta });
  return optimized.src;
}

// Rewrite each image node's `src` in-place to an Astro-optimized URL. Mutates the AST.
async function resolveBodyImages(node: Markdoc.Node) {
  const imageNodes = [...node.walk()].filter((n) => n.type === 'image');
  for (const imageNode of imageNodes) {
    const src = imageNode.attributes.src;
    if (typeof src !== 'string') continue;
    const resolved = await resolvePostImage(src);
    if (resolved) imageNode.attributes.src = resolved;
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
  const transformed = Markdoc.transform(source.node, createMarkdocConfig());
  const html = Markdoc.renderers.html(transformed);
  return { entry: post.entry, html };
}
