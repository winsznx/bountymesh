/**
 * A2A chat-poster cron service.
 *
 * Posts a message to the Vara Agent Network Chat service every
 * CHAT_INTERVAL_MS (default 15 min). Each cycle:
 *   1. Query the BountyMesh indexer for Open bounties.
 *   2. If ≥1 found: pick the newest unposted one, match it against the
 *      Vara A2A peer pool (capability tags), draw an invitation template,
 *      compose the body + mention list.
 *   3. If 0 found OR all Open bounties already posted twice: fall back
 *      to a generic announcement template.
 *   4. Post via Registry/Chat with author = Application(bountymesh PID),
 *      voucher-paid (the bountymesh Application's own voucher).
 *
 * Per-bounty dedupe cap: at most 2 invitation posts per bounty across
 * the bounty's lifecycle. State is in-process Map (resets on restart;
 * acceptable since the metrics-freeze window is bounded and the
 * indexer is the source of truth for "what's Open").
 *
 * Voucher: A2A Hub is a whitelisted program, so gas is voucher-paid.
 * On startup + once per hour, the service POSTs to the voucher backend
 * to ensure the wallet has a funded voucher covering $PID.
 *
 * Env (one of these two is required):
 *   CHAT_POSTER_KEYSTORE_BASE64 — base64 of a polkadot.js / vara-wallet
 *                                 JSON keystore (unencrypted)
 *   CHAT_POSTER_SEED            — sr25519 URI / mnemonic / raw seed hex
 *
 * Env (required):
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
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair, KeyringPair$Json } from '@polkadot/keyring/types';
import { Sails } from 'sails-js';
import { SailsIdlParser } from 'sails-js-parser';
import pino from 'pino';
import {
  MENTION_POOL,
  pickGenericMentions,
  pickGenericTemplate,
  pickInvitationTemplate,
  renderGeneric,
  renderInvitation,
  renderOldestOpen,
  renderRecentWithdraw,
  type InvitationContext,
  type OldestOpen,
  type RecentWithdraw,
} from './templates.js';
import { matchAgents } from './agent-tags.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const BOUNTYMESH_PROGRAM_ID = required('BOUNTYMESH_PROGRAM_ID') as `0x${string}`;
const VARA_AGENTS_PROGRAM_ID = (process.env.VARA_AGENTS_PROGRAM_ID
  ?? '0x19f27f4c906a5ac230be82d907850d44c7a7fff1b4c6903f62e78e09e0b353f3') as `0x${string}`;
const RPC_URL = process.env.VARA_RPC_URL ?? 'wss://rpc.vara.network';
const AGENTS_IDL_URL = process.env.AGENTS_IDL_URL
  ?? 'https://raw.githubusercontent.com/gear-foundation/vara-agent-network/main/agent-starter/idl/agents_network_client.idl';
const VOUCHER_URL = process.env.VOUCHER_URL ?? 'https://voucher-backend-agents.vara.network/voucher';
const INDEXER_BASE_URL = process.env.INDEXER_BASE_URL ?? 'https://api.bountymesh.xyz';
const CHAT_INTERVAL_MS = Number(process.env.CHAT_INTERVAL_MS ?? 15 * 60 * 1000);
const MAX_INVITATIONS_PER_BOUNTY = Number(process.env.MAX_INVITATIONS_PER_BOUNTY ?? 2);

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
  const keystoreB64 = process.env.CHAT_POSTER_KEYSTORE_BASE64;
  if (keystoreB64) {
    const json = JSON.parse(Buffer.from(keystoreB64, 'base64').toString('utf-8')) as KeyringPair$Json;
    const pair = kr.addFromJson(json);
    pair.unlock('');
    log.info({ source: 'keystore-base64', address: pair.address }, 'keypair loaded');
    return pair;
  }
  const seed = process.env.CHAT_POSTER_SEED;
  if (!seed) {
    log.error('one of CHAT_POSTER_KEYSTORE_BASE64 or CHAT_POSTER_SEED must be set');
    process.exit(1);
  }
  const pair = kr.addFromUri(seed);
  log.info({ source: 'seed-uri', address: pair.address }, 'keypair loaded');
  return pair;
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

interface OpenBounty {
  id: string;
  title: string;
  description: string;
  track: string;
  reward: string;
}

async function fetchOpenBounties(): Promise<OpenBounty[]> {
  const query = `{
    allBounties(filter: { status: { equalTo: "Open" } }, orderBy: POSTED_AT_DESC, first: 10) {
      nodes { id title description track reward }
    }
  }`;
  try {
    const res = await fetch(`${INDEXER_BASE_URL}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'indexer query non-200');
      return [];
    }
    const body = (await res.json()) as { data?: { allBounties?: { nodes?: OpenBounty[] } } };
    return body.data?.allBounties?.nodes ?? [];
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'indexer query failed');
    return [];
  }
}

function pickBountyForInvitation(
  bounties: OpenBounty[],
  invitationCounts: Map<string, number>,
): OpenBounty | null {
  for (const b of bounties) {
    const count = invitationCounts.get(b.id) ?? 0;
    if (count < MAX_INVITATIONS_PER_BOUNTY) return b;
  }
  return null;
}

interface IndexerHealth {
  status: string;
  lastFinalizedBlock: number;
  headBlock: number;
}

async function fetchHead(): Promise<number | null> {
  try {
    const res = await fetch(`${INDEXER_BASE_URL}/health`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as IndexerHealth;
    return body.headBlock ?? null;
  } catch {
    return null;
  }
}

async function fetchRecentWithdraw(): Promise<RecentWithdraw | null> {
  const query = `{
    allBounties(filter: { withdrawn: { equalTo: true } }, orderBy: WITHDRAWN_AT_DESC, first: 1) {
      nodes { id reward worker postedAt withdrawnAt }
    }
  }`;
  try {
    const res = await fetch(`${INDEXER_BASE_URL}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { allBounties?: { nodes?: Array<{ id: string; reward: string; worker: string | null; postedAt: string | number; withdrawnAt: string | number | null }> } };
    };
    const node = body.data?.allBounties?.nodes?.[0];
    if (!node || !node.worker || node.withdrawnAt === null) return null;
    const posted = Number(node.postedAt);
    const withdrawn = Number(node.withdrawnAt);
    const blocks = Math.max(0, withdrawn - posted);
    const durationMinutes = Math.max(1, Math.round((blocks * 6) / 60));
    const w = node.worker;
    return {
      bountyId: node.id,
      rewardAtomic: BigInt(node.reward),
      workerShortHex: `${w.slice(0, 8)}…${w.slice(-4)}`,
      durationMinutes,
    };
  } catch {
    return null;
  }
}

async function fetchOldestOpen(head: number | null): Promise<OldestOpen | null> {
  const query = `{
    allBounties(filter: { status: { equalTo: "Open" } }, orderBy: POSTED_AT_ASC, first: 1) {
      nodes { id title description track reward postedAt }
    }
  }`;
  try {
    const res = await fetch(`${INDEXER_BASE_URL}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { allBounties?: { nodes?: Array<{ id: string; title: string; description: string; track: string; reward: string; postedAt: string | number }> } };
    };
    const node = body.data?.allBounties?.nodes?.[0];
    if (!node) return null;
    const posted = Number(node.postedAt);
    const hoursOpen = head ? Math.max(0, Math.round(((head - posted) * 6) / 3600)) : 0;
    return {
      bountyId: node.id,
      title: node.title,
      rewardAtomic: BigInt(node.reward),
      track: node.track,
      hoursOpen,
      matchedAgents: matchAgents({ track: node.track, title: node.title, description: node.description }),
    };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  log.info({ rpcUrl: RPC_URL, hub: VARA_AGENTS_PROGRAM_ID, intervalMs: CHAT_INTERVAL_MS }, 'chat-poster starting');

  await cryptoWaitReady();
  const kp = loadKeypair();
  const operatorHex = `0x${Buffer.from(kp.publicKey).toString('hex')}` as `0x${string}`;
  log.info({ operator: operatorHex }, 'operator pubkey resolved');

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

  /** bounty_id → invitations already posted across this process lifetime */
  const invitationCounts = new Map<string, number>();

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
      let posted = false;

      // Rotate modes: even cycles favour data-driven (recent settle / oldest
      // open), odd cycles favour invitation. Each branch independently falls
      // through to the next on no-data.
      const preferDataDriven = cycleIndex % 2 === 0;

      const head = await fetchHead();

      if (preferDataDriven) {
        // Prefer "Just settled" when there's been a recent withdraw; fall
        // back to "Open Nh" on the oldest currently-Open bounty.
        const recent = await fetchRecentWithdraw();
        if (recent) {
          const body = renderRecentWithdraw(recent, cycleIndex);
          // No mentions on settle-narration posts — let the data carry it.
          await postChat(sails, kp, voucherId, body, author, []);
          posted = true;
          log.info({ op: 'data_driven_settle', bountyId: recent.bountyId }, 'posted recent-withdraw narration');
        } else {
          const oldest = await fetchOldestOpen(head);
          if (oldest) {
            const matched = oldest.matchedAgents.filter((h) => resolvedHandles.includes(h));
            const { body, mentions: pickedHandles } = renderOldestOpen(
              { ...oldest, matchedAgents: matched },
              cycleIndex,
            );
            const pickedRefs = pickedHandles.map((h) => mentions.get(h)!.ref);
            await postChat(sails, kp, voucherId, body, author, pickedRefs);
            posted = true;
            log.info({ op: 'data_driven_oldest_open', bountyId: oldest.bountyId, hours: oldest.hoursOpen }, 'posted oldest-open narration');
          }
        }
      }

      if (!posted) {
        const openBounties = await fetchOpenBounties();
        const candidate = pickBountyForInvitation(openBounties, invitationCounts);

        if (candidate) {
          const matched = matchAgents({
            track: candidate.track,
            title: candidate.title,
            description: candidate.description,
          }).filter((h) => resolvedHandles.includes(h));

          if (matched.length > 0) {
            const tmpl = pickInvitationTemplate(cycleIndex);
            const ctx: InvitationContext = {
              bountyId: candidate.id,
              title: candidate.title,
              track: candidate.track,
              rewardAtomic: BigInt(candidate.reward),
              matchedAgents: matched,
            };
            const { body, mentions: pickedHandles } = renderInvitation(tmpl, ctx, cycleIndex);
            const pickedRefs = pickedHandles.map((h) => mentions.get(h)!.ref);
            await postChat(sails, kp, voucherId, body, author, pickedRefs);
            invitationCounts.set(candidate.id, (invitationCounts.get(candidate.id) ?? 0) + 1);
            posted = true;
            log.info(
              { op: 'invitation', bountyId: candidate.id, total: invitationCounts.get(candidate.id) },
              'invitation posted',
            );
          }
        }
      }

      if (!posted) {
        const tmpl = pickGenericTemplate(cycleIndex);
        const pickedHandles = pickGenericMentions(cycleIndex, tmpl.mentionCount).filter((h) => resolvedHandles.includes(h));
        const pickedRefs = pickedHandles.map((h) => mentions.get(h)!.ref);
        const body = renderGeneric(tmpl, cycleIndex);
        await postChat(sails, kp, voucherId, body, author, pickedRefs);
        log.info({ op: 'generic_fallback' }, 'posted generic fallback');
      }
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

// Reference imports so they're not flagged unused after dead-code elimination.
void MENTION_POOL;

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : String(err) }, 'chat-poster crashed');
  process.exit(1);
});
