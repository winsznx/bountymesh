/**
 * BountyMesh chat-responder.
 *
 * Polls the Vara A2A chat indexer for mentions of @bountymesh,
 * @bountymesh-rep, and @bountymesh-feeds, composes a contextual reply
 * via Groq, and posts the reply on-chain as the mentioned Application.
 * Each reply credits +5 messagesSent to the speaking app.
 *
 * Per-poll:
 *   1. Resolve `since = max(state.lastProcessed, now - 30min)`.
 *   2. Query indexer for new mentions of our 3 apps.
 *   3. For each mention, in chronological order:
 *      a. Skip if author is us / winsznx / already processed locally /
 *         already replied to per the indexer.
 *      b. Classify which of our apps speaks (feeds > rep > bountymesh).
 *      c. Fetch supplementary state for that app.
 *      d. Compose Groq reply (1-3 sentences, fact-grounded).
 *      e. Resolve the author's handle to a HandleRef and post
 *         Chat/Post(reply_body, author=Application(ourPid),
 *                   mentions=[author], reply_to=msgId).
 *      f. Mark processed in SQLite.
 *      g. Sleep 15-25s before the next reply.
 *   4. Cap at MAX_REPLIES_PER_CYCLE (default 8).
 *   5. Advance the lastProcessed cursor to the newest processed ts.
 *
 * Env (one of):
 *   CHAT_RESPONDER_KEYSTORE_BASE64 — base64 of a polkadot.js JSON keystore
 *   CHAT_RESPONDER_SEED            — sr25519 URI / mnemonic / raw hex seed
 *
 * Env (required):
 *   GROQ_API_KEY
 *
 * Env (optional, with defaults):
 *   VARA_RPC_URL              — default wss://rpc.vara.network
 *   VARA_AGENTS_PROGRAM_ID    — default 0x19f27f4c…0b353f3 (Hub mainnet)
 *   A2A_GRAPHQL_URL           — default https://agents-api.vara.network/graphql
 *   INDEXER_BASE_URL          — default https://api.bountymesh.xyz
 *   VOUCHER_URL               — default https://voucher-backend-agents.vara.network/voucher
 *   BOUNTYMESH_PROGRAM_ID     — default 0xfa09abea…
 *   BOUNTYMESH_REP_PROGRAM_ID — default 0x6b59628b…
 *   BOUNTYMESH_FEEDS_PROGRAM_ID — default 0x2b4b42db…
 *   STATE_DB_PATH             — default /app/data/state.db (Railway-ephemeral)
 *   POLL_INTERVAL_MS          — default 180000 (3 min)
 *   MAX_REPLIES_PER_CYCLE     — default 8
 *   REPLY_GAP_MS_MIN          — default 15000
 *   REPLY_GAP_MS_MAX          — default 25000
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
import { ResponderState } from './state.js';
import { findOurExistingReply, getRecentMentions, type ChatMention, type OurAppHandle } from './indexer.js';
import { composeReply } from './groq.js';
import { fetchSupplementary } from './supplementary.js';
import { postChatReply } from './post.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const RPC_URL = process.env.VARA_RPC_URL ?? 'wss://rpc.vara.network';
const VARA_AGENTS_PROGRAM_ID = (process.env.VARA_AGENTS_PROGRAM_ID
  ?? '0x19f27f4c906a5ac230be82d907850d44c7a7fff1b4c6903f62e78e09e0b353f3') as `0x${string}`;
const VOUCHER_URL = process.env.VOUCHER_URL ?? 'https://voucher-backend-agents.vara.network/voucher';
const STATE_DB_PATH = process.env.STATE_DB_PATH ?? '/app/data/state.db';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3 * 60 * 1000);
const MAX_REPLIES_PER_CYCLE = Number(process.env.MAX_REPLIES_PER_CYCLE ?? 8);
const REPLY_GAP_MS_MIN = Number(process.env.REPLY_GAP_MS_MIN ?? 15_000);
const REPLY_GAP_MS_MAX = Number(process.env.REPLY_GAP_MS_MAX ?? 25_000);

const APP_PROGRAM_IDS: Record<OurAppHandle, `0x${string}`> = {
  bountymesh: (process.env.BOUNTYMESH_PROGRAM_ID
    ?? '0xfa09abea4ac2de874bc115cfcfd0992e07636ee9f74e62a21b3750fd6f218886') as `0x${string}`,
  'bountymesh-rep': (process.env.BOUNTYMESH_REP_PROGRAM_ID
    ?? '0x6b59628b2b2f7432e4c2e714b100dcd28bc3e5c8d75358695294da989463ef03') as `0x${string}`,
  'bountymesh-feeds': (process.env.BOUNTYMESH_FEEDS_PROGRAM_ID
    ?? '0x2b4b42db048f922d8da9db2dd1d0f93ef4978a7f05eaabf1892bca7fac340ab2') as `0x${string}`,
};

const FEEDS_IDL_NAME = 'bountymesh_feeds.idl';
const AGENTS_IDL_NAME = 'agents_network_client.idl';

const OUR_HANDLES_SET = new Set<string>(['bountymesh', 'bountymesh-rep', 'bountymesh-feeds']);

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
  const keystoreB64 = process.env.CHAT_RESPONDER_KEYSTORE_BASE64;
  if (keystoreB64) {
    const json = JSON.parse(Buffer.from(keystoreB64, 'base64').toString('utf-8')) as KeyringPair$Json;
    const pair = kr.addFromJson(json);
    pair.unlock('');
    log.info({ source: 'keystore-base64', address: pair.address }, 'keypair loaded');
    return pair;
  }
  const seed = process.env.CHAT_RESPONDER_SEED;
  if (!seed) {
    log.error('one of CHAT_RESPONDER_KEYSTORE_BASE64 or CHAT_RESPONDER_SEED must be set');
    process.exit(1);
  }
  const pair = kr.addFromUri(seed);
  log.info({ source: 'seed-uri', address: pair.address }, 'keypair loaded');
  return pair;
}

function loadIdl(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', filename),
    join(here, filename),
    `/app/${filename}`,
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
  }
  throw new Error(`${filename} not found next to dist/`);
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
  if (!needsTopUp && state.voucherId) return state.voucherId;
  log.info({ reason: { missing: state.voucherId === null, missingPid, lowBalance } }, 'requesting voucher');
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

type HandleRef = { Participant: `0x${string}` } | { Application: `0x${string}` };

async function resolveHandle(sails: Sails, handle: string): Promise<HandleRef | null> {
  try {
    const qb = sails.services.Registry.queries.ResolveHandle(handle);
    const result = (await qb.call()) as HandleRef | null;
    return result;
  } catch (err) {
    log.warn({ handle, err: err instanceof Error ? err.message : String(err) }, 'resolveHandle failed');
    return null;
  }
}

/**
 * Pick which of our 3 apps replies. Priority order: feeds → rep → bountymesh.
 * Promotes the newer Applications which get less natural inbound.
 */
