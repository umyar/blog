import { normalizeWhitespace } from './anchor';

export interface CapturedSelection {
  blockIndex: number;
  exact: string;
  prefix: string;
  suffix: string;
  offsetHint: number;
}

const CONTEXT_LEN = 30;

function findBlockAncestor(container: Element, node: Node): Element | null {
  let el: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== container) {
    if (el instanceof Element && el.hasAttribute('data-block-index')) return el;
    el = el.parentNode;
  }
  return null;
}

// Raw text of `block` from its start up to (node, offset), used to derive both the
// normalized-space offset hint and the prefix context — see COMMENTS.md §6 task 3.
function textBefore(block: Element, node: Node, offset: number): string {
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(node, offset);
  return range.toString();
}

// Captures the current window selection as a text-quote anchor if (and only if) it's
// non-empty and stays within a single `[data-block-index]` element inside `container`.
// Returns null otherwise so the caller can show a "select within a single paragraph"
// hint instead of ever sending a cross-block anchor to the API.
export function captureSelection(container: Element): CapturedSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const startBlock = findBlockAncestor(container, range.startContainer);
  const endBlock = findBlockAncestor(container, range.endContainer);
  if (!startBlock || startBlock !== endBlock) return null;

  const blockIndexAttr = startBlock.getAttribute('data-block-index');
  if (blockIndexAttr === null) return null;

  const exact = normalizeWhitespace(range.toString());
  if (!exact) return null;

  const blockTextNorm = normalizeWhitespace(startBlock.textContent ?? '');
  const beforeNorm = normalizeWhitespace(textBefore(startBlock, range.startContainer, range.startOffset));
  const offsetHint = beforeNorm.length;

  return {
    blockIndex: Number(blockIndexAttr),
    exact,
    prefix: beforeNorm.slice(-CONTEXT_LEN),
    suffix: blockTextNorm.slice(offsetHint + exact.length, offsetHint + exact.length + CONTEXT_LEN),
    offsetHint,
  };
}
