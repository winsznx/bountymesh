/**
 * Phase 3 Step 5c integration test.
 *
 * Real chain (gear --dev --tmp) + real Postgres (docker) + real SDK + real
 * dispatch. No mocks. End-to-end proof that:
 *   1. BountyPosted via SDK → bounties row materializes with correct fields
 *   2. Full lifecycle (Post → Claim → Submit → Accept → Withdraw) projects
 *      through 5 events into the final Accepted+withdrawn=true state
 *   3. Re-dispatching the same canonical block is idempotent (no dup rows,
 *      no UPDATE applied past the lastEventBlock guard)
 *   4. A synthetic malformed event lands in parse_errors WITHOUT halting the
 *      block — sibling good events still commit, watermark still advances
 */

import { describe, before, after, it } from 'node:test';
import { strict as assert } from 'node:assert';
import pino from 'pino';
import pg from 'pg';
import { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BountyMeshClient } from '@bountymesh/sdk';
import { startLocalNode, type LocalNodeHandle, WS_URL } from '../harness/localNode.js';
import { initDevSigners, alice, bob, charlie } from '../harness/devSigners.js';
import { deployBountyMesh } from '../harness/deployProgram.js';
import {
  startPostgres,
  initIndexerState,
  readIndexerStateWatermark,
  type PostgresHandle,
} from '../harness/postgres.js';
import { openSubscriptions, type CanonicalEventsHandler } from '../../src/chain/subscriptions.js';
import { createProgramRegistry } from '../../src/chain/decode.js';
import { PendingBuffer, type BufferedEvent } from '../../src/chain/buffer.js';
import { dispatchBlockEvents, makeEventUid } from '../../src/ingest/dispatch.js';
import { bounties, bountyEvents, parseErrors } from '../../src/schema.js';

const silent = pino({ level: 'silent' });

interface DispatchedBlock {
  blockHash: HexString;
  blockNumber: number;
  events: BufferedEvent[];
}

