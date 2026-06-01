/**
 * Boot orchestrator — wires every worker subsystem into a runnable process.
 *
 * 7-stage operator-locked sequence. Each stage logs entry + pushes a rollback
 * closure onto a LIFO stack iff it allocated a resource needing teardown. On
 * any throw, unwind in reverse-of-construction; on success, return a BootHandle
 * whose shutdown() runs the operator-locked ShutdownSequence (shutdown.ts).
 */

import { u8aToHex } from '@polkadot/util';
import { GearApi } from '@gear-js/api';
import pino, { type Logger } from 'pino';
import { BountyMeshClient } from '@bountymesh/sdk';
import { selectAdapter as defaultSelectAdapter } from '../adapter/index.js';
import { loadConfig as defaultLoadConfig } from '../config/index.js';
import { setupDiscovery as defaultSetupDiscovery } from '../discovery/index.js';
import { createFilterPipeline } from '../filter/pipeline.js';
import { WorkHistoryDedup } from '../filter/dedup.js';
import { InflightSerializer } from '../filter/serializer.js';
import { MainFsm } from '../fsm/main.js';
import {
  PendingAcceptMonitor,
  type PendingAcceptMonitorDeps,
} from '../fsm/pending-accept-monitor.js';
import { SignerMutex } from '../fsm/signer-mutex.js';
import { loadSigner as defaultLoadSigner, type LoadSignerOptions } from '../signer/index.js';
import { WorkerStateFile } from '../state/worker-state.js';
import { recoverInflight } from './resume.js';
import { ShutdownSequence, type ShutdownStep } from './shutdown.js';
import type { BootHandle, BootOptions, BootStage } from './types.js';
import { getVaraUsdRate, getInfinitebountyOpen } from '../external.js';

const EXTERNAL_TICK_MS = 5 * 60 * 1000;
const EXTERNAL_PRICE_EVERY_N_CYCLES = 12;

async function defaultCreateGearApi(rpcUrl: string): Promise<GearApi> {
  return GearApi.create({ providerAddress: rpcUrl });
}

function defaultCreateMonitor(deps: PendingAcceptMonitorDeps): PendingAcceptMonitor {
  return new PendingAcceptMonitor(deps);
}

