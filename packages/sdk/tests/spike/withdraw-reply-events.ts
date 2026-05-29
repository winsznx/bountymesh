/**
 * Spike: Withdraw reply-event enumeration.
 *
 * Question: does the contract's Withdraw call — which uses
 * `CommandReply::new(Ok(())).with_value(value + reward)` per the locked
 * primitive in MASTER_PRD §8 — cause Gear to emit a SEPARATE
 * `gear.MessageQueued` event with `source = bountymesh_program` and
 * `destination = worker_account`, distinct from the inbound
 * `bob → program` MessageQueued for the Withdraw extrinsic itself?
 *
 * If yes: the worker wallet, registered as a Hub Application, would accrue
 * +25 score per Withdraw under the Season 1 formula (calls × 25 +
 * mentions × 10 + messages × 5 + active_posts × 3 where calls =
 * app_metrics.integrations_in only — operator-confirmed via Grok). Register
 * worker as Participant + Application at Phase 6.
 *
 * If no: the reply value is delivered inline through the original Bob → program
 * dispatch's reply path (typically UserMessageSent only). Worker accrues nothing
 * extra from being an Application. Stay Participant-only.
 *
 * Methodology: deploy, run full 5-call lifecycle (Post → Claim → Submit →
 * Accept → Withdraw), enumerate ALL `gear.*` events in each per-call block via
 * `api.query.system.events.at(blockHash)` (deterministic post-hoc lookup —
 * avoids live subscription races). Print the full table, then apply the
 * decision rule to the Withdraw block in isolation.
 *
 * Run from packages/sdk/: `npx tsx tests/spike/withdraw-reply-events.ts`
 */

import { u8aToHex } from '@polkadot/util';
import { decodeAddress } from '@polkadot/util-crypto';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';

import { BountyMeshClient } from '../../src/client.js';
import { deployBountyMesh } from '../harness/deployProgram.js';
import {
  alice,
  balanceOf,
  bob,
  disconnectApi,
  getApi,
  initDevSigners,
} from '../harness/devSigners.js';
import { startLocalNode } from '../harness/localNode.js';

interface GearEventSnapshot {
  blockNumber: number;
  blockHash: HexString;
  method: string;
  source: string | null;
  destination: string | null;
  entry: string | null;
  value: string | null;
  rawJson: string;
}

const MIN_REWARD = 1_000_000_000_000n;
const REWARD = 2_000_000_000_000n;

interface PolkadotEventRecord {
  event: {
    section: string;
    method: string;
    data: {
      toJSON: () => unknown;
      toHuman: () => unknown;
    };
  };
}

interface ExtractedFields {
  source: string | null;
  destination: string | null;
  entry: string | null;
  value: string | null;
}

/**
 * Normalize an actor identifier to lowercase hex pubkey.
 *   - `0x…` (hex) → lowercased verbatim
 *   - SS58 string → decodeAddress → u8aToHex (lowercased)
 *   - on decode failure → original lowercased string (so unexpected shapes fall through visibly)
 *
 * Required because @polkadot/keyring renders SS58 with prefix 42 (Substrate default)
 * while Gear's runtime renders with the network's prefix (Vara mainnet = 137,
 * `kG…`). Same pubkey, different strings. Compare on pubkey hex.
 */
function toHexId(value: string): string {
  const lc = value.toLowerCase();
  if (lc.startsWith('0x')) return lc;
  try {
    return u8aToHex(decodeAddress(value)).toLowerCase();
  } catch {
    return lc;
  }
}

function entryFromObject(obj: unknown): string | null {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>);
    if (keys.length === 1) {
      const key = keys[0];
      return key.charAt(0).toUpperCase() + key.slice(1);
    }
    return JSON.stringify(obj);
  }
  return null;
}

/**
 * Decode source/destination/entry/value out of the polkadot-api `toJSON()` shape.
 *
 * Each gear event class serializes differently:
 *
 *   gear.MessageQueued    → [id, source_ss58, destination_hex, entry_obj]
 *                           entry_obj is one of { handle: null } | { reply: [origin, code] }
 *                                              | { init: null } | { signal: […] }
 *
 *   gear.UserMessageSent  → [message_obj, expiration_or_null]
 *                           message_obj = { id, source, destination, payload, value, details, … }
 *
 *   gear.MessagesDispatched → [total, statuses_map, state_changes]  (no per-actor fields)
 */
