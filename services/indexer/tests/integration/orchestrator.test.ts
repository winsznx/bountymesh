/**
 * Phase 3 Step 5f integration test — lifecycle/boot.ts + shutdown.ts.
 *
 * Five tests, all real chain + real Postgres + real boot orchestrator:
 *   5f.1  boot reaches mode='live' through all 7 stages
 *   5f.2  full SDK lifecycle visible via the indexer's GraphQL (no manual wiring)
 *   5f.3  controller.shutdown() drains http + pools + chain cleanly
 *   5f.4  warm restart from indexer_state — no duplicate events, watermark intact
 *   5f.5  first-boot fail-fast when BOUNTYMESH_START_BLOCK is missing
 *
 * Test order: 5f.1 → 5f.2 → 5f.3 → 5f.4 → 5f.5.
 * 5f.5 deliberately tears down the database before running, so it goes last.
 */

import { describe, before, after, it } from 'node:test';
import { strict as assert } from 'node:assert';
import pino from 'pino';
import pg from 'pg';
import { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
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
import { bounties, bountyEvents, indexerState } from '../../src/schema.js';
import type { IndexerConfig } from '../../src/config.js';

const silent = pino({ level: 'silent' });
const API_PORT = 4352;

function buildConfig(programId: HexString, startBlock: number | null): IndexerConfig {
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

async function gqlQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
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
  timeoutMs = 180_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await gqlQuery<T>(query, variables);
    if (res.data && predicate(res.data)) return res.data;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`gqlPoll: predicate not satisfied within ${timeoutMs}ms`);
}

