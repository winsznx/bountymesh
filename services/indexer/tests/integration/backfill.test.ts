/**
 * Phase 3 Step 5d integration test — chain/backfill.ts.
 *
 * Three tests, all real chain + real Postgres:
 *   5d.1  empty range advances watermark cleanly (no events to ingest)
 *   5d.2  cold-start backfill over a full lifecycle converges to live-path projection
 *   5d.3  re-running backfill over the same range is a complete no-op (idempotency)
 *
 * No subscriptions are opened in this file — backfill is the ONLY ingestion
 * driver. This isolates the backfill path from the live optimistic path.
 */

import { describe, before, after, it } from 'node:test';
import { strict as assert } from 'node:assert';
import pino from 'pino';
import pg from 'pg';
import { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { TypeRegistry } from '@polkadot/types';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { BountyMeshClient } from '@bountymesh/sdk';
import { startLocalNode, type LocalNodeHandle, WS_URL } from '../harness/localNode.js';
import { initDevSigners, alice, bob } from '../harness/devSigners.js';
import { deployBountyMesh } from '../harness/deployProgram.js';
import {
  startPostgres,
  initIndexerState,
  readIndexerStateWatermark,
  type PostgresHandle,
} from '../harness/postgres.js';
import { backfill } from '../../src/chain/backfill.js';
import { createProgramRegistry } from '../../src/chain/decode.js';
import { bounties, bountyEvents } from '../../src/schema.js';

const silent = pino({ level: 'silent' });

async function getFinalizedBlockNumber(api: GearApi): Promise<number> {
  const hash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(hash);
  return header.number.toNumber();
}

async function waitForFinalizedAtLeast(api: GearApi, target: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await getFinalizedBlockNumber(api);
    if (current >= target) return current;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`waitForFinalizedAtLeast: finalized head did not reach ${target} within ${timeoutMs}ms`);
}