export async function boot(opts: BootOptions = {}): Promise<BootHandle> {
  const logger: Logger = opts.logger ?? pino({ level: 'info' });
  const enter = (stage: BootStage, msg?: string): void => {
    logger.info({ op: 'boot', stage, msg: msg ?? '' });
  };

  const rollback: ShutdownStep[] = [];
  async function unwind(): Promise<void> {
    while (rollback.length > 0) {
      const step = rollback.pop();
      if (!step) break;
      try {
        await step.fn();
      } catch (err) {
        logger.error(
          {
            op: 'boot',
            stage: 'rollback',
            step: step.name,
            err: err instanceof Error ? err.message : String(err),
          },
          'rollback step failed',
        );
      }
    }
  }

  try {
    // ----- B-1: loadConfig -----
    enter('B-1', 'loadConfig');
    const config = (opts.loadConfig ?? defaultLoadConfig)();

    // ----- B-2: loadSigner -----
    enter('B-2', 'loadSigner');
    const signerLoadOpts: LoadSignerOptions =
      config.keystorePath !== null ? { keystorePath: config.keystorePath } : {};
    const signer = await (opts.loadSigner ?? defaultLoadSigner)(signerLoadOpts);

    // ----- B-3: connectChain -----
    enter('B-3', 'connectChain');
    const api = await (opts.createGearApi ?? defaultCreateGearApi)(config.varaRpcUrl);
    rollback.push({ name: 'chain-disconnect', fn: () => api.disconnect() });
    const createClient = opts.createClient ?? ((o) => new BountyMeshClient(o));
    const client = createClient({
      api,
      programId: config.bountymeshProgramId,
      signer: signer.pair,
    });

    // ----- B-4: loadState -----
    enter('B-4', 'loadState');
    const workerState = new WorkerStateFile(config.workerStatePath);
    workerState.load();
    const dedup = new WorkHistoryDedup(config.workerHistoryPath);
    dedup.load();

    // ----- B-5: assemble -----
    enter('B-5', 'assemble');
    const signerMutex = new SignerMutex();
    const serializer = new InflightSerializer();
    const adapter = (opts.selectAdapter ?? defaultSelectAdapter)(config);
    const workerAddress = u8aToHex(signer.pair.publicKey) as `0x${string}`;
    const getCurrentBlock = async (): Promise<number> => {
      const hash = await api.rpc.chain.getFinalizedHead();
      const header = await api.rpc.chain.getHeader(hash);
      return header.number.toNumber();
    };

    const fsm = new MainFsm({
      client,
      api,
      adapter,
      workerState,
      dedup,
      historyPath: config.workerHistoryPath,
      serializer,
      signerMutex,
      workerAddress,
      getCurrentBlock,
      logger,
    });

    const filterPipeline = createFilterPipeline({
      config,
      myAddress: workerAddress,
      workHistory: dedup,
      serializer,
      getCurrentBlock,
      onAccepted: async (candidate) => {
        await fsm.run(candidate);
      },
      logger,
    });

    // ----- B-5.5: resume inflight (if any) -----
    // Runs BEFORE discovery opens, so the resume FSM's serializer acquire
    // pre-empts any concurrent live BountyPosted candidates. recoverInflight
    // throws on chain/indexer query failure → boot fails + rollback unwinds.
    // Fire-and-forget FSM.run if resuming Claimed → boot doesn't await Submit.
    enter('B-5', 'resume-check');
    await recoverInflight({
      workerState,
      fsm,
      dedup,
      historyPath: config.workerHistoryPath,
      indexerBaseUrl: config.indexerBaseUrl,
      workerAddress,
      serializer,
      logger,
    });

    // ----- B-6: goLive -----
    enter('B-6', 'goLive');
    const chainHeadAtBootStart = await getCurrentBlock();
    const discoveryHandle = await (opts.setupDiscovery ?? defaultSetupDiscovery)({
      client,
      config,
      chainHeadAtBootStart,
      consumer: filterPipeline,
    });
    rollback.push({ name: 'discovery-unsub', fn: () => discoveryHandle.unsub() });

    const monitor = (opts.createMonitor ?? defaultCreateMonitor)({
      client,
      workerState,
      dedup,
      historyPath: config.workerHistoryPath,
      signerMutex,
      indexerBaseUrl: config.indexerBaseUrl,
      workerAddress,
      logger,
    });
    await monitor.start();
    rollback.push({ name: 'monitor-stop', fn: () => monitor.stop() });

    // ----- B-6.5: external ecosystem side-loop -----
    // Purely additive: drives one signed extrinsic to @varabridge (≤1/hour)
    // and, when the claim queue is idle, one read-only query against
    // @infinite-bounty-v3 per tick. Failures are swallowed inside external.ts;
    // this loop never throws and never touches FSM state.
    let externalCycleIndex = 0;
    const externalTick = async (): Promise<void> => {
      const idx = externalCycleIndex++;
      try {
        if (idx % EXTERNAL_PRICE_EVERY_N_CYCLES === 0) {
          const price = await getVaraUsdRate(api, signer.pair);
          if (price !== null) {
            logger.info({
              op: 'external',
              target: 'varabridge',
              method: 'GetPrice',
              symbol: price.symbol,
              usd: price.usd,
              txHash: price.txHash,
              cycleIndex: idx,
            });
          } else {
            logger.warn({
              op: 'external',
              target: 'varabridge',
              method: 'GetPrice',
              result: 'null',
              cycleIndex: idx,
            });
          }
        }
        if (!serializer.isInflight()) {
          const summary = await getInfinitebountyOpen(api, 10);
          if (summary !== null) {
            logger.info({
              op: 'external',
              target: 'infinite-bounty-v3',
              method: 'GetBountiesByStatus',
              status: 'Open',
              count: summary.count,
              ids: summary.ids,
              cycleIndex: idx,
              msg: `external bounty discovery: ${summary.count} open on infinite-bounty-v3`,
            });
          } else {
            logger.warn({
              op: 'external',
              target: 'infinite-bounty-v3',
              method: 'GetBountiesByStatus',
              result: 'null',
              cycleIndex: idx,
            });
          }
        }
      } catch (err) {
        logger.error(
          {
            op: 'external',
            err: err instanceof Error ? err.message : String(err),
          },
          'external side-loop tick threw — swallowed',
        );
      }
    };
    const externalInterval = setInterval(() => {
      void externalTick();
    }, EXTERNAL_TICK_MS);
    rollback.push({
      name: 'external-loop-stop',
      fn: async () => {
        clearInterval(externalInterval);
      },
    });
    // Fire the first tick immediately (don't wait 5 min for the first price call).
    void externalTick();

    // ----- B-7: ready -----
    enter('B-7', 'ready');
    logger.info({
      op: 'boot',
      stage: 'B-7',
      worker: workerAddress,
      source: signer.source,
      adapter: adapter.name,
      msg: 'worker is live',
    });

    // Build the post-boot ShutdownSequence with operator-locked order.
    // DIFFERENT from rollback stack: shutdown is observability-quiet first
    // (stop sources of work), then quiet state, then chain.
    const shutdownSeq = new ShutdownSequence(
      [
        { name: 'discovery-unsub', fn: () => discoveryHandle.unsub() },
        { name: 'monitor-stop', fn: () => monitor.stop() },
        {
          name: 'external-loop-stop',
          fn: async () => {
            clearInterval(externalInterval);
          },
        },
        {
          name: 'mutex-flush',
          fn: async () => {
            await signerMutex.runExclusive(async () => undefined);
          },
        },
        { name: 'state-flush', fn: () => workerState.flush() },
        { name: 'chain-disconnect', fn: () => api.disconnect() },
      ],
      logger,
    );

    return {
      shutdown: () => shutdownSeq.shutdown(),
    };
  } catch (err) {
    logger.error(
      {
        op: 'boot',
        err: err instanceof Error ? err.message : String(err),
      },
      'boot failed; unwinding',
    );
    await unwind();
    throw err;
  }
}
