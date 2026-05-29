/**
 * P3.4.5 regression — proves bugs #11 + #12 from P3.3 close are fixed.
 *
 * Bug #11: live-stream orphan-detection was comparing `getBlockHash(N)` to
 *          the buffered blockHash; on gear --dev the two are ~2 blocks
 *          apart, so every event was dropped as orphan. Live ingest
 *          appeared to work but committed nothing.
 *
 * Bug #12: per-event txHash on bounty_events all collapsed to the same
 *          constant value — gear's `gear::run` extrinsic hash — because
 *          UserMessageSent events are emitted by the queue-draining
 *          unsigned extrinsic, not the user's signed sendMessage. The
 *          existing 5f.2 test only checked `/^0x[0-9a-f]{64}$/` shape,
 *          missing the all-same-value regression.
 *
 * This test asserts:
 *   - all 5 events from a full lifecycle land in bounty_events via the
 *     live path (no backfill window) within 30s of the last finalization
 *   - all 5 txHashes are distinct (bug #12 fix)
 *   - all 5 eventNames match the emitted variants
 *   - bountyById returns status='Accepted' + withdrawn=true (proving the
 *     end-to-end derivation chain works via live ingest, not just backfill)
 */

import { describe, before, after, it } from 'node:test';
import { strict as assert } from 'node:assert';
import pino from 'pino';
import { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import { BountyMeshClient } from '@bountymesh/sdk';
import { startLocalNode, type LocalNodeHandle, WS_URL } from '../harness/localNode.js';
import { initDevSigners, alice, bob } from '../harness/devSigners.js';
import { deployBountyMesh } from '../harness/deployProgram.js';
import {
  startPostgres,
  type PostgresHandle,
  DEFAULT_WRITER_URL,
  DEFAULT_READER_URL,
} from '../harness/postgres.js';
import { boot, type IndexerController } from '../../src/lifecycle/boot.js';
import type { IndexerConfig } from '../../src/config.js';

const silent = pino({ level: 'silent' });
const API_PORT = 4353;

function buildConfig(programId: HexString, startBlock: number): IndexerConfig {
  return {
    databaseUrl: DEFAULT_WRITER_URL,
    databaseUrlReader: DEFAULT_READER_URL,
    vararRpcUrl: WS_URL,
    programId,
    startBlock,
    apiPort: API_PORT,
    apiCorsOrigin: '*',
    logLevel: 'silent',
    mode: 'all',
    backfillBatchSize: 50,
    finalityCheckIntervalMs: 6000,
  };
}

async function gqlQuery<T>(query: string, variables?: Record<string, unknown>): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<{ data?: T; errors?: Array<{ message: string }> }>;
}

async function gqlPoll<T>(
  query: string,
  variables: Record<string, unknown>,
  predicate: (data: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await gqlQuery<T>(query, variables);
    if (res.data && predicate(res.data)) return res.data;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`gqlPoll: predicate not satisfied within ${timeoutMs}ms`);
}

