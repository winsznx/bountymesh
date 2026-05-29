function truncateMiddle(s: string, head: number, tail: number): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export async function encodeHexToSs58(hex: string, prefix: number): Promise<string> {
  const { encodeAddress } = await import("@polkadot/util-crypto");
  return encodeAddress(hex, prefix);
}

export function formatAddressTruncated(
  addr: string,
  chainSS58: number | null,
  cachedSs58?: string | null,
): string {
  if (!addr.startsWith("0x")) return truncateMiddle(addr, 6, 6);
  if (cachedSs58) return truncateMiddle(cachedSs58, 6, 6);
  if (chainSS58 === null) return truncateMiddle(addr, 8, 6);
  return truncateMiddle(addr, 8, 6);
}

/**
 * Compare two addresses for identity. Either side may be hex (`0x…`) or
 * SS58 (`5…`, `kG…`). Normalizes both to the same encoding before
 * string-compare. Returns false if either side fails to convert.
 *
 * Used by AcceptSubmissionButton (P3.5) to gate visibility on
 * `wallet.account.address === bounty.poster`, and by /me filtering (P3.6).
 */
export async function isAddressMatch(
  a: string,
  b: string,
  chainSS58: number | null,
): Promise<boolean> {
  if (a === b) return true;
  const aIsHex = a.startsWith("0x");
  const bIsHex = b.startsWith("0x");
  if (aIsHex === bIsHex) return a.toLowerCase() === b.toLowerCase();
  try {
    const { encodeAddress, decodeAddress } = await import("@polkadot/util-crypto");
    const u8a = (addr: string): Uint8Array =>
      addr.startsWith("0x") ? hexToBytes(addr) : decodeAddress(addr);
    const bytesA = u8a(a);
    const bytesB = u8a(b);
    if (bytesA.length !== bytesB.length) return false;
    for (let i = 0; i < bytesA.length; i++) {
      if (bytesA[i] !== bytesB[i]) return false;
    }
    if (chainSS58 !== null) {
      void encodeAddress;
    }
    return true;
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Canonicalize any address form (hex or SS58) to 0x-prefixed hex pubkey.
 * Used at the GraphQL filter boundary — the indexer stores poster/worker
 * as hex, so wallet's SS58 must be converted before equality filtering.
 */
export async function addressToHex(addr: string): Promise<`0x${string}`> {
  if (addr.startsWith("0x")) return addr as `0x${string}`;
  const { decodeAddress } = await import("@polkadot/util-crypto");
  const bytes = decodeAddress(addr);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as `0x${string}`;
}