function classifyMention(mention: ChatMention): OurAppHandle {
  const recipients = new Set(mention.recipientHandlesInMessage);
  if (recipients.has('bountymesh-feeds')) return 'bountymesh-feeds';
  if (recipients.has('bountymesh-rep')) return 'bountymesh-rep';
  return 'bountymesh';
}

function shouldSkip(mention: ChatMention, winsznxHex: string): { skip: boolean; reason?: string } {
  if (mention.authorHandle && OUR_HANDLES_SET.has(mention.authorHandle)) {
    return { skip: true, reason: 'author is one of our apps (no self-reply)' };
  }
  if (mention.authorRef.endsWith(winsznxHex)) {
    return { skip: true, reason: 'author is winsznx (no replying to our own chat-poster posts)' };
  }
  return { skip: false };
}

function randomGap(): number {
  const span = REPLY_GAP_MS_MAX - REPLY_GAP_MS_MIN;
  if (span <= 0) return REPLY_GAP_MS_MIN;
  return REPLY_GAP_MS_MIN + Math.floor(Math.random() * span);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollAndRespond(args: {
  state: ResponderState;
  sails: Sails;
  feedsSails: Sails | null;
  signer: KeyringPair;
  voucherId: `0x${string}`;
  winsznxHex: string;
}): Promise<void> {
  const { state, sails, feedsSails, signer, voucherId, winsznxHex } = args;
  const lastProcessed = state.getLastProcessedAt();
  const fallback = new Date(Date.now() - 30 * 60 * 1000);
  const since = lastProcessed && lastProcessed > fallback ? lastProcessed : fallback;
  log.info({ since: since.toISOString() }, 'polling for mentions');

  let mentions: ChatMention[];
  try {
    mentions = await getRecentMentions(since, 50);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'indexer query failed; skipping cycle');
    return;
  }
  if (mentions.length === 0) {
    log.info('no new mentions');
    return;
  }
  log.info({ count: mentions.length }, 'mentions returned');

  let repliesThisCycle = 0;
  let newestProcessedTs: Date | null = null;

  for (const m of mentions) {
    if (repliesThisCycle >= MAX_REPLIES_PER_CYCLE) {
      log.info({ cap: MAX_REPLIES_PER_CYCLE }, 'reply cap reached this cycle');
      break;
    }

    const skip = shouldSkip(m, winsznxHex);
    if (skip.skip) {
      log.debug({ msgId: m.messageId, reason: skip.reason }, 'skip mention');
      continue;
    }
    if (state.wasProcessed(m.messageId)) {
      log.debug({ msgId: m.messageId }, 'already processed locally');
      continue;
    }
    if (await findOurExistingReply(m.msgId)) {
      log.info({ msgId: m.msgId }, 'cross-deploy dedup hit; marking processed');
      state.markProcessed(m.messageId, 'cross-deploy-dedup', classifyMention(m));
      continue;
    }

    const ourApp = classifyMention(m);
    log.info(
      { msgId: m.messageId, author: m.authorHandle, ourApp, bodyPreview: m.body.slice(0, 80) },
      'composing reply',
    );

    let replyBody: string;
    try {
      const supp = await fetchSupplementary(ourApp, feedsSails);
      replyBody = await composeReply({
        originalMessage: m.body,
        mentionedApp: ourApp,
        authorHandle: m.authorHandle,
        supplementaryState: supp,
      });
    } catch (err) {
      log.warn(
        { msgId: m.messageId, err: err instanceof Error ? err.message : String(err) },
        'compose failed; skipping this mention',
      );
      continue;
    }

    if (!replyBody || replyBody.length < 20) {
      log.warn({ msgId: m.messageId, replyBody }, 'reply too short; skipping');
      continue;
    }

    let mentionRefs: HandleRef[] = [];
    if (m.authorHandle) {
      const ref = await resolveHandle(sails, m.authorHandle);
      if (ref) mentionRefs = [ref];
    }

    try {
      const result = await postChatReply(sails, signer, voucherId, {
        ourApp,
        ourAppProgramId: APP_PROGRAM_IDS[ourApp],
        replyBody,
        replyToMsgId: BigInt(m.msgId),
        mentionRefs,
      });
      state.markProcessed(m.messageId, result.msgId, ourApp);
      // `m.ts` is epoch-millis (string) from the indexer; coerce safely.
      const tsNum = Number(m.ts);
      newestProcessedTs = Number.isFinite(tsNum) ? new Date(tsNum) : new Date();
      repliesThisCycle += 1;
      log.info(
        {
          op: 'reply_posted',
          replyToMsgId: m.msgId,
          ourReplyMsgId: result.msgId,
          ourApp,
          author: m.authorHandle,
          txHash: result.txHash,
          replyPreview: replyBody.slice(0, 100),
        },
        'reply posted on-chain',
      );
    } catch (err) {
      log.error(
        { msgId: m.messageId, err: err instanceof Error ? err.message : String(err) },
        'reply post failed; skipping',
      );
      continue;
    }

    await sleep(randomGap());
  }

  if (newestProcessedTs) {
    state.setLastProcessedAt(newestProcessedTs);
  }
  log.info(
    { replies: repliesThisCycle, totalToday: state.countRepliesToday() },
    'cycle complete',
  );
}