function makeDispatcher(db: NodePgDatabase): {
  handler: CanonicalEventsHandler;
  waitFor: (predicate: (b: DispatchedBlock) => boolean, timeoutMs?: number) => Promise<DispatchedBlock>;
  dispatched: DispatchedBlock[];
} {
  const dispatched: DispatchedBlock[] = [];
  const waiters: Array<{ predicate: (b: DispatchedBlock) => boolean; resolve: (b: DispatchedBlock) => void }> = [];

  const handler: CanonicalEventsHandler = async (blockHash, blockNumber, events) => {
    await dispatchBlockEvents({ db, logger: silent }, blockHash, blockNumber, events);
    const record = { blockHash, blockNumber, events };
    dispatched.push(record);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i]!.predicate(record)) {
        waiters[i]!.resolve(record);
        waiters.splice(i, 1);
      }
    }
  };

  const waitFor = (
    predicate: (b: DispatchedBlock) => boolean,
    timeoutMs = 90_000,
  ): Promise<DispatchedBlock> => {
    const existing = dispatched.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<DispatchedBlock>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.predicate === predicate);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`));
      }, timeoutMs);
      waiters.push({
        predicate,
        resolve: (b) => {
          clearTimeout(timer);
          resolve(b);
        },
      });
    });
  };

  return { handler, waitFor, dispatched };
}

describe('Phase 3 — ingest dispatch + projection (real chain + real postgres)', () => {
  let pgHandle: PostgresHandle;
  let node: LocalNodeHandle;
  let api: GearApi;
  let programId: HexString;
  let writerPool: pg.Pool;
  let db: NodePgDatabase;
  let aliceSigner: KeyringPair;
  let bobSigner: KeyringPair;
  let buffer: PendingBuffer;
  let subs: { close: () => Promise<void> };
  let waitFor: ReturnType<typeof makeDispatcher>['waitFor'];

  before(async () => {
    pgHandle = await startPostgres();
    node = await startLocalNode();
    api = await GearApi.create({ providerAddress: WS_URL });
    await api.isReady;
    await initDevSigners();
    aliceSigner = alice();
    bobSigner = bob();
    // Fund Charlie just in case any of the lifecycle tests need a 3rd party
    // (not strictly required for the happy-path 5c tests, but the harness
    // pattern includes it; mirrors SDK Phase 2 harness behaviour).
    void charlie;

    const deployed = await deployBountyMesh(api, aliceSigner, {
      minReward: 1_000_000_000_000n,
      autoSettleBlocks: 50_400,
    });
    programId = deployed.programId;

    const deployBlock = (await api.rpc.chain.getHeader()).number.toNumber();
    await initIndexerState(pgHandle.writerUrl, programId, deployBlock);

    writerPool = new pg.Pool({ connectionString: pgHandle.writerUrl, max: 2 });
    db = drizzle(writerPool);
    buffer = new PendingBuffer();
    const dispatcher = makeDispatcher(db);
    waitFor = dispatcher.waitFor;
    subs = await openSubscriptions({
      api,
      programId,
      registry: createProgramRegistry(api, programId),
      buffer,
      onCanonicalEvents: dispatcher.handler,
      logger: silent,
    });
  });

  after(async () => {
    if (subs) await subs.close();
    if (api && api.isConnected) await api.disconnect();
    if (node) await node.stop();
    if (writerPool) await writerPool.end();
    if (pgHandle) await pgHandle.stop();
  });

  it('5c.1 — BountyPosted projects to a bounties row with correct shape', async () => {
    const sdkClient = new BountyMeshClient({ api, programId, signer: aliceSigner });
    const posted = await sdkClient.post({
      title: '5c.1 single Post',
      description: 'verify projection of BountyPosted',
      acceptance: 'whatever',
      reward: 2_000_000_000_000n,
      track: 'Economy',
    });
    if (!posted.ok) {
      assert.fail(`post must succeed; got error: ${posted.error} (tx ${posted.txHash})`);
    }
    const bountyId = posted.value.bountyId;
    const block = await waitFor((b) =>
      b.events.some((e) => e.eventName === 'BountyPosted' && e.id === bountyId),
    );

    const rows = await db
      .select()
      .from(bounties)
      .where(eq(bounties.id, Number(bountyId)));
    assert.equal(rows.length, 1, 'exactly one bounties row');
    const row = rows[0]!;
    assert.equal(row.status, 'Open');
    // Compare poster against the on-chain event payload (hex form). The SDK
    // surfaces the poster as a 0x-prefixed 32-byte hex (AccountId32). The
    // KeyringPair's `address` is SS58-encoded; we don't compare against that
    // directly — the indexer stores hex, not SS58.
    const postedEv = block.events.find((e) => e.eventName === 'BountyPosted');
    assert.ok(postedEv && postedEv.eventName === 'BountyPosted');
    if (postedEv && postedEv.eventName === 'BountyPosted') {
      assert.equal(row.poster, postedEv.poster, 'poster hex matches event payload');
    }
    // reward is NUMERIC(39,0) — Drizzle returns it as STRING (D5 contract).
    assert.equal(row.reward, '2000000000000', 'reward is string from NUMERIC column');
    assert.equal(row.track, 'Economy');
    assert.equal(typeof row.postedAt, 'number');
    assert.equal(row.withdrawn, false);
    assert.equal(row.lastEventBlock, block.blockNumber);
    assert.equal(row.postTxHash, postedEv && postedEv.eventName === 'BountyPosted' ? postedEv.txHash : null);

    // bounty_events row also exists with the right uid.
    const eventRows = await db
      .select()
      .from(bountyEvents)
      .where(eq(bountyEvents.bountyId, Number(bountyId)));
    assert.equal(eventRows.length, 1);
    const eventRow = eventRows[0]!;
    assert.equal(eventRow.eventName, 'BountyPosted');
    assert.equal(
      eventRow.eventUid,
      makeEventUid(block.blockHash, 'BountyPosted', bountyId),
    );
    assert.equal(eventRow.blockNumber, block.blockNumber);
  });

  it('5c.2 — full lifecycle projects correctly through 5 events', async () => {
    const aliceClient = new BountyMeshClient({ api, programId, signer: aliceSigner });
    const bobClient = new BountyMeshClient({ api, programId, signer: bobSigner });

    const posted = await aliceClient.post({
      title: '5c.2 lifecycle',
      description: 'projection through 5 events',
      acceptance: 'criteria',
      reward: 3_000_000_000_000n,
      track: 'Services',
    });
    assert.ok(posted.ok);
    const bid = posted.ok ? posted.value.bountyId : 0n;
    await waitFor((b) => b.events.some((e) => e.eventName === 'BountyPosted' && e.id === bid));

    const claim = await bobClient.claim(bid);
    assert.ok(claim.ok);
    await waitFor((b) => b.events.some((e) => e.eventName === 'BountyClaimed' && e.id === bid));

    const sha256Hex = '0x' + 'a'.repeat(64);
    const submit = await bobClient.submit(bid, 'result payload', sha256Hex as `0x${string}`);
    assert.ok(submit.ok);
    await waitFor((b) => b.events.some((e) => e.eventName === 'BountySubmitted' && e.id === bid));

    const accept = await aliceClient.accept(bid);
    assert.ok(accept.ok);
    await waitFor((b) => b.events.some((e) => e.eventName === 'BountyAccepted' && e.id === bid));

    const withdraw = await bobClient.withdraw(bid);
    assert.ok(withdraw.ok);
    await waitFor((b) => b.events.some((e) => e.eventName === 'BountyWithdrawn' && e.id === bid));

    const rows = await db.select().from(bounties).where(eq(bounties.id, Number(bid)));
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.status, 'Accepted', 'final status stays Accepted after Withdraw');
    assert.equal(row.withdrawn, true);
    assert.ok(row.claimedAt && row.claimedAt > 0);
    assert.ok(row.submittedAt && row.submittedAt > 0);
    assert.ok(row.acceptedAt && row.acceptedAt > 0);
    assert.ok(row.withdrawnAt && row.withdrawnAt > 0);
    // worker = bob's hex. Read from the BountyClaimed event payload (canonical).
    const claimedEventRow = await db
      .select()
      .from(bountyEvents)
      .where(and(
        eq(bountyEvents.eventName, 'BountyClaimed'),
        eq(bountyEvents.bountyId, Number(bid)),
      ));
    assert.equal(claimedEventRow.length, 1);
    const claimedWorker = (claimedEventRow[0]!.payload as { worker: string }).worker;
    assert.equal(row.worker, claimedWorker, 'worker hex matches BountyClaimed payload');
    assert.equal(row.resultHash, sha256Hex);
    assert.equal(row.reward, '3000000000000');
    assert.ok(row.postTxHash && row.claimTxHash && row.submitTxHash && row.acceptTxHash && row.withdrawTxHash);

    // bounty_events: 5 distinct rows with unique event_uids.
    const events = await db
      .select()
      .from(bountyEvents)
      .where(eq(bountyEvents.bountyId, Number(bid)));
    assert.equal(events.length, 5);
    const uids = new Set(events.map((e) => e.eventUid));
    assert.equal(uids.size, 5);
    const names = events.map((e) => e.eventName).sort();
    assert.deepEqual(
      names,
      ['BountyAccepted', 'BountyClaimed', 'BountyPosted', 'BountySubmitted', 'BountyWithdrawn'],
    );
  });

  it('5c.3 — re-dispatching the same canonical block is idempotent', async () => {
    // Pick the BountyPosted from 5c.2 by querying the most recent posted event.
    const postedEvents = await db
      .select()
      .from(bountyEvents)
      .where(eq(bountyEvents.eventName, 'BountyPosted'));
    assert.ok(postedEvents.length >= 2, 'at least 2 Posted events (5c.1 + 5c.2) exist');
    const target = postedEvents[postedEvents.length - 1]!;
    const targetBid = target.bountyId;

    const beforeRows = await db.select().from(bounties).where(eq(bounties.id, targetBid));
    const beforeEvents = await db
      .select()
      .from(bountyEvents)
      .where(eq(bountyEvents.bountyId, targetBid));
    const beforeBounty = { ...beforeRows[0]! };
    const beforeWatermark = await readIndexerStateWatermark(pgHandle.writerUrl);
    assert.ok(beforeWatermark !== null);

    // Reconstruct a synthetic BufferedEvent matching the stored row.
    const payload = target.payload as Record<string, unknown>;
    const replayEvent: BufferedEvent = {
      eventName: 'BountyPosted',
      id: BigInt(payload.id as string),
      poster: payload.poster as HexString,
      reward: BigInt(payload.reward as string),
      track: payload.track as 'Services' | 'Social' | 'Economy' | 'Open',
      postedAt: payload.postedAt as number,
      title: '',
      description: '',
      acceptance: '',
      deadline: null,
      blockHash: target.blockHash as HexString,
      txHash: target.txHash as HexString,
    };

    // Replay: dispatch the same block again.
    await dispatchBlockEvents(
      { db, logger: silent },
      target.blockHash as HexString,
      target.blockNumber,
      [replayEvent],
    );

    const afterRows = await db.select().from(bounties).where(eq(bounties.id, targetBid));
    const afterEvents = await db
      .select()
      .from(bountyEvents)
      .where(eq(bountyEvents.bountyId, targetBid));
    const afterWatermark = await readIndexerStateWatermark(pgHandle.writerUrl);

    // No duplicate bounty_events rows.
    assert.equal(afterEvents.length, beforeEvents.length, 'no new bounty_events rows');
    // bounties row unchanged (the lastEventBlock guard prevented re-projection
    // because subsequent events advanced lastEventBlock past replayEvent's).
    assert.equal(afterRows[0]?.status, beforeBounty.status, 'status unchanged on replay');
    assert.equal(
      afterRows[0]?.lastEventBlock,
      beforeBounty.lastEventBlock,
      'lastEventBlock unchanged',
    );
    // Watermark: never regresses. Should be >= before (advance-only guard).
    assert.ok(afterWatermark !== null && afterWatermark >= beforeWatermark);
  });

  it('5c.4 — synthetic malformed event records parse_error + sibling commits + watermark advances', async () => {
    // Two events headed to the SAME synthetic block:
    //   - good BountyPosted (will project + insert)
    //   - bad event with eventName=UnknownType (will throw in project.ts default branch)
    const fakeBlockHash = ('0x' + 'ee'.repeat(32)) as HexString;
    // Use a block far ahead of current finalized so the watermark advance is observable.
    const finalizedHash = await api.rpc.chain.getFinalizedHead();
    const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash);
    const farAhead = finalizedHeader.number.toNumber() + 1_000_000;

    const goodId = 99999n;
    const goodEvent: BufferedEvent = {
      eventName: 'BountyPosted',
      id: goodId,
      poster: ('0x' + '01'.repeat(32)) as HexString,
      reward: 5_000_000_000_000n,
      track: 'Open',
      postedAt: farAhead,
      title: '',
      description: '',
      acceptance: '',
      deadline: null,
      blockHash: fakeBlockHash,
      txHash: ('0x' + '02'.repeat(32)) as HexString,
    };
    const badEvent = {
      eventName: 'BountySomethingUnknown',
      id: 100000n,
      poster: ('0x' + '03'.repeat(32)) as HexString,
      reward: 1n,
      track: 'Services',
      postedAt: farAhead,
      blockHash: fakeBlockHash,
      txHash: ('0x' + '04'.repeat(32)) as HexString,
    } as unknown as BufferedEvent;

    const watermarkBefore = await readIndexerStateWatermark(pgHandle.writerUrl);
    assert.ok(watermarkBefore !== null);

    await dispatchBlockEvents(
      { db, logger: silent },
      fakeBlockHash,
      farAhead,
      [goodEvent, badEvent],
    );

    // Good event projected.
    const goodRow = await db.select().from(bounties).where(eq(bounties.id, Number(goodId)));
    assert.equal(goodRow.length, 1, 'good BountyPosted projected');
    assert.equal(goodRow[0]!.status, 'Open');

    // Good event's row in bounty_events.
    const goodEventRow = await db
      .select()
      .from(bountyEvents)
      .where(eq(bountyEvents.bountyId, Number(goodId)));
    assert.equal(goodEventRow.length, 1);

    // Bad event recorded in parse_errors.
    const badUid = makeEventUid(fakeBlockHash, 'BountySomethingUnknown', 100000n);
    const parseErrorRows = await db
      .select()
      .from(parseErrors)
      .where(eq(parseErrors.eventUid, badUid));
    assert.equal(parseErrorRows.length, 1, 'parse_errors row for bad event');
    assert.match(parseErrorRows[0]!.errorMessage, /unknown event shape|UnknownEvent|BountySomethingUnknown/);

    // Bad event did NOT land in bounty_events (savepoint rolled back).
    const badBountyEventRow = await db
      .select()
      .from(bountyEvents)
      .where(eq(bountyEvents.eventUid, badUid));
    assert.equal(badBountyEventRow.length, 0, 'bad event has no bounty_events row');

    // Watermark advanced to farAhead.
    const watermarkAfter = await readIndexerStateWatermark(pgHandle.writerUrl);
    assert.equal(watermarkAfter, farAhead, 'watermark advanced past sibling-event block');

    // /health-style parse-error count probe — there must be at least 1 in the last hour.
    const recent = await db
      .select({ value: sql<number>`COUNT(*)::int` })
      .from(parseErrors)
      .where(sql`occurred_at > NOW() - INTERVAL '1 hour'`);
    assert.ok((recent[0]?.value ?? 0) >= 1);
  });
});
