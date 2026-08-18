import type { Lang } from './posts';

export type PostIndexItem = {
  slug: string;
  date: string;
  langs: Lang[];
  title: Partial<Record<Lang, string>>;
  excerpt: Partial<Record<Lang, string>>;
  cover: string | null;
};

// Reads the build-time index emitted by src/pages/posts-index.json.ts. See the
// comment there for why the content isn't read directly at request time.
export async function fetchPostIndex(baseUrl: string): Promise<PostIndexItem[]> {
  const res = await fetch(`${baseUrl}/posts-index.json`);
  if (!res.ok) throw new Error(`post index unavailable (${res.status})`);
  return (await res.json()) as PostIndexItem[];
}

// Which language a broadcast links to. The list isn't segmented by language, so
// every subscriber gets the same link — English when it exists, otherwise
// whichever translation does. Matches how the homepage picks a card's language.
export function broadcastLang(langs: Lang[]): Lang {
  return langs.includes('en') ? 'en' : langs[0]!;
}

export const LANG_LABELS: Record<Lang, string> = { ru: 'RU', en: 'EN', pt: 'PT' };
