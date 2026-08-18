// URL-safe random tokens for the newsletter confirm/unsubscribe links.
// 32 bytes from the CSPRNG — `crypto.randomUUID()` is fine as a row id but only
// carries 122 bits and is not meant to be unguessable, and these tokens are the
// only thing standing between a stranger and someone else's subscription.
export function createToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
