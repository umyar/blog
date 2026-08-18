// One definition of "a usable email address", shared by every path that takes
// one (COMMENTS_V2.md §5.2). It was written once inside api/subscribe/index.ts
// and the auth path had nothing equivalent — which is the asymmetry feedback #2
// pointed at.

// RFC 5321's practical maximum. Worth checking before the regex: it is the only
// bound that stops a megabyte of text reaching the pattern matcher.
const MAX_EMAIL_LEN = 254;

// Deliberately permissive. A regex cannot decide whether an address is real —
// only delivery can — so this rejects the obviously malformed and leaves the
// rest to the confirmation code, which is the actual proof of control.
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Trim and lowercase. Better Auth lowercases on both create and lookup
 * (internal-adapter.mjs `createUser` / `findUserByEmail`), so normalizing the
 * same way here is what keeps `user.email` and `subscriber.email` directly
 * joinable with `=` — see COMMENTS_V2.md §0.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LEN && SHAPE.test(value);
}