describe('P3.4.5 — live ingest regression (bugs #11 + #12)', () => {
  let pgHandle: PostgresHandle;
  let node: LocalNodeHandle;
  let api: GearApi;
  let programId: HexString;
  let aliceSigner: KeyringPair;
  let bobSigner: KeyringPair;
  let controller: IndexerController | null = null;

  before(async () => {
    pgHandle = await startPostgres();
    node = await startLocalNode();
    api = await GearApi.create({ providerAddress: WS_URL });
    await api.isReady;
    await initDevSigners();
    aliceSigner = alice();
    bobSigner = bob();
    const deployed = await deployBountyMesh(api, aliceSigner, {
      minReward: 1_000_000_000_000n,
      autoSettleBlocks: 50_400,
    });
    programId = deployed.programId;

    // #given: boot from deploy block + reach live mode before any tx
    // (forces all events through the live ingest path, not backfill)
    const deployBlock = (await api.rpc.chain.getHeader()).number.toNumber();
    const cfg = buildConfig(programId, deployBlock);
    controller = await boot(cfg, silent);
    await controller.awaitMode('live', 30_000);
  });

  after(async () => {
    if (controller) {
      try {
        await controller.shutdown();
      } catch {
        /* may already be shut down */
      }
    }
    if (api && api.isConnected) await api.disconnect();
    if (node) await node.stop();
    if (pgHandle) await pgHandle.stop();
  });

  it('full lifecycle via live ingest projects 5 distinct events with distinct txHashes', async () => {
    // #given: a fresh bounty walked through every stage
    const aliceClient = new BountyMeshClient({ api, programId, signer: aliceSigner });
    const bobClient = new BountyMeshClient({ api, programId, signer: bobSigner });

    // #when: full lifecycle — Post / Claim / Submit / Accept / Withdraw
    const posted = await aliceClient.post({
      title: 'P3.4.5 live-ingest regression',
      description: 'asserts bugs #11 + #12 are fixed',
      acceptance: '5 distinct txHashes in bounty_events',
      reward: 5_000_000_000_000n,
      track: 'Open',
    });
    assert.ok(posted.ok);
    if (!posted.ok) throw new Error();
    const bid = posted.value.bountyId;

    const claim = await bobClient.claim(bid);
    assert.ok(claim.ok);
    const sha = ('0x' + 'a'.repeat(64)) as `0x${string}`;
    const sub = await bobClient.submit(bid, 'P3.4.5 payload', sha);
    assert.ok(sub.ok);
    const acc = await aliceClient.accept(bid);
    assert.ok(acc.ok);
    const wd = await bobClient.withdraw(bid);
    assert.ok(wd.ok);

    // #when: indexer projects all 5 events + final flag flip via live path
    interface EventGql {
      eventName: string;
      blockNumber: string;
      txHash: string | null;
    }
    interface BountyGql {
      id: string;
      status: string;
      withdrawn: boolean;
    }
    const polled = await gqlPoll<{
      bountyById: BountyGql | null;
      allBountyEvents: { nodes: EventGql[] };
    }>(
      `query Q($id: BigInt!) {
        bountyById(id: $id) { id status withdrawn }
        allBountyEvents(filter: { bountyId: { equalTo: $id } }, orderBy: BLOCK_NUMBER_ASC) {
          nodes { eventName blockNumber txHash }
        }
      }`,
      { id: bid.toString() },
      (d) =>
        d.bountyById !== null &&
        d.bountyById.withdrawn === true &&
        d.allBountyEvents.nodes.length === 5,
      90_000,
    );

    // #then: bug #11 fix — all 5 events committed via live ingest
    const events = polled.allBountyEvents.nodes;
    assert.equal(events.length, 5, 'all 5 lifecycle events must commit');

    // #then: correct event_name values for all 5 emitted variants
    const names = events.map((e) => e.eventName).sort();
    assert.deepEqual(names, [
      'BountyAccepted',
      'BountyClaimed',
      'BountyPosted',
      'BountySubmitted',
      'BountyWithdrawn',
    ]);

    // #then: bug #12 fix — all 5 txHashes are distinct (no collisions on
    // gear::run's constant hash)
    const txHashes = events.map((e) => e.txHash);
    for (const tx of txHashes) {
      assert.match(tx ?? '', /^0x[0-9a-f]{64}$/);
    }
    const uniqueTxHashes = new Set(txHashes);
    assert.equal(
      uniqueTxHashes.size,
      5,
      `expected 5 distinct txHashes, got ${uniqueTxHashes.size} unique values from [${txHashes.join(', ')}]`,
    );

    // #then: bountyById carries status='Accepted' + withdrawn=true
    // (proves the end-to-end derivation chain works via live ingest)
    assert.equal(polled.bountyById!.status, 'Accepted');
    assert.equal(polled.bountyById!.withdrawn, true);
  });
});
