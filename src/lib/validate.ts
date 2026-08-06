// Same scheme-allowlist rule enforced client- and server-side for any pasted-URL
// field (avatar photo, post audio): only http/https, never javascript: or data:.
export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
