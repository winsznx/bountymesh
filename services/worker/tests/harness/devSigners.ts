import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair } from '@polkadot/keyring/types';
import { WS_URL } from './localNode.js';

/**
 * Standard Substrate dev keypairs (sr25519). Mirror of indexer's
 * tests/harness/devSigners.ts.
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

/**
 * Transfer balance from one funded dev account to another address.
 * `gear --dev` pre-funds //Alice + //Bob only — //Charlie (and beyond)
 * must be funded explicitly before any tx will accept their signature.
 */
export async function fund(from: KeyringPair, to: string, value: bigint): Promise<void> {
  const api = await getApi();
  return new Promise<void>((resolve, reject) => {
    (
      api as unknown as {
        balance: {
          transfer: (
            to: string,
            value: bigint | number,
          ) => {
            signAndSend: (
              from: KeyringPair,
              cb: (info: {
                status: {
                  isInBlock: boolean;
                  isFinalized: boolean;
                  isDropped: boolean;
                  isInvalid: boolean;
                };
                dispatchError?: unknown;
              }) => void,
            ) => Promise<unknown>;
          };
        };
      }
    ).balance
      .transfer(to, value)
      .signAndSend(from, ({ status, dispatchError }) => {
        if (dispatchError) {
          reject(new Error(`fund: dispatchError ${JSON.stringify(dispatchError)}`));
          return;
        }
        if (status.isInBlock || status.isFinalized) resolve();
        if (status.isInvalid || status.isDropped) reject(new Error('fund: tx invalid or dropped'));
      })
      .catch(reject);
  });
}
