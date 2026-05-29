import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair } from '@polkadot/keyring/types';
import { WS_URL } from './localNode.js';

/**
 * Standard Substrate dev keypairs (sr25519) lazily initialized after
 * cryptoWaitReady() resolves. These accounts are pre-funded on `gear --dev`.
 *
 * Mirror of packages/sdk/tests/harness/devSigners.ts (verbatim — concern E).
 */

let _alice: KeyringPair | null = null;
let _bob: KeyringPair | null = null;
let _charlie: KeyringPair | null = null;

export async function initDevSigners(): Promise<void> {
  if (_alice && _bob && _charlie) return;
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519' });
  _alice = keyring.addFromUri('//Alice');
  _bob = keyring.addFromUri('//Bob');
  _charlie = keyring.addFromUri('//Charlie');
}

export function alice(): KeyringPair {
  if (!_alice) throw new Error('Call initDevSigners() in beforeAll before reading dev signers.');
  return _alice;
}

export function bob(): KeyringPair {
  if (!_bob) throw new Error('Call initDevSigners() in beforeAll before reading dev signers.');
  return _bob;
}

export function charlie(): KeyringPair {
  if (!_charlie) throw new Error('Call initDevSigners() in beforeAll before reading dev signers.');
  return _charlie;
}

let _api: GearApi | null = null;

export async function getApi(): Promise<GearApi> {
  if (_api && _api.isConnected) return _api;
  _api = await GearApi.create({ providerAddress: WS_URL });
  return _api;
}

export async function disconnectApi(): Promise<void> {
  if (_api) {
    await _api.disconnect();
    _api = null;
  }
}
