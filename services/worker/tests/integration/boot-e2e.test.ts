import { strict as assert } from 'node:assert';
import { describe, before, after, it } from 'node:test';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import { BountyMeshClient } from '@bountymesh/sdk';
import { ClaudeApiAdapter } from '../../src/adapter/index.js';
import { boot, type BootHandle } from '../../src/lifecycle/index.js';
import { startLocalNode, type LocalNodeHandle } from '../harness/localNode.js';
import {
  alice,
  charlie,
  disconnectApi,
  fund,
  getApi,
  initDevSigners,
} from '../harness/devSigners.js';
import {
  deployBountyMesh,
  getFinalizedBlockNumber,
} from '../harness/deployProgram.js';
import { startPostgres, type PostgresHandle } from '../harness/postgres.js';
import {
  startIndexerSubprocess,
  type IndexerSubprocessHandle,
} from '../harness/indexerSubprocess.js';
import { startEchoServer, type EchoServerHandle } from '../harness/echoServer.js';
import {
  restoreEnv,
  setBootEnv,
  snapshotEnv,
  type EnvSnapshot,
} from '../harness/envSetup.js';
import {
  waitForBountyProjected,
  waitForChainStatus,
  waitForDoneRecord,
  waitForPendingAccept,
} from '../harness/waits.js';

const STATE_PATH = '/tmp/worker-e2e.state.json';
const HISTORY_PATH = '/tmp/worker-e2e.history.jsonl';

function cleanupTestFiles(): void {
  for (const p of [STATE_PATH, HISTORY_PATH]) {
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  }
}

