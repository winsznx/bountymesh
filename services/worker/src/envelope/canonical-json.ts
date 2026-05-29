/**
 * Canonical JSON serialization for hash determinism (P0 §C2 lock).
 *
 * Rules:
 *   - Object keys sorted lexicographically (recursive).
 *   - No whitespace between tokens.
 *   - Strings JSON-escaped per RFC 8259 (via Node's JSON.stringify).
 *   - Numbers: finite only (NaN/Infinity rejected).
 *   - bigint: rejected — caller MUST .toString() at the type boundary
 *     (matches the CLAUDE.md BigInt-boundary rule).
 *   - undefined: rejected — caller MUST use null explicitly.
 *   - Arrays preserve order (NOT sorted).
 *
 * Output is a UTF-8 string ready for sha256 hashing.
 */

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function canonicalJson(value: unknown): string {
  return encode(value);
}

function encode(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new CanonicalJsonError('undefined is not encodable; use null explicitly');
  }
  if (typeof value === 'bigint') {
    throw new CanonicalJsonError(
      'bigint is not encodable; convert to string at the type boundary',
    );
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError(`non-finite number not encodable: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(encode).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => `${JSON.stringify(k)}:${encode(obj[k])}`).join(',') + '}';
  }
  throw new CanonicalJsonError(`unsupported value type: ${typeof value}`);
}
