/**
 * Bounty cycler — posts BountyMesh bounties on a 30-minute loop + accepts
 * any of its own bounties that reach Submitted state. The worker daemon
 * (separate Railway service, separate seed) does Claim + Submit + Withdraw
 * asynchronously, so this service only owns the poster side.
 *
 * Lifecycle per cycle:
 *   1. Post a 0.5 VARA bounty (rotating track + template)
 *   2. Sleep 60s (gives worker time to Claim + Submit)
 *   3. Poll indexer for own Submitted bounties; Accept each (idempotent)
 *   4. Sleep remainder of the 30-min window
 *
 * Env (one of these two is required):
 *   BOUNTYMESH_POSTER_KEYSTORE_BASE64  — base64 of a polkadot.js / vara-wallet
 *                                         JSON keystore (unencrypted)
 *   BOUNTYMESH_POSTER_SEED             — sr25519 URI / mnemonic / raw seed hex
 *
 * Env:
 *   BOUNTYMESH_PROGRAM_ID    — 0x-prefixed program id of BountyMesh v2
 *   VARA_RPC_URL             — wss endpoint (mainnet)
 *   INDEXER_BASE_URL         — public indexer base (default api.bountymesh.xyz)
 *   CYCLE_INTERVAL_MS        — override loop interval (default 1800000 = 30min)
 *   POST_REWARD_ATOMIC       — reward per bounty (default 500_000_000_000 = 0.5 VARA)
 */

import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair, KeyringPair$Json } from '@polkadot/keyring/types';
import { BountyMeshClient, type Track } from '@bountymesh/sdk';
import pino from 'pino';
import { BOUNTY_TEMPLATES, type BountyTemplate } from './templates.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const PROGRAM_ID = required('BOUNTYMESH_PROGRAM_ID') as `0x${string}`;
const RPC_URL = process.env.VARA_RPC_URL ?? 'wss://rpc.vara.network';
const INDEXER_BASE = process.env.INDEXER_BASE_URL ?? 'https://api.bountymesh.xyz';
const CYCLE_INTERVAL_MS = Number(process.env.CYCLE_INTERVAL_MS ?? 30 * 60 * 1000);
const POST_REWARD_ATOMIC = BigInt(process.env.POST_REWARD_ATOMIC ?? '500000000000');
const POST_TO_ACCEPT_DELAY_MS = Number(process.env.POST_TO_ACCEPT_DELAY_MS ?? 60_000);

const TRACK_ROTATION: Track[] = ['Services', 'Economy', 'Open'];

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    log.error({ env: name }, 'required env var missing');
    process.exit(1);
  }
  return v;
}

function loadKeypair(): KeyringPair {
  const kr = new Keyring({ type: 'sr25519' });
  const keystoreB64 = process.env.BOUNTYMESH_POSTER_KEYSTORE_BASE64;
  if (keystoreB64) {
    const json = JSON.parse(Buffer.from(keystoreB64, 'base64').toString('utf-8')) as KeyringPair$Json;
    const pair = kr.addFromJson(json);
    pair.unlock('');
    log.info({ source: 'keystore-base64', address: pair.address }, 'keypair loaded');
    return pair;
  }
  const seed = process.env.BOUNTYMESH_POSTER_SEED;
  if (!seed) {
    log.error('one of BOUNTYMESH_POSTER_KEYSTORE_BASE64 or BOUNTYMESH_POSTER_SEED must be set');
    process.exit(1);
  }
  const pair = kr.addFromUri(seed);
  log.info({ source: 'seed-uri', address: pair.address }, 'keypair loaded');
  return pair;
}

function pickTemplate(cycleIndex: number): BountyTemplate {
  return BOUNTY_TEMPLATES[cycleIndex % BOUNTY_TEMPLATES.length];
}

function pickTrack(cycleIndex: number): Track {
  return TRACK_ROTATION[cycleIndex % TRACK_ROTATION.length];
}

