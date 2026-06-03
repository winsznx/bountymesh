/**
 * One-shot recovery script — cancels every Open bounty posted by the
 * winsznx wallet, refunding the full escrow back to the poster.
 *
 * Reads the indexer for the canonical list of Open bounty ids (poster ==
 * winsznx pubkey, status == "Open"), then calls Bounty/Cancel(id) for each
 * via @bountymesh/sdk against mainnet.
 *
 * Safety: defaults to DRY-RUN. To execute, set EXECUTE=1.
 *
 *   # Dry run (default — prints the id list, no signing)
 *   tsx scripts/recover-open-bounties.ts
 *
 *   # Real run
 *   EXECUTE=1 tsx scripts/recover-open-bounties.ts
 *
 * Resilience:
 *   - Reconnects GearApi on 1006 / WebSocket disconnect
 *   - 5s cooldown between cancels
 *   - Continues past per-tx failures
 *   - Re-queries indexer every 10 cancels to refresh the Open list
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
const RPC_URL = process.env.VARA_RPC_URL ?? 'wss://rpc.vara.network';
const INDEXER_URL = 'https://api.bountymesh.xyz/graphql';
const COOLDOWN_MS = 5_000;
const REFRESH_EVERY = 10;
const RECONNECT_SLEEP_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 5;

const EXECUTE = process.env.EXECUTE === '1';

interface OpenBountyRow {
  id: string;
  reward: string;
}

interface CancelLog {
  id: string;
  txHash?: `0x${string}`;
  result: 'ok' | string;
}

interface ChainCtx {
  api: GearApi;
  client: BountyMeshClient;
  kp: KeyringPair;
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

async function fetchOpenBountyIds(): Promise<OpenBountyRow[]> {
  const query = `{
    allBounties(
      filter: { poster: { equalTo: "${POSTER_HEX}" }, status: { equalTo: "Open" } }
      orderBy: ID_ASC
      first: 500
    ) {
      totalCount
      nodes { id reward }
    }
  }`;

  const res = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`indexer responded ${res.status}`);
  }
  const body = (await res.json()) as {
    data?: { allBounties?: { totalCount: number; nodes?: OpenBountyRow[] } };
    errors?: unknown;
  };
  if (body.errors) {
    throw new Error(`indexer errors: ${JSON.stringify(body.errors)}`);
  }
  const nodes = body.data?.allBounties?.nodes ?? [];
  const total = body.data?.allBounties?.totalCount ?? 0;
  if (nodes.length !== total) {
    log({ warn: 'pagination_short_read', returned: nodes.length, totalCount: total });
  }
  return nodes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sumRewardsAtomic(rows: OpenBountyRow[]): bigint {
  return rows.reduce((acc, r) => acc + BigInt(r.reward), 0n);
}

function isTransientChainError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /disconnected|1006|WebSocket|websocket|nonce too low|Priority is too low|1014|connection|timeout|Unable to retrieve/i.test(
    msg,
  );
}

async function createChainCtx(): Promise<ChainCtx> {
  const kp = loadKeypair();
  const posterPubHex = `0x${Buffer.from(kp.publicKey).toString('hex')}`;
  if (posterPubHex.toLowerCase() !== POSTER_HEX.toLowerCase()) {
    throw new Error(
      `keystore pubkey ${posterPubHex} does not match expected poster ${POSTER_HEX} — refusing to run`,
    );
  }
  const api = await GearApi.create({ providerAddress: RPC_URL });
  await api.isReady;
  const client = new BountyMeshClient({ api, programId: PROGRAM_ID, signer: kp });
  api.on('disconnected', () => {
    log({ stage: 'api_disconnected_event' });
  });
  api.on('error', (e: unknown) => {
    log({ stage: 'api_error_event', err: e instanceof Error ? e.message : String(e) });
  });
  log({ stage: 'api_ready', rpc: RPC_URL, address: kp.address });
  return { api, client, kp };
}

async function reconnect(prev: ChainCtx | null): Promise<ChainCtx> {
  if (prev) {
    try {
      await prev.api.disconnect();
    } catch {
      // ignore disconnect errors during recovery
    }
  }
  for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
    try {
      log({ stage: 'reconnect_attempt', attempt });
      await sleep(RECONNECT_SLEEP_MS);
      const ctx = await createChainCtx();
      log({ stage: 'reconnect_ok', attempt });
      return ctx;
    } catch (err) {
      log({
        stage: 'reconnect_failed',
        attempt,
        err: err instanceof Error ? err.message : String(err),
      });
      if (attempt === MAX_RECONNECT_ATTEMPTS) {
        throw err;
      }
    }
  }
  throw new Error('unreachable');
}

async function main(): Promise<void> {
  await cryptoWaitReady();

  let rows = await fetchOpenBountyIds();
  const totalAtomicInitial = sumRewardsAtomic(rows);
  const totalVaraInitial = Number(totalAtomicInitial) / 1e12;

  log({
    stage: 'plan',
    programId: PROGRAM_ID,
    poster: POSTER_HEX,
    rpc: RPC_URL,
    indexer: INDEXER_URL,
    targetBountyCount: rows.length,
    estimatedRecoveryVara: totalVaraInitial,
    execute: EXECUTE,
    ids: rows.map((r) => r.id),
  });

  if (!EXECUTE) {
    log({ stage: 'dry_run_complete', note: 'set EXECUTE=1 to actually cancel' });
    return;
  }

  let ctx = await createChainCtx();

  const results: CancelLog[] = [];
  let successes = 0;
  let failures = 0;
  let recoveredAtomic = 0n;
  const handledIds = new Set<string>();

  let batchIndex = 0;
  while (rows.length > 0) {
    const row = rows.shift()!;
    if (handledIds.has(row.id)) {
      continue;
    }
    handledIds.add(row.id);
    batchIndex += 1;

    log({ stage: 'cancel_begin', i: batchIndex, remainingAfter: rows.length, id: row.id });
    const id = BigInt(row.id);

    let attempted = false;
    let reconnectsForThisId = 0;
    while (!attempted) {
      try {
        const r = await ctx.client.cancel(id);
        attempted = true;
        if (r.ok) {
          successes += 1;
          recoveredAtomic += BigInt(row.reward);
          const entry: CancelLog = { id: row.id, txHash: r.txHash, result: 'ok' };
          results.push(entry);
          log({ stage: 'cancel_ok', ...entry });
        } else {
          failures += 1;
          const errStr = typeof r.error === 'string' ? r.error : JSON.stringify(r.error);
          const entry: CancelLog = { id: row.id, txHash: r.txHash, result: errStr };
          results.push(entry);
          log({ stage: 'cancel_err', ...entry });
        }
      } catch (err) {
        const errStr = err instanceof Error ? err.message : String(err);
        if (isTransientChainError(err) && reconnectsForThisId < 2) {
          reconnectsForThisId += 1;
          log({
            stage: 'cancel_transient_err',
            id: row.id,
            attempt: reconnectsForThisId,
            err: errStr,
          });
          ctx = await reconnect(ctx);
          continue;
        }
        attempted = true;
        failures += 1;
        const entry: CancelLog = { id: row.id, result: `throw: ${errStr}` };
        results.push(entry);
        log({ stage: 'cancel_throw', ...entry });
      }
    }

    if (batchIndex % REFRESH_EVERY === 0) {
      log({ stage: 'refresh_begin', after: batchIndex });
      try {
        const fresh = await fetchOpenBountyIds();
        const freshFiltered = fresh.filter((r) => !handledIds.has(r.id));
        log({
          stage: 'refresh_ok',
          freshTotal: fresh.length,
          afterFilter: freshFiltered.length,
        });
        rows = freshFiltered;
      } catch (err) {
        log({
          stage: 'refresh_failed',
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (rows.length > 0) {
      await sleep(COOLDOWN_MS);
    }
  }

  log({
    stage: 'summary',
    attempted: batchIndex,
    successes,
    failures,
    recoveredVara: Number(recoveredAtomic) / 1e12,
    recoveredAtomic: recoveredAtomic.toString(),
  });

  try {
    await ctx.api.disconnect();
  } catch {
    // ignore disconnect noise
  }
}

main().catch((err) => {
  log({ stage: 'fatal', err: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
