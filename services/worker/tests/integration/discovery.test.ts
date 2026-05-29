import { strict as assert } from 'node:assert';
import { describe, before, after, it } from 'node:test';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import { BountyMeshClient } from '@bountymesh/sdk';
import type { WorkerConfig } from '../../src/config/index.js';
import { setupDiscovery } from '../../src/discovery/index.js';
import type { Candidate, DiscoveryHandle } from '../../src/discovery/types.js';
import { startLocalNode, type LocalNodeHandle } from '../harness/localNode.js';
import { alice, disconnectApi, getApi, initDevSigners } from '../harness/devSigners.js';
import {
  deployBountyMesh,
  getFinalizedBlockNumber,
} from '../harness/deployProgram.js';
import { startPostgres, type PostgresHandle } from '../harness/postgres.js';
import {
  startIndexerSubprocess,
  type IndexerSubprocessHandle,
} from '../harness/indexerSubprocess.js';

const ONE_VARA = 1_000_000_000_000n;
const MIN_REWARD = ONE_VARA;
const REWARD = 2n * ONE_VARA;

async function waitForIndexerToProject(
  ids: readonly bigint[],
  indexerBaseUrl: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = new Set<bigint>();
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${indexerBaseUrl}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'query { allBounties { nodes { id } } }',
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          data?: { allBounties?: { nodes: Array<{ id: string }> } };
        };
        const nodes = body.data?.allBounties?.nodes ?? [];
        lastSeen = new Set(nodes.map((n) => BigInt(n.id)));
        if (ids.every((id) => lastSeen.has(id))) return;
      }
    } catch {
      /* indexer might still be coming up — retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Indexer did not project bounty ids [${ids.join(',')}] within ${timeoutMs}ms; ` +
      `last seen: [${Array.from(lastSeen).join(',')}]`,
  );
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}

describe('discovery — real chain + real Postgres + real indexer', () => {
  let node: LocalNodeHandle;
  let api: GearApi;
  let aliceSigner: KeyringPair;
  let programId: HexString;
  let pg: PostgresHandle;
  let indexer: IndexerSubprocessHandle;
  let workerConfig: WorkerConfig;
  let aliceClient: BountyMeshClient;

  before(async () => {
    node = await startLocalNode();
    await initDevSigners();
    aliceSigner = alice();
    api = await getApi();

    // Deploy bountymesh, capture deploy block for indexer start.
    const deployResult = await deployBountyMesh(api, aliceSigner, {
      minReward: MIN_REWARD,
      autoSettleBlocks: 100,
    });
    programId = deployResult.programId;
    const deployBlock = await getFinalizedBlockNumber(api);

    pg = await startPostgres();
    indexer = await startIndexerSubprocess({
      programId: programId as `0x${string}`,
      varaRpcUrl: 'ws://127.0.0.1:9944',
      databaseUrl: pg.writerUrl,
      startBlock: deployBlock,
    });

    workerConfig = {
      varaRpcUrl: 'ws://127.0.0.1:9944',
      bountymeshProgramId: programId as `0x${string}`,
      indexerBaseUrl: indexer.baseUrl,
      indexerHealthMaxLagBlocks: 1000, // generous for `gear --dev` block timing
      keystorePath: null,
      adapter: 'groq',
      groqModel: 'llama-3.3-70b-versatile',
      workerTrack: 'Services',
      workerMinReward: MIN_REWARD,
      workerStatePath: '/tmp/worker-test-discovery.state.json',
      workerHistoryPath: '/tmp/worker-test-discovery.history.jsonl',
      workerResumeTtlMs: 6 * 60 * 60 * 1000,
      logLevel: 'warn',
    };
    aliceClient = new BountyMeshClient({ api, programId, signer: aliceSigner });
  }, 180_000);

  after(async () => {
    if (indexer) await indexer.stop();
    if (pg) await pg.stop();
    await disconnectApi();
    if (node) await node.stop();
  });

  it('catchup surfaces pre-existing bounties; live channel surfaces post-boot ones; phase tags + blockHash correct', async () => {
    // ----- Step 1: post 2 bounties BEFORE setupDiscovery (catchup candidates) -----
    // CLAUDE.md Phase 3 rule: never embed BigInt-bearing objects in assertion
    // messages — template literals evaluate eagerly even on the pass path,
    // JSON.stringify throws. Use post.error (typed string) for diagnostics.
    const post1 = await aliceClient.post({
      title: 'discovery-catchup-1',
      description: 'd',
      acceptance: 'a',
      reward: REWARD,
      track: 'Services',
    });
    if (!post1.ok) throw new Error(`post1 failed: ${post1.error}`);

    const post2 = await aliceClient.post({
      title: 'discovery-catchup-2',
      description: 'd',
      acceptance: 'a',
      reward: REWARD,
      track: 'Services',
    });
    if (!post2.ok) throw new Error(`post2 failed: ${post2.error}`);

    // Wait for indexer to project both into the bounties table.
    await waitForIndexerToProject([post1.value.bountyId, post2.value.bountyId], indexer.baseUrl, 60_000);

    // ----- Step 2: setupDiscovery -----
    const chainHeadAtBootStart = await getFinalizedBlockNumber(api);
    const received: Candidate[] = [];
    let handle: DiscoveryHandle | null = null;

    try {
      handle = await setupDiscovery({
        client: aliceClient,
        config: workerConfig,
        chainHeadAtBootStart,
        consumer: (c) => {
          received.push(c);
        },
      });

      // ----- Step 3: assert catchup dispatched 2 candidates with phase='catchup' -----
      assert.equal(received.length, 2, 'setupDiscovery should dispatch 2 catchup candidates');
      for (const c of received) {
        assert.equal(c.phase, 'catchup', `expected phase=catchup, got ${c.phase}`);
        assert.equal(c.blockHash, null, 'catchup-sourced candidates carry null blockHash');
      }
      const catchupIds = received.map((c) => c.id).sort();
      const expected = [post1.value.bountyId, post2.value.bountyId].sort();
      assert.deepEqual(catchupIds, expected);

      // ----- Step 4: post 1 more bounty AFTER setupDiscovery (live candidate) -----
      const post3 = await aliceClient.post({
        title: 'discovery-live-1',
        description: 'd',
        acceptance: 'a',
        reward: REWARD,
        track: 'Services',
      });
      if (!post3.ok) throw new Error(`post3 failed: ${post3.error}`);

      // Wait for live dispatch through the SDK SubscriptionManager.
      await waitFor(() => received.length === 3, 30_000, 'received.length === 3');

      // ----- Step 5: assert live candidate has phase='live' + non-null blockHash -----
      assert.equal(received.length, 3);
      const liveCandidate = received[2];
      assert.equal(liveCandidate.phase, 'live');
      assert.equal(liveCandidate.id, post3.value.bountyId);
      assert.ok(liveCandidate.blockHash !== null, 'live-sourced candidate must carry blockHash');
      assert.match(liveCandidate.blockHash, /^0x[0-9a-f]{64}$/);
      assert.ok(liveCandidate.txHash !== null);
      assert.match(liveCandidate.txHash, /^0x[0-9a-f]{64}$/);
      assert.equal(liveCandidate.title, 'discovery-live-1');

      // ----- Step 6: no duplicate IDs across catchup + live -----
      const allIds = received.map((c) => c.id);
      const uniqueIds = new Set(allIds);
      assert.equal(allIds.length, uniqueIds.size, 'no duplicate bountyIds across phases');

      // ----- Step 7: candidatesDispatched matches received.length -----
      assert.equal(handle.candidatesDispatched(), 3);
    } finally {
      if (handle) await handle.unsub();
    }
  }, 300_000);
});
