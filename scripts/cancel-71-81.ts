/**
 * Targeted cancel script for bounties 71..81 (the known-Open ids that
 * survived the earlier batch). Skips the EXECUTE flag dance — runs the
 * cancels unconditionally.
 */

import { readFileSync } from 'node:fs';

import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair, KeyringPair$Json } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';

import { BountyMeshClient } from '@bountymesh/sdk';

const PROGRAM_ID = '0xfa09abea4ac2de874bc115cfcfd0992e07636ee9f74e62a21b3750fd6f218886' as const;
const POSTER_HEX = '0xa2d2b8caeeddf26edd3a08d6a2e8a0313f7d6c892c53a1b06015b328153a0b1f' as const;
const KEYSTORE_PATH = '/Users/mac/.vara-wallet/wallets/winsznx.json';
const RPC_URL = 'wss://rpc.vara.network';
const COOLDOWN_MS = 5_000;

const TARGET_IDS: readonly bigint[] = [
  71n,
  72n,
  73n,
  74n,
  75n,
  76n,
  77n,
  78n,
  79n,
  80n,
  81n,
];

interface CancelLog {
  id: string;
  txHash?: `0x${string}`;
  result: 'ok' | string;
}

function log(obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function loadKeypair(): KeyringPair {
  const kr = new Keyring({ type: 'sr25519' });
  const raw = readFileSync(KEYSTORE_PATH, 'utf-8');
  const json = JSON.parse(raw) as KeyringPair$Json;
  const pair = kr.addFromJson(json);
  pair.unlock('');
  return pair;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readBalanceAtomic(api: GearApi): Promise<bigint> {
  const acct = await api.query.system.account(POSTER_HEX);
  const json = acct.toJSON() as { data?: { free?: string | number } } | null;
  const freeRaw = json?.data?.free ?? '0';
  return BigInt(freeRaw);
}

async function main(): Promise<void> {
  await cryptoWaitReady();

  const kp = loadKeypair();
  const posterPubHex = `0x${Buffer.from(kp.publicKey).toString('hex')}`;
  if (posterPubHex.toLowerCase() !== POSTER_HEX.toLowerCase()) {
    throw new Error(
      `keystore pubkey ${posterPubHex} does not match expected poster ${POSTER_HEX} — refusing to run`,
    );
  }

  const api = await GearApi.create({ providerAddress: RPC_URL });
  await api.isReady;
  api.on('disconnected', () => {
    log({ stage: 'api_disconnected_event' });
  });
  api.on('error', (e: unknown) => {
    log({ stage: 'api_error_event', err: e instanceof Error ? e.message : String(e) });
  });

  const client = new BountyMeshClient({ api, programId: PROGRAM_ID, signer: kp });
  log({ stage: 'api_ready', rpc: RPC_URL, address: kp.address });

  const preBalanceAtomic = await readBalanceAtomic(api);
  const preBalanceVara = Number(preBalanceAtomic) / 1e12;
  log({ stage: 'pre_balance', atomic: preBalanceAtomic.toString(), vara: preBalanceVara });

  const results: CancelLog[] = [];
  let successes = 0;
  let failures = 0;
  const failedIds: string[] = [];

  for (let i = 0; i < TARGET_IDS.length; i++) {
    const id = TARGET_IDS[i];
    log({ stage: 'cancel_begin', i: i + 1, total: TARGET_IDS.length, id: id.toString() });

    try {
      const r = await client.cancel(id);
      if (r.ok) {
        successes += 1;
        const entry: CancelLog = { id: id.toString(), txHash: r.txHash, result: 'ok' };
        results.push(entry);
        log({ stage: 'cancel_ok', ...entry });
      } else {
        failures += 1;
        failedIds.push(id.toString());
        const errStr = typeof r.error === 'string' ? r.error : JSON.stringify(r.error);
        const entry: CancelLog = { id: id.toString(), txHash: r.txHash, result: errStr };
        results.push(entry);
        log({ stage: 'cancel_err', ...entry });
      }
    } catch (err) {
      failures += 1;
      failedIds.push(id.toString());
      const errStr = err instanceof Error ? err.message : String(err);
      const entry: CancelLog = { id: id.toString(), result: `throw: ${errStr}` };
      results.push(entry);
      log({ stage: 'cancel_throw', ...entry });
    }

    if (i < TARGET_IDS.length - 1) {
      await sleep(COOLDOWN_MS);
    }
  }

  const postBalanceAtomic = await readBalanceAtomic(api);
  const postBalanceVara = Number(postBalanceAtomic) / 1e12;
  const recoveredVara = postBalanceVara - preBalanceVara;
  log({
    stage: 'summary',
    attempted: TARGET_IDS.length,
    successes,
    failures,
    failedIds,
    preBalanceVara,
    postBalanceVara,
    recoveredVara,
  });

  try {
    await api.disconnect();
  } catch {
    // ignore disconnect noise
  }
}

main().catch((err) => {
  log({ stage: 'fatal', err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
