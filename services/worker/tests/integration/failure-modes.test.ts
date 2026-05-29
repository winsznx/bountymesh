import { strict as assert } from 'node:assert';
import { describe, before, after, it } from 'node:test';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { KeyringPair } from '@polkadot/keyring/types';
import { BountyMeshClient } from '@bountymesh/sdk';
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
import { spawnWorker, type WorkerSubprocess } from '../harness/workerSubprocess.js';
import {
  waitForBountyProjected,
  waitForChainStatus,
  waitForDoneRecord,
  waitForPendingAccept,
} from '../harness/waits.js';

function cleanupFiles(paths: readonly string[]): void {
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* best-effort */
      }
    }
  }
}

function envForBoot(opts: {
  statePath: string;
  historyPath: string;
  programId: string;
  indexerUrl: string;
  echoUrl: string;
  workerSeed: string;
}): Record<string, string> {
  return {
    VARA_RPC_URL: 'ws://127.0.0.1:9944',
    BOUNTYMESH_PROGRAM_ID: opts.programId,
    INDEXER_BASE_URL: opts.indexerUrl,
    WORKER_TRACK: 'Services',
    WORKER_MIN_REWARD_ATOMIC: '1000000000000',
    INDEXER_MAX_LAG_BLOCKS: '1000',
    GROQ_API_KEY: 'gsk_test-fixture',
    // Adapter HTTP routed to local echo server.
    GROQ_BASE_URL: opts.echoUrl,
    BOUNTYMESH_WORKER_SEED: opts.workerSeed,
    WORKER_STATE_PATH: opts.statePath,
    WORKER_HISTORY_PATH: opts.historyPath,
    LOG_LEVEL: 'info',
  };
}