function extractFields(method: string, json: unknown): ExtractedFields {
  if (!Array.isArray(json)) return { source: null, destination: null, entry: null, value: null };
  if (method === 'MessageQueued' && json.length >= 4) {
    return {
      source: typeof json[1] === 'string' ? (json[1] as string) : null,
      destination: typeof json[2] === 'string' ? (json[2] as string) : null,
      entry: entryFromObject(json[3]),
      value: null,
    };
  }
  if (method === 'UserMessageSent' && json.length >= 1) {
    const msg = json[0];
    if (msg && typeof msg === 'object') {
      const m = msg as Record<string, unknown>;
      return {
        source: typeof m.source === 'string' ? (m.source as string) : null,
        destination: typeof m.destination === 'string' ? (m.destination as string) : null,
        entry: null,
        value: typeof m.value === 'string' ? (m.value as string) : null,
      };
    }
  }
  return { source: null, destination: null, entry: null, value: null };
}

async function gearEventsInBlock(
  api: GearApi,
  blockHash: HexString,
): Promise<GearEventSnapshot[]> {
  const header = await api.rpc.chain.getHeader(blockHash);
  const blockNumber = header.number.toNumber();
  const apiAt = await api.at(blockHash);
  const events = (await apiAt.query.system.events()) as unknown as PolkadotEventRecord[];

  const out: GearEventSnapshot[] = [];
  for (const record of events) {
    if (record.event.section !== 'gear') continue;
    const json = record.event.data.toJSON();
    const rawJson = JSON.stringify(json);
    const { source, destination, entry, value: valueRaw } = extractFields(
      record.event.method,
      json,
    );

    out.push({
      blockNumber,
      blockHash,
      method: record.event.method,
      source,
      destination,
      entry,
      value: valueRaw,
      rawJson,
    });
  }
  return out;
}

function belongsTo(value: string | null, aliases: Set<string>): boolean {
  if (!value) return false;
  return aliases.has(toHexId(value));
}