describe('boot-e2e: real chain + Postgres + indexer + worker boot', () => {
  let nodeHandle: LocalNodeHandle;
  let api: GearApi;
  let aliceClient: BountyMeshClient;
  let aliceSigner: KeyringPair;
  let charlieSigner: KeyringPair;
  let programId: HexString;
  let pgHandle: PostgresHandle;
  let indexerHandle: IndexerSubprocessHandle;
  let echoServer: EchoServerHandle;
  let workerHandle: BootHandle | null = null;
  let envSnapshot: EnvSnapshot;

  before(async () => {
    nodeHandle = await startLocalNode();
    await initDevSigners();
    aliceSigner = alice();
    charlieSigner = charlie();
    api = await getApi();

    // gear --dev pre-funds //Alice + //Bob only; fund //Charlie so the
    // worker can pay tx fees for Claim / Submit / Withdraw.
    await fund(aliceSigner, charlieSigner.address, 10_000_000_000_000n);

    const deploy = await deployBountyMesh(api, aliceSigner, {
      minReward: 1_000_000_000_000n,
      autoSettleBlocks: 100,
    });
    programId = deploy.programId;
    const deployBlock = await getFinalizedBlockNumber(api);

    pgHandle = await startPostgres();
    indexerHandle = await startIndexerSubprocess({
      programId: programId as `0x${string}`,
      varaRpcUrl: 'ws://127.0.0.1:9944',
      databaseUrl: pgHandle.writerUrl,
      startBlock: deployBlock,
    });

    echoServer = await startEchoServer();

    aliceClient = new BountyMeshClient({ api, programId, signer: aliceSigner });

    // Test isolation: delete prior /tmp/worker-e2e.* files BEFORE boot
    // (operator lock 2). Stale files would replay inflight/pending state
    // from a crashed prior run and corrupt the test.
    cleanupTestFiles();
    envSnapshot = snapshotEnv();
  }, 180_000);

  after(async () => {
    // Each teardown step in its own try/catch — a failure in one must NOT
    // prevent the others from running.
    if (workerHandle) {
      try {
        await workerHandle.shutdown();
      } catch (err) {
        // eslint-disable-next-line no-console -- after-hook diagnostic
        console.warn('[boot-e2e/after] worker shutdown failed:', err);
      }
    }
    try {
      if (echoServer) await echoServer.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[boot-e2e/after] echo stop failed:', err);
    }
    try {
      if (indexerHandle) await indexerHandle.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[boot-e2e/after] indexer stop failed:', err);
    }
    try {
      if (pgHandle) await pgHandle.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[boot-e2e/after] pg stop failed:', err);
    }
    try {
      await disconnectApi();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[boot-e2e/after] api disconnect failed:', err);
    }
    try {
      if (nodeHandle) await nodeHandle.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[boot-e2e/after] node stop failed:', err);
    }
    cleanupTestFiles();
    if (envSnapshot) restoreEnv(envSnapshot);
  });

  it('happy path: alice posts → catchup → claim → adapter → submit → accept → monitor withdraws → done record', async () => {
    // ----- (a) Alice posts bounty BEFORE worker boot (catchup-path coverage) -----
    const post = await aliceClient.post({
      title: 'e2e-test-title',
      description: 'e2e-test-description',
      acceptance: 'e2e-test-acceptance',
      reward: 2_000_000_000_000n,
      track: 'Services',
    });
    if (!post.ok) throw new Error(`post failed: ${post.error}`);
    const bountyId = post.value.bountyId;

    // ----- (b) Wait for indexer projection -----
    await waitForBountyProjected(bountyId, indexerHandle.baseUrl, 15_000);

    // ----- (c) Set env + boot worker -----
    setBootEnv({
      VARA_RPC_URL: 'ws://127.0.0.1:9944',
      BOUNTYMESH_PROGRAM_ID: programId,
      INDEXER_BASE_URL: indexerHandle.baseUrl,
      WORKER_TRACK: 'Services',
      WORKER_MIN_REWARD_ATOMIC: '1000000000000',
      INDEXER_MAX_LAG_BLOCKS: '1000',
      ANTHROPIC_API_KEY: 'sk-ant-test-fixture',
      // env-fallback signer path (operator discipline F):
      BOUNTYMESH_WORKER_SEED: '//Charlie',
      WORKER_STATE_PATH: STATE_PATH,
      WORKER_HISTORY_PATH: HISTORY_PATH,
      LOG_LEVEL: 'warn',
    });

    workerHandle = await boot({
      // Override selectAdapter to point the real ClaudeApiAdapter at the
      // echo server — exercises the full HTTP path + retry/timeout machinery
      // without an Anthropic API key (operator lock 1).
      selectAdapter: (cfg) =>
        new ClaudeApiAdapter({
          apiKey: 'sk-ant-test-fixture',
          model: cfg.anthropicModel,
          baseURL: echoServer.url,
        }),
    });

    // ----- (d-e) Wait for pending_accept entry -----
    await waitForPendingAccept(STATE_PATH, bountyId, 30_000);

    // ----- (f) Verify on-chain state via indexer -----
    await waitForChainStatus(bountyId, 'Submitted', indexerHandle.baseUrl, 15_000);

    // ----- (g) Alice accepts -----
    const accept = await aliceClient.accept(bountyId);
    if (!accept.ok) throw new Error(`accept failed: ${accept.error}`);

    // ----- Verify chain reflects Accepted -----
    await waitForChainStatus(bountyId, 'Accepted', indexerHandle.baseUrl, 15_000);

    // ----- (h-i) Wait for monitor's withdraw → done record -----
    await waitForDoneRecord(HISTORY_PATH, bountyId, 30_000);

    // Verify done record shape.
    const historyLines = readFileSync(HISTORY_PATH, 'utf-8')
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
    const records = historyLines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const doneRec = records.find(
      (r) => r.id === bountyId.toString() && r.status === 'done',
    );
    assert.ok(doneRec, 'done record present');
    if (!doneRec) throw new Error('unreachable');
    const txs = doneRec.tx_hashes as Record<string, string>;
    assert.match(txs.submit, /^0x[0-9a-f]{64}$/, 'submit tx hash present in done record');
    assert.match(txs.withdraw, /^0x[0-9a-f]{64}$/, 'withdraw tx hash present in done record');
    assert.match(
      doneRec.envelope_sha256 as string,
      /^0x[0-9a-f]{64}$/,
      'envelope_sha256 present in done record',
    );

    // ----- (j) pending_accept cleared + inflight null -----
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as {
      pending_accept: unknown[];
      inflight: string | null;
    };
    assert.equal(state.pending_accept.length, 0, 'pending_accept cleared after done');
    assert.equal(state.inflight, null, 'inflight cleared');
  }, 300_000);
});