describe('failure-mode integration: crash-resume + post-Accept boot-resume', () => {
  let nodeHandle: LocalNodeHandle;
  let api: GearApi;
  let aliceClient: BountyMeshClient;
  let aliceSigner: KeyringPair;
  let charlieSigner: KeyringPair;
  let programId: HexString;
  let pgHandle: PostgresHandle;
  let indexerHandle: IndexerSubprocessHandle;
  let echoServer: EchoServerHandle;

  before(async () => {
    nodeHandle = await startLocalNode();
    await initDevSigners();
    aliceSigner = alice();
    charlieSigner = charlie();
    api = await getApi();
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
  }, 180_000);

  after(async () => {
    try {
      if (echoServer) await echoServer.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[failure-modes/after] echo stop:', err);
    }
    try {
      if (indexerHandle) await indexerHandle.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[failure-modes/after] indexer stop:', err);
    }
    try {
      if (pgHandle) await pgHandle.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[failure-modes/after] pg stop:', err);
    }
    try {
      await disconnectApi();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[failure-modes/after] api disconnect:', err);
    }
    try {
      if (nodeHandle) await nodeHandle.stop();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[failure-modes/after] node stop:', err);
    }
  });

  it('Test 1: crash-resume across process restart — second worker logs adapter execute-start with crashResumed=true', async () => {
    const STATE = '/tmp/worker-crash-test.state.json';
    const HIST = '/tmp/worker-crash-test.history.jsonl';
    cleanupFiles([STATE, HIST]);

    let worker1: WorkerSubprocess | null = null;
    let worker2: WorkerSubprocess | null = null;
    try {
      // Alice posts bounty + wait for indexer projection.
      const post = await aliceClient.post({
        title: 'crash-resume-title',
        description: 'crash-resume-desc',
        acceptance: 'crash-resume-acceptance',
        reward: 2_000_000_000_000n,
        track: 'Services',
      });
      if (!post.ok) throw new Error(`post: ${post.error}`);
      const bountyId = post.value.bountyId;
      const bountyIdStr = bountyId.toString();
      await waitForBountyProjected(bountyId, indexerHandle.baseUrl, 15_000);

      const env = envForBoot({
        statePath: STATE,
        historyPath: HIST,
        programId,
        indexerUrl: indexerHandle.baseUrl,
        echoUrl: echoServer.url,
        workerSeed: '//Charlie',
      });

      // ----- Spawn worker #1 -----
      worker1 = spawnWorker(env);

      // Wait for FSM transition Claiming → Working — guarantees Claim is
      // finalized on chain (operator P3.10b lock 1; SIGKILL before this
      // risks killing pre-finality).
      await worker1.waitForLog(
        (e) =>
          e.op === 'fsm' &&
          e.event === 'transition' &&
          e.from === 'Claiming' &&
          e.to === 'Working' &&
          e.bountyId === bountyIdStr,
        90_000,
        'fsm transition Claiming→Working',
      );

      // SIGKILL — abrupt crash (operator P3.10b discipline J).
      await worker1.kill('SIGKILL');

      // Wait for indexer to project status=Claimed before respawning. The
      // chain-finality → indexer-projection lag can be 1-3 blocks; without
      // this wait, worker2's resume orchestrator queries the indexer too
      // early, sees status=Open (stale projection of the BountyPosted event),
      // clears inflight, and skips resume — the crash-resume path is bypassed
      // and the test asserts crashResumed=true that never fires.
      await waitForChainStatus(bountyId, 'Claimed', indexerHandle.baseUrl, 15_000);

      // ----- Spawn worker #2 with same env -----
      worker2 = spawnWorker(env);

      // The load-bearing proof line (operator P3.10b lock for Test 1):
      // resumed worker logs adapter execute-start with crashResumed=true.
      await worker2.waitForLog(
        (e) =>
          e.op === 'adapter' &&
          e.event === 'execute-start' &&
          e.bountyId === bountyIdStr &&
          e.crashResumed === true,
        90_000,
        'adapter execute-start crashResumed=true',
      );

      // Continue lifecycle: wait for Submit, accept, Withdraw, done record.
      await waitForPendingAccept(STATE, bountyId, 60_000);
      const accept = await aliceClient.accept(bountyId);
      if (!accept.ok) throw new Error(`accept: ${accept.error}`);
      await waitForChainStatus(bountyId, 'Accepted', indexerHandle.baseUrl, 15_000);
      await waitForDoneRecord(HIST, bountyId, 60_000);

      // Verify done record presence.
      const lines = readFileSync(HIST, 'utf-8').trim().split('\n');
      const doneRec = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((r) => r.id === bountyIdStr && r.status === 'done');
      assert.ok(doneRec, 'done record present after crash-resume');
    } finally {
      if (worker1) {
        try {
          await worker1.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
      if (worker2) {
        try {
          await worker2.kill('SIGTERM');
        } catch {
          /* graceful shutdown */
        }
      }
      cleanupFiles([STATE, HIST]);
    }
  }, 600_000);

  it('Test 2: post-Accept boot-resume — Monitor.boot-resume-fired with source=indexer-query', async () => {
    const STATE = '/tmp/worker-postacc-test.state.json';
    const HIST = '/tmp/worker-postacc-test.history.jsonl';
    cleanupFiles([STATE, HIST]);

    let worker1: WorkerSubprocess | null = null;
    let worker2: WorkerSubprocess | null = null;
    try {
      const post = await aliceClient.post({
        title: 'postacc-title',
        description: 'postacc-desc',
        acceptance: 'postacc-acceptance',
        reward: 2_000_000_000_000n,
        track: 'Services',
      });
      if (!post.ok) throw new Error(`post: ${post.error}`);
      const bountyId = post.value.bountyId;
      const bountyIdStr = bountyId.toString();
      await waitForBountyProjected(bountyId, indexerHandle.baseUrl, 15_000);

      const env = envForBoot({
        statePath: STATE,
        historyPath: HIST,
        programId,
        indexerUrl: indexerHandle.baseUrl,
        echoUrl: echoServer.url,
        workerSeed: '//Charlie',
      });

      // ----- Spawn worker #1 — let it claim+submit -----
      worker1 = spawnWorker(env);
      await waitForPendingAccept(STATE, bountyId, 90_000);

      // SIGKILL while worker is awaiting Accept.
      await worker1.kill('SIGKILL');

      // Alice accepts off-screen.
      const accept = await aliceClient.accept(bountyId);
      if (!accept.ok) throw new Error(`accept: ${accept.error}`);
      await waitForChainStatus(bountyId, 'Accepted', indexerHandle.baseUrl, 15_000);

      // ----- Spawn worker #2; expect Monitor boot-resume to catch the Accept -----
      worker2 = spawnWorker(env);

      // The load-bearing proof line (operator P3.10b lock for Test 2):
      // Monitor logs boot-resume-fired with source='indexer-query',
      // NOT live-fired with source='live-subscription'.
      await worker2.waitForLog(
        (e) =>
          e.op === 'monitor' &&
          e.event === 'boot-resume-fired' &&
          e.bountyId === bountyIdStr &&
          e.source === 'indexer-query',
        90_000,
        'monitor boot-resume-fired (source=indexer-query)',
      );

      // Verify the Withdraw completes + done record written.
      await waitForDoneRecord(HIST, bountyId, 60_000);
      const lines = readFileSync(HIST, 'utf-8').trim().split('\n');
      const doneRec = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((r) => r.id === bountyIdStr && r.status === 'done');
      assert.ok(doneRec, 'done record present after post-Accept boot-resume');
    } finally {
      if (worker1) {
        try {
          await worker1.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
      if (worker2) {
        try {
          await worker2.kill('SIGTERM');
        } catch {
          /* graceful */
        }
      }
      cleanupFiles([STATE, HIST]);
    }
  }, 600_000);
});