async function main(): Promise<void> {
  const node = await startLocalNode();
  try {
    await initDevSigners();
    const api = await getApi();
    const { programId } = await deployBountyMesh(api, alice(), {
      minReward: MIN_REWARD,
      autoSettleBlocks: 100,
    });

    const aliceClient = new BountyMeshClient({ api, programId, signer: alice() });
    const bobClient = new BountyMeshClient({ api, programId, signer: bob() });

    const bobPubkeyHex = u8aToHex(bob().publicKey).toLowerCase();
    const alicePubkeyHex = u8aToHex(alice().publicKey).toLowerCase();
    const programLc = programId.toLowerCase();

    // All aliases are stored as hex pubkeys; belongsTo normalizes the
    // incoming value (SS58 → hex) before lookup.
    const aliceAliases = new Set([alicePubkeyHex]);
    const bobAliases = new Set([bobPubkeyHex]);
    const programAliases = new Set([programLc]);

    console.log('=== programId   :', programId);
    console.log('=== alice ss58  :', alice().address);
    console.log('=== alice pubkey:', alicePubkeyHex);
    console.log('=== bob   ss58  :', bob().address);
    console.log('=== bob   pubkey:', bobPubkeyHex);

    const steps: Array<{ name: string; blockHash: HexString; txHash: HexString }> = [];

    // Step 1 — Post (alice → program; payable)
    const post = await aliceClient.post({
      title: 'spike-withdraw',
      description: 'withdraw-reply-events probe',
      acceptance: 'echo',
      reward: REWARD,
      track: 'Economy',
    });
    if (!post.ok) throw new Error(`Post failed: ${JSON.stringify(post)}`);
    steps.push({ name: 'Post', blockHash: post.blockHash, txHash: post.txHash });
    const bountyId = post.value.bountyId;
    console.log('=== bountyId    :', bountyId.toString());

    // Step 2 — Claim (bob → program)
    const claim = await bobClient.claim(bountyId);
    if (!claim.ok) throw new Error(`Claim failed: ${JSON.stringify(claim)}`);
    steps.push({ name: 'Claim', blockHash: claim.blockHash, txHash: claim.txHash });

    // Step 3 — Submit (bob → program)
    const submit = await bobClient.submit(
      bountyId,
      JSON.stringify({ v: 1, output: 'spike-output' }),
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    );
    if (!submit.ok) throw new Error(`Submit failed: ${JSON.stringify(submit)}`);
    steps.push({ name: 'Submit', blockHash: submit.blockHash, txHash: submit.txHash });

    // Step 4 — Accept (alice → program; state-flip-only, no value)
    const accept = await aliceClient.accept(bountyId);
    if (!accept.ok) throw new Error(`Accept failed: ${JSON.stringify(accept)}`);
    steps.push({ name: 'Accept', blockHash: accept.blockHash, txHash: accept.txHash });

    // Step 5 — Withdraw (bob → program; reply carries reward via CommandReply::with_value)
    const bobBefore = await balanceOf(api, bob().address);
    const withdraw = await bobClient.withdraw(bountyId);
    if (!withdraw.ok) throw new Error(`Withdraw failed: ${JSON.stringify(withdraw)}`);
    steps.push({ name: 'Withdraw', blockHash: withdraw.blockHash, txHash: withdraw.txHash });
    const bobAfter = await balanceOf(api, bob().address);

    console.log('=== bob balance delta (atomic units):', (bobAfter - bobBefore).toString());
    console.log('=== reward (atomic units)           :', REWARD.toString());

    // Full enumeration per block
    for (const step of steps) {
      console.log(
        `\n=== ${step.name.padEnd(8)} block=${step.blockHash} tx=${step.txHash}`,
      );
      const evs = await gearEventsInBlock(api, step.blockHash);
      if (evs.length === 0) {
        console.log('  (no gear.* events)');
        continue;
      }
      for (const ev of evs) {
        const src = ev.source ?? '-';
        const dst = ev.destination ?? '-';
        const srcTag = belongsTo(ev.source, programAliases)
          ? '[prog]'
          : belongsTo(ev.source, bobAliases)
            ? '[bob]'
            : belongsTo(ev.source, aliceAliases)
              ? '[alice]'
              : '';
        const dstTag = belongsTo(ev.destination, programAliases)
          ? '[prog]'
          : belongsTo(ev.destination, bobAliases)
            ? '[bob]'
            : belongsTo(ev.destination, aliceAliases)
              ? '[alice]'
              : dst === '0x0000000000000000000000000000000000000000000000000000000000000000'
                ? '[zero/typed-event]'
                : '';
        console.log(
          `  gear.${ev.method.padEnd(20)} entry=${ev.entry ?? '-'} value=${ev.value ?? '-'}`,
        );
        console.log(`     src ${srcTag} ${src}`);
        console.log(`     dst ${dstTag} ${dst}`);
        console.log(`     raw ${ev.rawJson.slice(0, 280)}`);
      }
    }

    // Decision rule — Withdraw block in isolation
    const withdrawStep = steps.find((s) => s.name === 'Withdraw');
    if (!withdrawStep) throw new Error('unreachable: withdraw step missing');
    const withdrawEvents = await gearEventsInBlock(api, withdrawStep.blockHash);

    const replyMessageQueued = withdrawEvents.filter(
      (e) =>
        e.method === 'MessageQueued' &&
        belongsTo(e.source, programAliases) &&
        belongsTo(e.destination, bobAliases),
    );
    const replyUserMessageSent = withdrawEvents.filter(
      (e) =>
        e.method === 'UserMessageSent' &&
        belongsTo(e.source, programAliases) &&
        belongsTo(e.destination, bobAliases),
    );
    const inboundMessageQueued = withdrawEvents.filter(
      (e) =>
        e.method === 'MessageQueued' &&
        belongsTo(e.source, bobAliases) &&
        belongsTo(e.destination, programAliases),
    );
    const replyMessageQueuedEntryReply = replyMessageQueued.filter((e) => e.entry === 'Reply');

    console.log('\n=========================================================');
    console.log('=== DECISION TABLE — Withdraw block reply enumeration ===');
    console.log('=========================================================');
    console.log(`  inbound (bob → program):`);
    console.log(`    gear.MessageQueued   total : ${inboundMessageQueued.length}`);
    console.log(`  outbound reply (program → bob):`);
    console.log(`    gear.MessageQueued   total : ${replyMessageQueued.length}`);
    console.log(`    gear.MessageQueued   entry=Reply: ${replyMessageQueuedEntryReply.length}`);
    console.log(`    gear.UserMessageSent total : ${replyUserMessageSent.length}`);
    if (replyUserMessageSent.length > 0) {
      console.log(
        `    gear.UserMessageSent with non-zero value: ${replyUserMessageSent.filter((e) => e.value && e.value !== '0' && e.value !== '0x0').length}`,
      );
    }

    const verdictWorkerAsApp = replyMessageQueued.length > 0;
    console.log(
      `\n=== VERDICT (G5): worker-as-Application = ${verdictWorkerAsApp ? 'YES' : 'NO'}`,
    );
    if (verdictWorkerAsApp) {
      console.log(
        '    Withdraw emits a separate MessageQueued (program → worker). If the Hub indexer counts',
      );
      console.log(
        '    MessageQueued events into app_metrics.integrations_in, the worker — registered as a',
      );
      console.log(
        '    Hub Application at Phase 6 — accrues +25 per Withdraw under Season 1 scoring.',
      );
    } else {
      console.log(
        '    No separate MessageQueued (program → worker). Reply value rides UserMessageSent only.',
      );
      console.log(
        '    Worker-as-Application would add zero score. Phase 6 plan: Participant-only for worker.',
      );
    }
    console.log('=========================================================');
  } finally {
    await disconnectApi();
    await node.stop();
  }
}

main().catch((err) => {
  console.error('\n[spike] FAILED:', err);
  process.exit(1);
});
