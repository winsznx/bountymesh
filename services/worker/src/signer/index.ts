/**
 * Signer orchestrator. Public surface:
 *   loadSigner(opts?) → Promise<{ pair, source }>
 *
 * Precedence (per P2 §8 architectural rule):
 *   1. Try keystore (path: opts.keystorePath > WORKER_KEYSTORE_PATH env >
 *      ~/.vara-wallet/accounts/bountymesh-worker-1.json default).
 *   2. If keystore was 'not-found', fall through to BOUNTYMESH_WORKER_SEED env.
 *   3. If keystore was present-but-broken (parse-failed/invalid-shape/
 *      unlock-failed), FAIL FAST via SignerLoadError(keystoreError, null) —
 *      do NOT silently bypass operator intent.
 *   4. If both keystore was missing AND env failed, throw SignerLoadError
 *      aggregating both diagnostics.
 *
 * cryptoWaitReady() runs first (idempotent across calls; required before
 * any @polkadot/keyring instantiation in this process).
 */

import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair } from '@polkadot/keyring/types';
import { loadFromKeystore, KeystoreError } from './keystore.js';
import { loadFromEnv, EnvSignerError } from './env.js';

export interface LoadSignerOptions {
  keystorePath?: string;
}

export interface LoadedSigner {
  pair: KeyringPair;
  source: 'keystore' | 'env';
}

export class SignerLoadError extends Error {
  readonly keystoreError: KeystoreError | null;
  readonly envError: EnvSignerError | null;

  constructor(keystoreError: KeystoreError | null, envError: EnvSignerError | null) {
    const parts: string[] = [];
    if (keystoreError) parts.push(`keystore[${keystoreError.code}]: ${keystoreError.message}`);
    if (envError) parts.push(`env[${envError.code}]: ${envError.message}`);
    super(`signer load failed — ${parts.join(' ; ')}`);
    this.name = 'SignerLoadError';
    this.keystoreError = keystoreError;
    this.envError = envError;
  }
}

export { KeystoreError, EnvSignerError };

export async function loadSigner(opts?: LoadSignerOptions): Promise<LoadedSigner> {
  await cryptoWaitReady();

  let keystoreError: KeystoreError | null = null;
  try {
    const pair = await loadFromKeystore(opts?.keystorePath);
    return { pair, source: 'keystore' };
  } catch (err) {
    if (!(err instanceof KeystoreError)) throw err;
    keystoreError = err;
    if (err.code !== 'not-found') {
      // Present-but-broken keystore: operator intent. Do NOT query env.
      throw new SignerLoadError(keystoreError, null);
    }
  }

  // keystoreError.code === 'not-found' — fall through to env.
  let envError: EnvSignerError | null = null;
  try {
    const pair = loadFromEnv();
    return { pair, source: 'env' };
  } catch (err) {
    if (!(err instanceof EnvSignerError)) throw err;
    envError = err;
  }

  throw new SignerLoadError(keystoreError, envError);
}
