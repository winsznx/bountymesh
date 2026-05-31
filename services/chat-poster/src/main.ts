/**
 * A2A chat-poster cron service.
 *
 * Posts a message to the Vara Agent Network Chat service every
 * CHAT_INTERVAL_MS (default 15 min). Each post:
 *   - author = Application(BountyMesh program id) — winsznx is the
 *     attested operator; auth check passes for the signing wallet.
 *   - mentions = 1-3 rotating handles from the Track-03 peer pool,
 *     resolved to HandleRef via Registry/ResolveHandle at boot.
 *   - body = rotating template with cycle-index distinguishability.
 *
 * Voucher: A2A Hub is a whitelisted program, so gas is voucher-paid.
 * On startup + once per hour, the service POSTs to the voucher backend
 * to ensure the wallet has a funded voucher covering $PID.
 *
 * Env (required):
 *   CHAT_POSTER_SEED          — sr25519 URI/mnemonic for the signing wallet
 *                               (must be the operator wallet of BOUNTYMESH_PROGRAM_ID)
 *   BOUNTYMESH_PROGRAM_ID     — Application program id for author=Application(.)
 *
 * Env (optional):
 *   VARA_AGENTS_PROGRAM_ID    — default 0x19f27f4c…0b353f3 (mainnet Hub)
 *   VARA_RPC_URL              — default wss://rpc.vara.network
 *   AGENTS_IDL_URL            — default raw.githubusercontent.com/.../agents_network_client.idl
 *   VOUCHER_URL               — default voucher-backend-agents.vara.network/voucher
 *   CHAT_INTERVAL_MS          — default 900000 (15 min)
 *   LOG_LEVEL                 — default info
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GearApi } from '@gear-js/api';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { Sails } from 'sails-js';
import { SailsIdlParser } from 'sails-js-parser';
import pino from 'pino';
import { CHAT_TEMPLATES, MENTION_POOL, pickMentions, pickTemplate, renderBody } from './templates.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const CHAT_POSTER_SEED = required('CHAT_POSTER_SEED');
const BOUNTYMESH_PROGRAM_ID = required('BOUNTYMESH_PROGRAM_ID') as `0x${string}`;
const VARA_AGENTS_PROGRAM_ID = (process.env.VARA_AGENTS_PROGRAM_ID
  ?? '0x19f27f4c906a5ac230be82d907850d44c7a7fff1b4c6903f62e78e09e0b353f3') as `0x${string}`;
const RPC_URL = process.env.VARA_RPC_URL ?? 'wss://rpc.vara.network';
const AGENTS_IDL_URL = process.env.AGENTS_IDL_URL
  ?? 'https://raw.githubusercontent.com/gear-foundation/vara-agent-network/main/agent-starter/idl/agents_network_client.idl';
const VOUCHER_URL = process.env.VOUCHER_URL ?? 'https://voucher-backend-agents.vara.network/voucher';
const CHAT_INTERVAL_MS = Number(process.env.CHAT_INTERVAL_MS ?? 15 * 60 * 1000);

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
  return kr.addFromUri(CHAT_POSTER_SEED);
}

async function loadAgentsIdl(): Promise<string> {
  // Prefer the repo-local IDL if present (Docker COPY drops it next to dist/).
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', 'agents_network_client.idl'),
    join(here, 'agents_network_client.idl'),
    '/app/agents_network_client.idl',
  ]) {
    if (existsSync(candidate)) {
      log.info({ idlPath: candidate }, 'loading IDL from disk');
      return readFileSync(candidate, 'utf-8');
    }
  }
  log.info({ idlUrl: AGENTS_IDL_URL }, 'fetching IDL from network');
  const res = await fetch(AGENTS_IDL_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`agents IDL fetch failed: HTTP ${res.status}`);
  return res.text();
}

interface VoucherState {
  voucherId: string | null;
  programs: string[];
  varaBalance: string;
  balanceKnown: boolean;
  canTopUpNow: boolean;
}

async function ensureVoucher(operatorHex: string, programHex: string): Promise<string> {
  const stateRes = await fetch(`${VOUCHER_URL}/${operatorHex}`);
  const state = (await stateRes.json()) as VoucherState;
  const lowBalance = state.balanceKnown && BigInt(state.varaBalance) < 10_000_000_000_000n;
  const missingPid = !state.programs.includes(programHex);
  const needsTopUp = state.voucherId === null || missingPid || (lowBalance && state.canTopUpNow);
  if (!needsTopUp && state.voucherId) {
    return state.voucherId;
  }
  log.info({ reason: { missing: state.voucherId === null, missingPid, lowBalance } }, 'requesting fresh voucher');
  const post = await fetch(VOUCHER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: operatorHex, programs: [programHex] }),
  });
  if (!post.ok && post.status !== 201) {
    throw new Error(`voucher POST failed: HTTP ${post.status} ${await post.text()}`);
  }
  const issued = (await post.json()) as { voucherId: string };
  log.info({ voucherId: issued.voucherId }, 'new voucher issued');
  return issued.voucherId;
}

interface ResolvedHandle {
  handle: string;
  ref: { Participant: `0x${string}` } | { Application: `0x${string}` };
}

async function resolveHandles(sails: Sails, handles: string[]): Promise<Map<string, ResolvedHandle>> {
  const resolved = new Map<string, ResolvedHandle>();
  for (const handle of handles) {
    try {
      const qb = sails.services.Registry.queries.ResolveHandle(handle);
      const result = (await qb.atBlock(null).call()) as ResolvedHandle['ref'] | null;
      if (result) {
        resolved.set(handle, { handle, ref: result });
      } else {
        log.warn({ handle }, 'handle not resolved — skipping');
      }
    } catch (err) {
      log.warn({ handle, err: err instanceof Error ? err.message : String(err) }, 'resolve failed');
    }
  }
  log.info({ resolved: resolved.size, requested: handles.length }, 'mention pool resolved');
  return resolved;
}

async function postChat(
  sails: Sails,
  signer: KeyringPair,
  voucherId: `0x${string}`,
  body: string,
  author: ResolvedHandle['ref'],
  mentions: ResolvedHandle['ref'][],
): Promise<void> {
  const tx = sails.services.Chat.functions.Post(body, author, mentions, null);
  tx.withAccount(signer);
  tx.withVoucher(voucherId);
  await tx.calculateGas();
  const sent = await tx.signAndSend();
  const reply = await sent.response();
  log.info(
    { op: 'chat_posted', body: body.slice(0, 80), mentions: mentions.length, postId: String(reply), txHash: sent.txHash, blockHash: sent.blockHash },
    'chat posted',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  log.info({ rpcUrl: RPC_URL, hub: VARA_AGENTS_PROGRAM_ID, intervalMs: CHAT_INTERVAL_MS }, 'chat-poster starting');

  const kp = loadKeypair();
  const operatorHex = `0x${Buffer.from(kp.publicKey).toString('hex')}` as `0x${string}`;
  log.info({ operator: operatorHex }, 'keypair loaded');

  const api = await GearApi.create({ providerAddress: RPC_URL });
  await api.isReady;
  log.info('chain api ready');

  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);
  sails.parseIdl(await loadAgentsIdl());
  sails.setApi(api);
  sails.setProgramId(VARA_AGENTS_PROGRAM_ID);
  log.info({ chatMethods: Object.keys(sails.services.Chat.functions) }, 'sails parsed');

  const mentions = await resolveHandles(sails, MENTION_POOL);
  if (mentions.size === 0) {
    log.error('no mentions resolvable; aborting');
    process.exit(1);
  }
  const resolvedHandles = Array.from(mentions.keys());

  const author: ResolvedHandle['ref'] = { Application: BOUNTYMESH_PROGRAM_ID };

  let voucherId = (await ensureVoucher(operatorHex, VARA_AGENTS_PROGRAM_ID)) as `0x${string}`;
  let lastVoucherCheck = Date.now();

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

    if (Date.now() - lastVoucherCheck > 60 * 60 * 1000) {
      try {
        voucherId = (await ensureVoucher(operatorHex, VARA_AGENTS_PROGRAM_ID)) as `0x${string}`;
        lastVoucherCheck = Date.now();
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, 'voucher refresh failed; keeping old voucher');
      }
    }

    try {
      const tmpl = pickTemplate(cycleIndex);
      const pickedHandles = pickMentions(cycleIndex, tmpl.mentionCount).filter((h) => resolvedHandles.includes(h));
      const pickedRefs = pickedHandles.map((h) => mentions.get(h)!.ref);
      const body = renderBody(tmpl, cycleIndex);
      await postChat(sails, kp, voucherId, body, author, pickedRefs);
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err), cycleIndex }, 'chat post failed');
    }

    cycleIndex += 1;
    const elapsed = Date.now() - cycleStart;
    const remaining = Math.max(0, CHAT_INTERVAL_MS - elapsed);
    log.info({ cycleIndex, elapsedMs: elapsed, nextInMs: remaining }, 'cycle complete; sleeping');
    await sleep(remaining);
  }
}

// Reference the imports so they're not flagged as unused if dead-code-eliminated.
void CHAT_TEMPLATES;

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : String(err) }, 'chat-poster crashed');
  process.exit(1);
});
