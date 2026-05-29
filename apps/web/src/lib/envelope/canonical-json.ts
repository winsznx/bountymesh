/**
 * Canonical JSON serialization for hash determinism.
 *
 * Copied from services/worker/src/envelope/canonical-json.ts. Identical
 * byte-output contract — the worker hashes one form, the frontend recomputes
 * the same form, the verification dance produces matching hex.
 *
 * Phase 7 polish item #10: move into @bountymesh/sdk as a public export so
 * this duplication can go away.
 *
 * Rules:
 *   - Object keys sorted lexicographically (recursive).
 *   - No whitespace between tokens.
 *   - Strings JSON-escaped per RFC 8259 (via JSON.stringify).
 *   - Numbers: finite only (NaN/Infinity rejected).
 *   - bigint: rejected — caller MUST .toString() at the type boundary.
 *   - undefined: rejected — caller MUST use null explicitly.
 *   - Arrays preserve order (NOT sorted).
 */

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

export function canonicalJson(value: unknown): string {
  return encode(value);
}

function encode(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) {
    throw new CanonicalJsonError("undefined is not encodable; use null explicitly");
  }
  if (typeof value === "bigint") {
    throw new CanonicalJsonError(
      "bigint is not encodable; convert to string at the type boundary",
    );
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError(`non-finite number not encodable: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(encode).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys.map((k) => `${JSON.stringify(k)}:${encode(obj[k])}`).join(",") +
      "}"
    );
  }
  throw new CanonicalJsonError(`unsupported value type: ${typeof value}`);
}