async function postBounty(client: BountyMeshClient, tmpl: BountyTemplate, track: Track, cycleIndex: number): Promise<bigint | null> {
  const title = `${tmpl.title} — cycle ${cycleIndex}`;
  log.info({ op: 'post', title, track, reward: POST_REWARD_ATOMIC.toString() }, 'posting bounty');
  const res = await client.post({
    title,
    description: tmpl.description,
    acceptance: tmpl.acceptance,
    reward: POST_REWARD_ATOMIC,
    track,
  });
  if (!res.ok) {
    log.error({ op: 'post_failed', error: res.error, txHash: res.txHash }, 'post failed');
    return null;
  }
  log.info({ op: 'post_ok', bountyId: res.value.bountyId.toString(), txHash: res.txHash }, 'bounty posted');
  return res.value.bountyId;
}

interface SubmittedBounty {
  id: string;
  status: string;
}

async function fetchOwnSubmitted(posterHex: string): Promise<SubmittedBounty[]> {
  const q = `{
    allBounties(filter: { poster: { equalTo: "${posterHex}" }, status: { equalTo: "Submitted" } }) {
      nodes { id status }
    }
  }`;
  const res = await fetch(`${INDEXER_BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: q }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    log.warn({ status: res.status }, 'indexer poll non-200');
    return [];
  }
  const body = (await res.json()) as { data?: { allBounties?: { nodes?: SubmittedBounty[] } } };
  return body.data?.allBounties?.nodes ?? [];
}

async function acceptSubmitted(client: BountyMeshClient, bounties: SubmittedBounty[]): Promise<void> {
  for (const b of bounties) {
    const id = BigInt(b.id);
    log.info({ op: 'accept', bountyId: id.toString() }, 'accepting submitted bounty');
    const res = await client.accept(id);
    if (!res.ok) {
      log.warn({ op: 'accept_failed', bountyId: id.toString(), error: res.error }, 'accept failed');
      continue;
    }
    log.info({ op: 'accept_ok', bountyId: id.toString(), txHash: res.txHash }, 'bounty accepted');
  }
}

async function runCycle(client: BountyMeshClient, posterHex: string, cycleIndex: number): Promise<void> {
  const tmpl = pickTemplate(cycleIndex);
  const track = pickTrack(cycleIndex);
  await postBounty(client, tmpl, track, cycleIndex);
  await sleep(POST_TO_ACCEPT_DELAY_MS);
  const submitted = await fetchOwnSubmitted(posterHex);
  if (submitted.length > 0) {
    log.info({ op: 'submitted_found', count: submitted.length }, 'submitted bounties detected');
    await acceptSubmitted(client, submitted);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  log.info({ rpcUrl: RPC_URL, programId: PROGRAM_ID, intervalMs: CYCLE_INTERVAL_MS }, 'bounty-cycler starting');
  await cryptoWaitReady();
  const kp = loadKeypair();
  const posterHex = `0x${Buffer.from(kp.publicKey).toString('hex')}`;
  log.info({ poster: posterHex }, 'poster pubkey resolved');

  const api = await GearApi.create({ providerAddress: RPC_URL });
  await api.isReady;
  log.info('chain api ready');

  const client = new BountyMeshClient({ api, programId: PROGRAM_ID, signer: kp });

  let shuttingDown = false;
  const stop = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutdown signal received');
    void api.disconnect().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  let cycleIndex = 0;
  while (!shuttingDown) {
    const cycleStart = Date.now();
    try {
      await runCycle(client, posterHex, cycleIndex);
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err), cycleIndex }, 'cycle failed');
    }
    cycleIndex += 1;
    const elapsed = Date.now() - cycleStart;
    const remaining = Math.max(0, CYCLE_INTERVAL_MS - elapsed);
    log.info({ cycleIndex, elapsedMs: elapsed, nextInMs: remaining }, 'cycle complete; sleeping');
    await sleep(remaining);
  }
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : String(err) }, 'bounty-cycler crashed');
  process.exit(1);
});
