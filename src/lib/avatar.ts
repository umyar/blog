// Avatar rendering, shared by every surface that shows a reader (COMMENTS_V2.md
// §4.3.2). The avatar is optional now, so "no photo" has to be a first-class
// state rather than a broken <img>.
//
// Deliberately NOT Gravatar: that would ship a hash of every reader's email
// address to a third party just to draw a circle.

const BRAND = {
  // The site gradient in HSL so the whole pair can be hue-rotated as a unit and
  // still read as the same family. Matches --color-grad-from / --color-grad-to.
  from: { h: 231, s: 36, l: 45 }, // #4a569d
  to: { h: 0, s: 72, l: 50 }, // #dc2424
};

// FNV-1a. Not security-sensitive — it just has to scatter ids evenly and give
// the same answer on the server and in the browser.
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const value = lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** First letter of each name. Falls back to the address, then to a shrug-free dot. */
export function initials(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  const a = (firstName ?? '').trim();
  const b = (lastName ?? '').trim();
  const letters = `${a.charAt(0)}${b.charAt(0)}`.trim();
  if (letters) return letters.toUpperCase();
  const local = (email ?? '').trim().charAt(0);
  return (local || '·').toUpperCase();
}

/**
 * Deterministic monogram as an SVG data URI, so it drops straight into any
 * existing `<img src>` without those call sites needing to branch.
 */
export function monogramDataUri(seed: string, text: string): string {
  // Same rotation applied to both stops keeps the brand's blue→red relationship
  // while separating two readers who happen to share initials.
  const rotate = hash(seed) % 360;
  const from = hslToHex((BRAND.from.h + rotate) % 360, BRAND.from.s, BRAND.from.l);
  const to = hslToHex((BRAND.to.h + rotate) % 360, BRAND.to.s, BRAND.to.l);
  const id = `g${hash(seed).toString(36)}`;

  // Only generic font families resolve inside an <img>-referenced SVG — it gets
  // no access to the page's stylesheets or webfonts.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="${id}" x1="1" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${to}"/><stop offset="1" stop-color="${from}"/>` +
    `</linearGradient></defs>` +
    `<rect width="64" height="64" rx="32" fill="url(#${id})"/>` +
    `<text x="32" y="33" fill="#fff" font-family="Helvetica,Arial,sans-serif" font-size="26"` +
    ` font-weight="600" text-anchor="middle" dominant-baseline="central">${escapeXml(text)}</text>` +
    `</svg>`;

  // encodeURIComponent rather than base64: it stays readable in devtools and is
  // shorter for this kind of ASCII-heavy payload.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type AvatarSubject = {
  id: string;
  avatarUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

/** The one entry point: a real photo when there is one, a monogram when there isn't. */
export function avatarSrc(subject: AvatarSubject): string {
  const url = (subject.avatarUrl ?? '').trim();
  if (url) return url;
  return monogramDataUri(subject.id, initials(subject.firstName, subject.lastName, subject.email));
}

export function displayName(firstName?: string | null, lastName?: string | null): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Anonymous';
}

/** The reader's permanent public handle. Store the integer; render it like this. */
export function readerTag(userNumber?: number | null): string {
  return typeof userNumber === 'number' ? `u${userNumber}` : '';
}
