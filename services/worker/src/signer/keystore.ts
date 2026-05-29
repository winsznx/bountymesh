/**
 * Vara-wallet JSON keystore loader.
 *
 * Vara-wallet writes pairs in @polkadot/keyring's standard JSON backup
 * format (PKCS8-encoded private key + sr25519 keypair material). This
 * module reads + parses + reconstructs the KeyringPair.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair, KeyringPair$Json } from '@polkadot/keyring/types';

export type KeystoreErrorCode =
  | 'not-found'
  | 'parse-failed'
  | 'invalid-shape'
  | 'unlock-failed';

export class KeystoreError extends Error {
  readonly code: KeystoreErrorCode;
  readonly path: string;
  readonly cause?: unknown;

  constructor(code: KeystoreErrorCode, path: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'KeystoreError';
    this.code = code;
    this.path = path;
    this.cause = cause;
  }
}

export function defaultKeystorePath(): string {
  return join(homedir(), '.vara-wallet', 'accounts', 'bountymesh-worker-1.json');
}

export function resolveKeystorePath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.WORKER_KEYSTORE_PATH) return process.env.WORKER_KEYSTORE_PATH;
  return defaultKeystorePath();
}

function isKeyringPairJson(x: unknown): x is KeyringPair$Json {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.address === 'string' &&
    typeof o.encoded === 'string' &&
    typeof o.encoding === 'object' &&
    o.encoding !== null &&
    typeof o.meta === 'object' &&
    o.meta !== null
  );
}

/**
 * Load + unlock a keypair from a vara-wallet keystore JSON file.
 *
 * Throws KeystoreError with a discriminated code:
 *   - 'not-found'     : file does not exist (ENOENT)
 *   - 'parse-failed'  : file exists but is not valid JSON / unreadable
 *   - 'invalid-shape' : JSON parsed but missing required keystore fields
 *   - 'unlock-failed' : addFromJson / pair.unlock threw
 */
export async function loadFromKeystore(explicitPath?: string): Promise<KeyringPair> {
  const path = resolveKeystorePath(explicitPath);

  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'ENOENT') {
      throw new KeystoreError('not-found', path, `keystore not found at ${path}`, err);
    }
    throw new KeystoreError('parse-failed', path, `failed to read keystore at ${path}`, err);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new KeystoreError('parse-failed', path, `keystore at ${path} is not valid JSON`, err);
  }

  if (!isKeyringPairJson(json)) {
    throw new KeystoreError(
      'invalid-shape',
      path,
      `keystore at ${path} is missing required fields (address/encoded/encoding/meta)`,
    );
  }

  const keyring = new Keyring({ type: 'sr25519' });
  try {
    // v1: unencrypted keystores only. addFromJson's optional password arg
    // accepts a password if encryption is later introduced.
    const pair = keyring.addFromJson(json);
    pair.unlock('');
    return pair;
  } catch (err) {
    throw new KeystoreError('unlock-failed', path, `failed to unlock keystore at ${path}`, err);
  }
}