describe('Phase 3 — chain/backfill.ts (real chain + real postgres)', () => {
  let pgHandle: PostgresHandle;
  let node: LocalNodeHandle;
  let api: GearApi;
  let programId: HexString;
  let registry: TypeRegistry;
  let writerPool: pg.Pool;
  let db: NodePgDatabase;
  let aliceSigner: KeyringPair;
  let bobSigner: KeyringPair;
  let deployBlock: number;
  // 5d.2 / 5d.3 lifecycle state, populated in 5d.2
  let lifecycleBountyId: bigint | null = null;
  let lifecycleLastBlock: number | null = null;

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
    deployBlock = await getFinalizedBlockNumber(api);
    await initIndexerState(pgHandle.writerUrl, programId, deployBlock);

    writerPool = new pg.Pool({ connectionString: pgHandle.writerUrl, max: 2 });
    db = drizzle(writerPool);
    registry = createProgramRegistry(api, programId);
  });

  after(async () => {
    if (api && api.isConnected) await api.disconnect();
    if (node) await node.stop();
    if (writerPool) await writerPool.end();
    if (pgHandle) await pgHandle.stop();
  });

  it('5d.1 — empty range backfill advances watermark through no-event blocks', async () => {
    const target = deployBlock + 5;
    const finalizedAfterWait = await waitForFinalizedAtLeast(api, target, 60_000);
    assert.ok(finalizedAfterWait >= target, 'chain produced enough blocks');

    const result = await backfill(
      { db, api, programId, registry, logger: silent, batchSize: 50 },
      deployBlock,
      target,
    );

    assert.equal(result.eventsIngested, 0, 'no events in empty range');
    assert.equal(result.parseErrors, 0);
    assert.equal(result.blocksWalked, 5);
    assert.equal(result.batches, 1);

    const eventRowCount = await db.select().from(bountyEvents);
    assert.equal(eventRowCount.length, 0, 'no bounty_events rows from empty backfill');

    const watermark = await readIndexerStateWatermark(pgHandle.writerUrl);
    assert.equal(watermark, target, 'watermark advanced to target despite empty range');
  });

  it('5d.2 — cold-start backfill over full lifecycle converges to live-path projection', async () => {
    const aliceClient = new BountyMeshClient({ api, programId, signer: aliceSigner });
    const bobClient = new BountyMeshClient({ api, programId, signer: bobSigner });

    const posted = await aliceClient.post({
      title: '5d.2 backfill lifecycle',
      description: 'cold-start coverage of full Post→...→Withdraw',
      acceptance: 'criteria',
      reward: 4_000_000_000_000n,
      track: 'Open',
    });
    assert.ok(posted.ok);
    const bid = posted.ok ? posted.value.bountyId : 0n;

    const claim = await bobClient.claim(bid);
    assert.ok(claim.ok);
    const sha256Hex = ('0x' + 'c'.repeat(64)) as `0x${string}`;
    const submit = await bobClient.submit(bid, '5d.2 result payload', sha256Hex);
    assert.ok(submit.ok);
    const accept = await aliceClient.accept(bid);
    assert.ok(accept.ok);
    const withdraw = await bobClient.withdraw(bid);
    assert.ok(withdraw.ok);

    // withdraw.blockHash points at the block the Withdraw tx landed in (sails-js
    // resolves on InBlock, NOT finalization). Wait until finality catches up.
    if (!withdraw.ok) throw new Error('withdraw.ok required');
    const withdrawHeader = await api.rpc.chain.getHeader(withdraw.blockHash);
    const lastEventBlock = withdrawHeader.number.toNumber();
    const finalizedAfterWait = await waitForFinalizedAtLeast(api, lastEventBlock, 60_000);
    assert.ok(finalizedAfterWait >= lastEventBlock);

    lifecycleBountyId = bid;
    lifecycleLastBlock = lastEventBlock;

    const startWatermark = await readIndexerStateWatermark(pgHandle.writerUrl);
    assert.ok(startWatermark !== null);

    const result = await backfill(
      { db, api, programId, registry, logger: silent, batchSize: 50 },
      startWatermark,
      finalizedAfterWait,
    );

    assert.equal(result.eventsIngested, 5, 'all 5 lifecycle events ingested');
    assert.equal(result.parseErrors, 0);

    // Projection state matches the live-path (5c.2) result.
    const rows = await db.select().from(bounties).where(eq(bounties.id, Number(bid)));
    assert.equal(rows.length, 1, 'one bounty row after backfill');
    const row = rows[0]!;
    assert.equal(row.status, 'Accepted');
    assert.equal(row.withdrawn, true);
    assert.equal(row.reward, '4000000000000');
    assert.equal(row.track, 'Open');
    assert.equal(row.resultHash, sha256Hex);
    assert.ok(
      row.postTxHash && row.claimTxHash && row.submitTxHash && row.acceptTxHash && row.withdrawTxHash,
      'all five tx_hashes populated',
    );
    assert.ok(row.lastEventBlock !== null && row.lastEventBlock <= lastEventBlock);

    const eventRows = await db
      .select()
      .from(bountyEvents)
      .where(eq(bountyEvents.bountyId, Number(bid)));
    assert.equal(eventRows.length, 5);
    const names = eventRows.map((e) => e.eventName).sort();
    assert.deepEqual(
      names,
      ['BountyAccepted', 'BountyClaimed', 'BountyPosted', 'BountySubmitted', 'BountyWithdrawn'],
    );

    const watermarkAfter = await readIndexerStateWatermark(pgHandle.writerUrl);
    assert.ok(watermarkAfter !== null && watermarkAfter >= finalizedAfterWait);
  });

  it('5d.3 — re-running backfill from genesis is idempotent', async () => {
    assert.ok(lifecycleBountyId !== null, '5d.2 must have run');
    assert.ok(lifecycleLastBlock !== null);
    const bid = lifecycleBountyId;
    const finalizedNow = await getFinalizedBlockNumber(api);

    const eventsBefore = await db.select().from(bountyEvents);
    const bountiesBefore = await db.select().from(bounties).where(eq(bounties.id, Number(bid)));
    const watermarkBefore = await readIndexerStateWatermark(pgHandle.writerUrl);
    assert.ok(watermarkBefore !== null);

    // Replay: backfill from deployBlock all the way to current finalized head.
    // Overlaps fully with what 5d.1 + 5d.2 already covered.
    const result = await backfill(
      { db, api, programId, registry, logger: silent, batchSize: 50 },
      deployBlock,
      finalizedNow,
    );

    // No new event rows AND no new parse errors are expected from the replay.
    // The committedCount from result counts INSERT attempts; ON CONFLICT
    // DO NOTHING silently rolls them up — the result.eventsIngested counter
    // includes them because the savepoint succeeded (insert was a no-op).
    // The load-bearing assertion is on the DB-side row counts staying constant.
    const eventsAfter = await db.select().from(bountyEvents);
    assert.equal(eventsAfter.length, eventsBefore.length, 'no duplicate bounty_events rows');

    const bountiesAfter = await db.select().from(bounties).where(eq(bounties.id, Number(bid)));
    assert.equal(bountiesAfter.length, 1);
    const before = bountiesBefore[0]!;
    const after = bountiesAfter[0]!;
    assert.equal(after.status, before.status, 'status unchanged on replay');
    assert.equal(after.withdrawn, before.withdrawn);
    assert.equal(after.lastEventBlock, before.lastEventBlock, 'lastEventBlock unchanged');
    assert.equal(after.reward, before.reward);
    assert.equal(after.postTxHash, before.postTxHash);
    assert.equal(after.withdrawTxHash, before.withdrawTxHash);

    const watermarkAfter = await readIndexerStateWatermark(pgHandle.writerUrl);
    assert.ok(
      watermarkAfter !== null && watermarkAfter >= watermarkBefore,
      'watermark never regresses',
    );

    // Sanity: parseErrors counter from result. Real-chain backfill on already-
    // committed events triggers zero parse errors.
    assert.equal(result.parseErrors, 0);

    // Validate the and/eq import path isn't optimized away (lint sanity).
    const sentinel = await db
      .select()
      .from(bounties)
      .where(and(eq(bounties.id, Number(bid)), eq(bounties.withdrawn, true)));
    assert.equal(sentinel.length, 1);
  });
});