async function main(): Promise<void> {
  required('GROQ_API_KEY');

  log.info(
    { rpcUrl: RPC_URL, hub: VARA_AGENTS_PROGRAM_ID, pollIntervalMs: POLL_INTERVAL_MS },
    'chat-responder starting',
  );

  await cryptoWaitReady();
  const kp = loadKeypair();
  const operatorHex = `0x${Buffer.from(kp.publicKey).toString('hex')}` as `0x${string}`;
  log.info({ operator: operatorHex }, 'operator pubkey resolved');

  const api = await GearApi.create({ providerAddress: RPC_URL });
  await api.isReady;
  log.info('chain api ready');

  const parser = await SailsIdlParser.new();
  const sails = new Sails(parser);
  sails.parseIdl(loadIdl(AGENTS_IDL_NAME));
  sails.setApi(api);
  sails.setProgramId(VARA_AGENTS_PROGRAM_ID);
  log.info({ chatMethods: Object.keys(sails.services.Chat.functions) }, 'agents sails parsed');

  let feedsSails: Sails | null = null;
  try {
    const feedsParser = await SailsIdlParser.new();
    const fSails = new Sails(feedsParser);
    fSails.parseIdl(loadIdl(FEEDS_IDL_NAME));
    fSails.setApi(api);
    fSails.setProgramId(APP_PROGRAM_IDS['bountymesh-feeds']);
    feedsSails = fSails;
    log.info('feeds sails parsed; total-routed query available');
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'feeds sails init failed; bountymesh-feeds replies use zero-defaults');
  }

  let voucherId = (await ensureVoucher(operatorHex, VARA_AGENTS_PROGRAM_ID)) as `0x${string}`;
  let lastVoucherCheck = Date.now();

  const state = new ResponderState(STATE_DB_PATH);
  log.info({ dbPath: STATE_DB_PATH }, 'state opened');

  // The operator (winsznx) is the only Participant of all 3 of our Applications.
  // We use the operator's hex to detect messages authored by our own chat-poster
  // (which posts under Application(bountymesh) signed by the same operator).
  const winsznxHex = operatorHex.toLowerCase();

  let shuttingDown = false;
  const stop = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutdown signal received');
    state.close();
    void api.disconnect().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

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
      await pollAndRespond({ state, sails, feedsSails, signer: kp, voucherId, winsznxHex });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'cycle failed');
    }

    const elapsed = Date.now() - cycleStart;
    const remaining = Math.max(0, POLL_INTERVAL_MS - elapsed);
    log.info({ elapsedMs: elapsed, nextInMs: remaining }, 'sleeping until next poll');
    await sleep(remaining);
  }
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : String(err) }, 'chat-responder crashed');
  process.exit(1);
});
