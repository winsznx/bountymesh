/**
 * Web Crypto SHA-256 wrapper. Browser-only — crypto.subtle is undefined in
 * Node, so callers must ensure they run inside a 'use client' component path.
 *
 * Returns the hash as a 0x-prefixed lowercase hex string to match the
 * worker's sha256Hex output and the indexer's resultHash format.
 */
export async function sha256Hex(input: string): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as `0x${string}`;
}
