// Resolves a stored text-quote anchor (COMMENTS.md §4/§6) back to a live DOM Range inside
// the block it was captured from. A Range is returned (rather than just a block+offset) since
// sub-phase D needs it both for `getBoundingClientRect()` (margin avatar placement) and for
// wrapping the match in a highlight — deriving a Range from block+offset later would just
// duplicate this same text-node walk.

export interface AnchorQuery {
  blockIndex: number;
  exact: string;
  prefix?: string | null;
  suffix?: string | null;
  offsetHint?: number | null;
}

// Collapse whitespace runs to a single space so trivial re-wrapping in the source post
// doesn't break matching. Comment capture (sub-phase D) must normalize the same way when
// computing `anchor_offset_hint`, since that value is compared against normalized offsets here.
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ');
}

// Builds a normalized copy of `raw` plus a per-character map back to raw indices, so a match
// found in normalized space can be translated back to real offsets into the original string.
function buildNormalizedIndex(raw: string): { normalized: string; map: number[] } {
  let normalized = '';
  const map: number[] = [];
  let inWhitespace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (!inWhitespace) {
        normalized += ' ';
        map.push(i);
        inWhitespace = true;
      }
    } else {
      normalized += ch;
      map.push(i);
      inWhitespace = false;
    }
  }
  return { normalized, map };
}

// Raw-string [start, end) for a normalized-space [normStart, normEnd) range.
function toRawRange(map: number[], normStart: number, normEnd: number): [number, number] {
  const rawStart = normStart < map.length ? map[normStart] : (map.at(-1) ?? 0) + 1;
  const rawEnd = normEnd > 0 ? map[normEnd - 1] + 1 : 0;
  return [rawStart, rawEnd];
}

// Maps a raw character offset into `el`'s concatenated text back to a concrete
// (text node, offset-within-node) DOM position, by walking text nodes in order.
function pointAtRawOffset(el: Element, offset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const len = node.data.length;
    if (consumed + len >= offset) {
      return { node, offset: offset - consumed };
    }
    consumed += len;
  }
  return null;
}

function rangeFromRawOffsets(el: Element, rawStart: number, rawEnd: number): Range | null {
  const start = pointAtRawOffset(el, rawStart);
  const end = pointAtRawOffset(el, rawEnd);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const result: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    result.push(idx);
    from = idx + 1;
  }
  return result;
}

// Picks the occurrence closest to `hint` — matters even for the "with context" search,
// not just the bare fallback, since offsetHint is the only signal once there's more than
// one candidate (an empty prefix/suffix, e.g. a selection at a block's very start, makes
// the "with context" needle degenerate to just `exact`, same as the fallback).
function nearestTo(indices: number[], hint: number): number | null {
  if (indices.length === 0) return null;
  return indices.reduce((best, idx) =>
    Math.abs(idx - hint) < Math.abs(best - hint) ? idx : best
  );
}

export function resolveAnchor(container: Element, query: AnchorQuery): Range | null {
  const block = container.querySelector(`[data-block-index="${query.blockIndex}"]`);
  if (!block || !block.textContent) return null;

  const { normalized, map } = buildNormalizedIndex(block.textContent);
  const exactNorm = normalizeWhitespace(query.exact);
  if (!exactNorm) return null;

  const prefixNorm = normalizeWhitespace(query.prefix ?? '');
  const suffixNorm = normalizeWhitespace(query.suffix ?? '');
  const hint = query.offsetHint ?? 0;

  let matchStart: number | null = null;
  if (prefixNorm || suffixNorm) {
    const withContext = prefixNorm + exactNorm + suffixNorm;
    const hits = findAllOccurrences(normalized, withContext).map((i) => i + prefixNorm.length);
    matchStart = nearestTo(hits, hint);
  }

  if (matchStart === null) {
    // Fall back to a bare search for the quoted text, picking the occurrence
    // closest to the recorded offset hint if it appears more than once.
    matchStart = nearestTo(findAllOccurrences(normalized, exactNorm), hint);
  }

  if (matchStart === null) return null;

  const [rawStart, rawEnd] = toRawRange(map, matchStart, matchStart + exactNorm.length);
  return rangeFromRawOffsets(block, rawStart, rawEnd);
}
