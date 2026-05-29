import { createHash } from 'node:crypto';

/**
 * sha256(input) → '0x' + 64 lowercase hex chars.
 *
 * Used for envelope.result_hash (over canonical JSON) and for
 * upstream.response_sha256 (over the adapter's raw response bytes).
 */
export function sha256Hex(input: string | Buffer): `0x${string}` {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  const hex = createHash('sha256').update(buf).digest('hex');
  return `0x${hex}` as `0x${string}`;
}
