// Honeypot + submit timing (COMMENTS_V2.md §5.4): a hidden field a real person
// never fills, and a rejection of submissions that arrive impossibly fast. Free,
// no CAPTCHA, and no privacy cost — nothing leaves the origin and nothing about
// the reader is recorded. `better-auth/plugins/captcha` (Turnstile) stays in
// reserve for if real abuse shows up.
//
// Two carriers for the same two signals, because the endpoints differ:
//   - our own JSON routes (/api/subscribe) can just take them in the body;
//   - Better Auth's routes have a fixed zod body schema that strips unknown
//     keys, so AuthDialog sends them as headers instead.

/** Hidden input name. Plausible enough that a form-filling bot will complete it. */
export const HONEYPOT_FIELD = 'website';
/** Body key holding milliseconds between the form appearing and being submitted. */
export const ELAPSED_FIELD = 'elapsedMs';

export const HONEYPOT_HEADER = 'x-blog-hp';
export const ELAPSED_HEADER = 'x-blog-elapsed';

/**
 * Below this, nobody read the form — they scripted it. Generous on purpose: a
 * fast typist with autofill can submit an email field in about two seconds, and
 * a false positive here is a reader who simply cannot sign up.
 */
export const MIN_SUBMIT_MS = 1500;

/**
 * Both checks fire only on *positive* evidence: a filled hidden field, or an
 * elapsed time that is present and too short.
 *
 * A missing signal is deliberately not evidence. It is what a page cached from
 * before this shipped sends, and what any non-browser client sends — so failing
 * closed on absence would turn a deploy into a sign-up outage while catching
 * nothing a determined script couldn't trivially fix by sending the field. What
 * this layer is for is the naive bot that scrapes a form and submits every input
 * in it; requests that never touch the form are the rate limiter's job.
 */
function isBotSignal(honeypot: string | null, elapsedRaw: string | null): boolean {
  if ((honeypot ?? '') !== '') return true;

  if (elapsedRaw === null || elapsedRaw === '') return false;
  const elapsed = Number(elapsedRaw);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_SUBMIT_MS;
}

/** For our own JSON endpoints, where the signals ride in the request body. */
export function isBotSubmission(body: unknown): boolean {
  const record = (body ?? {}) as Record<string, unknown>;
  const honeypot = record[HONEYPOT_FIELD];
  const elapsed = record[ELAPSED_FIELD];

  return isBotSignal(
    typeof honeypot === 'string' ? honeypot.trim() : null,
    typeof elapsed === 'number' || typeof elapsed === 'string' ? String(elapsed) : null
  );
}

/** For Better Auth's endpoints, where the signals ride in headers. */
export function isBotHeaders(headers: Headers): boolean {
  return isBotSignal(headers.get(HONEYPOT_HEADER), headers.get(ELAPSED_HEADER));
}