async function fetchHealth(): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/health`);
  return (await res.json()) as Record<string, unknown>;
}

describe('Phase 3 — lifecycle/boot.ts orchestrator (real chain + real postgres)', () => {
  let pgHandle: PostgresHandle;
  let node: LocalNodeHandle;
  let api: GearApi;
  let programId: HexString;
  let aliceSigner: KeyringPair;
  let bobSigner: KeyringPair;
  let deployBlock: number;
  let controller: IndexerController | null = null;
  let bid: bigint | null = null;
  let preShutdownEventCount: number | null = null;

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
    const header = await api.rpc.chain.getHeader();
    deployBlock = header.number.toNumber();
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

  it('5f.1 — boot reaches mode=live through all 7 stages', async () => {
    const cfg = buildConfig(programId, deployBlock);
    controller = await boot(cfg, silent);
    await controller.awaitMode('live', 30_000);

    assert.equal(controller.healthState.getMode(), 'live');
    assert.equal(controller.healthState.getChainStatus(), 'connected');
    assert.ok(controller.healthState.getLastFinalizedBlock() >= deployBlock);

    // /health endpoint reflects the same state.
    const health = await fetchHealth();
    assert.equal(health.mode, 'live');
    assert.equal(health.chain, 'connected');
    assert.equal(health.db, 'ok');
    assert.ok((health.lastFinalizedBlock as number) >= deployBlock);
  });

  it('5f.2 — full SDK lifecycle is visible via GraphQL with no manual wiring', async () => {
    assert.ok(controller, '5f.1 controller must exist');
    const aliceClient = new BountyMeshClient({ api, programId, signer: aliceSigner });
    const bobClient = new BountyMeshClient({ api, programId, signer: bobSigner });

    const posted = await aliceClient.post({
      title: '5f.2 boot-orchestrated lifecycle',
      description: 'end-to-end via boot()',
      acceptance: 'all 5 tx hashes visible',
      reward: 5_000_000_000_000n,
      track: 'Open',
    });
    assert.ok(posted.ok);
    if (!posted.ok) throw new Error();
    bid = posted.value.bountyId;

    const claim = await bobClient.claim(bid);
    assert.ok(claim.ok);
    const sha = ('0x' + 'e'.repeat(64)) as `0x${string}`;
    const sub = await bobClient.submit(bid, '5f.2 payload', sha);
    assert.ok(sub.ok);
    const acc = await aliceClient.accept(bid);
    assert.ok(acc.ok);
    const wd = await bobClient.withdraw(bid);
    assert.ok(wd.ok);

    interface BountyGql {
      id: string;
      status: string;
      withdrawn: boolean;
      reward: string;
      resultHash: string | null;
      postTxHash: string | null;
      claimTxHash: string | null;
      submitTxHash: string | null;
      acceptTxHash: string | null;
      withdrawTxHash: string | null;
    }
    const result = await gqlPoll<{ bountyById: BountyGql | null }>(
      `query Q($id: BigInt!) {
        bountyById(id: $id) {
          id status withdrawn reward resultHash
          postTxHash claimTxHash submitTxHash acceptTxHash withdrawTxHash
        }
      }`,
      { id: bid.toString() },
      (d) => d.bountyById !== null && d.bountyById.withdrawn === true,
      240_000,
    );

    const b = result.bountyById!;
    assert.equal(b.status, 'Accepted');
    assert.equal(b.withdrawn, true);
    assert.equal(b.reward, '5000000000000');
    assert.equal(b.resultHash, sha);
    for (const tx of [b.postTxHash, b.claimTxHash, b.submitTxHash, b.acceptTxHash, b.withdrawTxHash]) {
      assert.match(tx ?? '', /^0x[0-9a-f]{64}$/);
    }
  });

  it('5f.3 — controller.shutdown() drains http + pools + chain cleanly', async () => {
    assert.ok(controller);

    // Capture state for 5f.4 to verify warm restart.
    const writerPool = new pg.Pool({ connectionString: DEFAULT_WRITER_URL, max: 1 });
    try {
      const db = drizzle(writerPool);
      const rows = await db.select().from(bountyEvents);
      preShutdownEventCount = rows.length;
    } finally {
      await writerPool.end();
    }

    // /health works pre-shutdown.
    const healthBefore = await fetchHealth();
    assert.equal(healthBefore.chain, 'connected');

    await controller.shutdown();

    // /health is unreachable now (server closed).
    let reachable = true;
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      void res;
    } catch {
      reachable = false;
    }
    assert.equal(reachable, false, 'http server stopped accepting connections');

    // chain status reset to disconnected.
    assert.equal(controller.healthState.getChainStatus(), 'disconnected');

    // runUntilShutdown resolves.
    await controller.runUntilShutdown();

    controller = null;
  });

  it('5f.4 — warm restart from indexer_state preserves all data, no duplicates', async () => {
    assert.ok(preShutdownEventCount !== null, '5f.3 must have captured event count');
    assert.ok(bid !== null);

    // Warm restart: NO BOUNTYMESH_START_BLOCK in config; boot must read from indexer_state.
    const cfg = buildConfig(programId, null);
    controller = await boot(cfg, silent);
    await controller.awaitMode('live', 30_000);

    // GraphQL surface shows the same bounty.
    interface BountyGql {
      id: string;
      status: string;
      withdrawn: boolean;
    }
    const res = await gqlQuery<{ bountyById: BountyGql | null }>(
      `query Q($id: BigInt!) { bountyById(id: $id) { id status withdrawn } }`,
      { id: bid.toString() },
    );
    assert.deepEqual(res.errors, undefined);
    assert.ok(res.data?.bountyById);
    assert.equal(res.data?.bountyById?.status, 'Accepted');
    assert.equal(res.data?.bountyById?.withdrawn, true);

    // bounty_events row count unchanged — no duplicates created on warm restart.
    const writerPool = new pg.Pool({ connectionString: DEFAULT_WRITER_URL, max: 1 });
    try {
      const db = drizzle(writerPool);
      const rows = await db.select().from(bountyEvents);
      assert.equal(
        rows.length,
        preShutdownEventCount,
        'warm restart introduced no duplicate bounty_events',
      );
      // Watermark didn't regress.
      const stateRows = await db.select().from(indexerState).where(eq(indexerState.id, 1));
      assert.ok(stateRows[0]);
      assert.ok(
        stateRows[0]!.lastFinalizedBlock >= deployBlock,
        'watermark >= deployBlock',
      );
    } finally {
      await writerPool.end();
    }

    await controller.shutdown();
    controller = null;
  });

  it('5f.5 — first-boot fail-fast without BOUNTYMESH_START_BLOCK', async () => {
    // Wipe state so this is genuinely a first-ever boot.
    const writerPool = new pg.Pool({ connectionString: DEFAULT_WRITER_URL, max: 1 });
    try {
      const db: NodePgDatabase = drizzle(writerPool);
      await db.delete(indexerState).where(eq(indexerState.id, 1));
      await db.delete(bountyEvents);
      await db.delete(bounties);
    } finally {
      await writerPool.end();
    }

    const cfg = buildConfig(programId, null);
    await assert.rejects(
      async () => boot(cfg, silent),
      (err: Error) => {
        assert.match(
          err.message,
          /first-ever boot requires BOUNTYMESH_START_BLOCK|required env var/i,
        );
        return true;
      },
    );

    // Cleanup port isn't held — boot failed before Stage 6.
    const portInUse = await fetch(`http://127.0.0.1:${API_PORT}/health`, {
      signal: AbortSignal.timeout(1_000),
    })
      .then(() => true)
      .catch(() => false);
    assert.equal(portInUse, false, 'failed boot did not leak the HTTP server');
  });
});
