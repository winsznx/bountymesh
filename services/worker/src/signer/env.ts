/**
 * BOUNTYMESH_WORKER_SEED environment fallback.
 *
 * Accepts any string that @polkadot/keyring's addFromUri parses —
 * Substrate URI form (`//hard/soft///password`) or BIP-39 mnemonic
 * (12 or 24 words). Sr25519 default per the Keyring instance.
 */

import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';

export type EnvSignerErrorCode = 'not-set' | 'invalid-uri';

export class EnvSignerError extends Error {
  readonly code: EnvSignerErrorCode;
  readonly cause?: unknown;

  constructor(code: EnvSignerErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'EnvSignerError';
    this.code = code;
    this.cause = cause;
  }
}

export const ENV_VAR_NAME = 'BOUNTYMESH_WORKER_SEED';

/**
 * Read BOUNTYMESH_WORKER_SEED and construct an Sr25519 KeyringPair.
 *
 * Throws EnvSignerError with a discriminated code:
 *   - 'not-set'     : env var not set or empty
 *   - 'invalid-uri' : addFromUri rejected the seed (malformed mnemonic / URI)
 */
export function loadFromEnv(): KeyringPair {
  const seed = process.env[ENV_VAR_NAME];
  if (!seed || seed.length === 0) {
    throw new EnvSignerError('not-set', `${ENV_VAR_NAME} is not set`);
  }

  const keyring = new Keyring({ type: 'sr25519' });
  try {
    return keyring.addFromUri(seed);
  } catch (err) {
    throw new EnvSignerError(
      'invalid-uri',
      `${ENV_VAR_NAME} is not a valid Substrate URI or mnemonic`,
      err,
    );
  }
}
