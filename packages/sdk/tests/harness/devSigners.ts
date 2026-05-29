import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair } from '@polkadot/keyring/types';
import { WS_URL } from './localNode.js';

/**
 * Standard Substrate dev keypairs (sr25519) lazily initialized after
 * cryptoWaitReady() resolves. These accounts are pre-funded on `gear --dev`.
 *
 * Use ALICE/BOB/CHARLIE in tests; do NOT use them for any mainnet operation
 * (the seeds are public).
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
 * Read the free balance of an address (SS58 string or 0x-prefixed program/account hex).
 *
 * Reads via api.query.system.account(addr).data.free — the standard substrate
 * AccountInfo free-balance path. Programs on Vara have account-shaped balances
 * (escrow lives there), so this helper works uniformly for poster/worker/program.
 */
export async function balanceOf(api: GearApi, address: string | Uint8Array): Promise<bigint> {
  const info = await api.query.system.account(address);
  return (info as unknown as { data: { free: { toBigInt: () => bigint } } }).data.free.toBigInt();
}

/**
 * Transfer balance from one funded dev account to another address.
 *
 * `gear --dev` pre-funds //Alice + //Bob only (per upstream README). For tests
 * exercising three-party flows (e.g. unauthorized-submitter, second-claimer),
 * //Charlie must be funded from a pre-funded account before any tx will be
 * accepted by the chain (a zero-balance origin fails at the extrinsic-validity
 * stage with code 1010: "Inability to pay some fees").
 */
export async function fund(from: KeyringPair, to: string, value: bigint): Promise<void> {
  const api = await getApi();
  return new Promise<void>((resolve, reject) => {
    api.balance
      .transfer(to, value as unknown as number)
      .signAndSend(
        from,
        ({ status, dispatchError }: { status: { isInBlock: boolean; isFinalized: boolean; isDropped: boolean; isInvalid: boolean }; dispatchError?: unknown }) => {
          if (dispatchError) {
            reject(new Error(`fund: dispatchError ${JSON.stringify(dispatchError)}`));
            return;
          }
          if (status.isInBlock || status.isFinalized) resolve();
          if (status.isInvalid || status.isDropped) reject(new Error('fund: tx invalid or dropped'));
        },
      )
      .catch(reject);
  });
}
