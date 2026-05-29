/**
 * Reusable typed validators for environment-variable parsing.
 *
 * Each validator returns a discriminated union:
 *   { ok: true, value: T }  on success
 *   { ok: false, error: ConfigVarError }  on failure
 *
 * Callers aggregate errors before throwing (see load.ts) so the operator
 * sees every config issue at once, not one-at-a-time across restarts.
 */

export interface ConfigVarError {
  varName: string;
  code: 'missing' | 'invalid-format' | 'invalid-range';
  detail: string;
}

export type ValidatorResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConfigVarError };

function missing(varName: string): ValidatorResult<never> {
  return { ok: false, error: { varName, code: 'missing', detail: `${varName} is required` } };
}

function invalid(varName: string, detail: string): ValidatorResult<never> {
  return { ok: false, error: { varName, code: 'invalid-format', detail } };
}

function outOfRange(varName: string, detail: string): ValidatorResult<never> {
  return { ok: false, error: { varName, code: 'invalid-range', detail } };
}

export function validateUrl(
  varName: string,
  value: string | undefined,
  protocols: readonly string[],
): ValidatorResult<string> {
  if (!value) return missing(varName);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid(varName, `not a valid URL: ${value}`);
  }
  if (!protocols.includes(parsed.protocol)) {
    return invalid(varName, `protocol ${parsed.protocol} not in [${protocols.join(', ')}]`);
  }
  return { ok: true, value };
}

export function validateHex(
  varName: string,
  value: string | undefined,
  expectedBytes: number,
): ValidatorResult<`0x${string}`> {
  if (!value) return missing(varName);
  const expectedLen = 2 + expectedBytes * 2;
  if (value.length !== expectedLen) {
    return invalid(
      varName,
      `expected ${expectedLen} chars (0x + ${expectedBytes * 2} hex), got ${value.length}`,
    );
  }
  if (!value.startsWith('0x')) {
    return invalid(varName, `must start with 0x`);
  }
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    return invalid(varName, `contains non-hex characters`);
  }
  return { ok: true, value: value as `0x${string}` };
}

export function validateBigInt(
  varName: string,
  value: string | undefined,
  opts?: { min?: bigint; max?: bigint },
): ValidatorResult<bigint> {
  if (!value) return missing(varName);
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    return invalid(varName, `not a valid bigint: ${value}`);
  }
  if (opts?.min !== undefined && parsed < opts.min) {
    return outOfRange(varName, `${parsed} < min ${opts.min}`);
  }
  if (opts?.max !== undefined && parsed > opts.max) {
    return outOfRange(varName, `${parsed} > max ${opts.max}`);
  }
  return { ok: true, value: parsed };
}

export function validateEnum<T extends string>(
  varName: string,
  value: string | undefined,
  allowed: readonly T[],
): ValidatorResult<T> {
  if (!value) return missing(varName);
  if (!allowed.includes(value as T)) {
    return invalid(varName, `${value} not in [${allowed.join(', ')}]`);
  }
  return { ok: true, value: value as T };
}

export function validateNumber(
  varName: string,
  value: string | undefined,
  opts?: { min?: number; max?: number },
): ValidatorResult<number> {
  if (!value) return missing(varName);
  if (!/^-?\d+$/.test(value)) {
    return invalid(varName, `not a valid integer: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return invalid(varName, `not a safe integer: ${value}`);
  }
  if (opts?.min !== undefined && parsed < opts.min) {
    return outOfRange(varName, `${parsed} < min ${opts.min}`);
  }
  if (opts?.max !== undefined && parsed > opts.max) {
    return outOfRange(varName, `${parsed} > max ${opts.max}`);
  }
  return { ok: true, value: parsed };
}
