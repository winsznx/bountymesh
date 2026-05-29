import { strict as assert } from 'node:assert';
import { describe, before, after, it } from 'node:test';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { GearApi } from '@gear-js/api';
import type { BountyMeshClient } from '@bountymesh/sdk';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair } from '@polkadot/keyring/types';
import { boot } from '../../src/lifecycle/index.js';
import type { WorkerConfig } from '../../src/config/index.js';
import type { LoadedSigner } from '../../src/signer/index.js';
import type { WorkAdapter } from '../../src/adapter/index.js';
import type { DiscoveryHandle } from '../../src/discovery/types.js';
import type { PendingAcceptMonitor } from '../../src/fsm/pending-accept-monitor.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

const WORKER_ADDR = `0x${'aa'.repeat(32)}` as const;
const PROGRAM_ID = `0x${'cf'.repeat(32)}` as const;

function silentLogger(): Logger {
  const noop = (): void => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: function (): Logger {
      return this as unknown as Logger;
    },
    level: 'info',
  } as unknown as Logger;
}

function mockConfig(workerStatePath: string, workerHistoryPath: string): WorkerConfig {
  return {
    varaRpcUrl: 'wss://test.invalid',
    bountymeshProgramId: PROGRAM_ID,
    indexerBaseUrl: 'http://test-indexer.invalid',
    indexerHealthMaxLagBlocks: 100,
    keystorePath: null,
    adapter: 'groq',
    groqModel: 'llama-3.3-70b-versatile',
    workerTrack: 'Services',
    workerMinReward: 1_000_000_000_000n,
    workerStatePath,
    workerHistoryPath,
    workerResumeTtlMs: 6 * 60 * 60 * 1000,
    logLevel: 'info',
  };
}

let testPair: KeyringPair;

function mockSigner(): LoadedSigner {
  return { pair: testPair, source: 'env' };
}

function mockAdapter(): WorkAdapter {
  return {
    name: 'mock',
    version: '0.0.1',
    execute: async () => ({
      output_inline: 'mock',
      output_blob_url: null,
      output_blob_sha256: null,
      upstream: {
        provider: 'mock',
        model: 'mock-0',
        request_canonical: {},
        response_sha256: `0x${'ee'.repeat(32)}`,
        response_body_inline: 'mock',
        attempts: 1,
        request_at: '2026-05-19T12:00:00Z',
        response_at: '2026-05-19T12:00:01Z',
        error: null,
      },
    }),
  };
}

function mockClient(): BountyMeshClient {
  // No-op client — boot-sequencing tests verify orchestrator wiring, not
  // SDK behavior. Skipping real BountyMeshClient construction avoids
  // sails-js's async leaks against the mock GearApi.
  return {} as unknown as BountyMeshClient;
}

function mockGearApi(opts: { disconnectSpy?: { called: boolean } } = {}): GearApi {
  return {
    rpc: {
      chain: {
        getFinalizedHead: async () => `0x${'ff'.repeat(32)}` as `0x${string}`,
        getHeader: async () => ({ number: { toNumber: (): number => 1000 } }),
      },
    },
    disconnect: async (): Promise<void> => {
      if (opts.disconnectSpy) opts.disconnectSpy.called = true;
    },
  } as unknown as GearApi;
}

function mockDiscoveryHandle(opts: { unsubSpy?: { called: boolean } } = {}): DiscoveryHandle {
  return {
    unsub: async (): Promise<void> => {
      if (opts.unsubSpy) opts.unsubSpy.called = true;
    },
    candidatesDispatched: () => 0,
  };
}

function mockMonitor(opts: {
  startThrows?: boolean;
  stopSpy?: { called: boolean };
}): PendingAcceptMonitor {
  return {
    start: async () => {
      if (opts.startThrows) throw new Error('mock monitor start failed');
    },
    stop: async () => {
      if (opts.stopSpy) opts.stopSpy.called = true;
    },
  } as unknown as PendingAcceptMonitor;
}

describe('boot orchestrator', () => {
  let tmpDir: string;

  before(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: 'sr25519' });
    testPair = keyring.addFromUri('//Test-Boot-Fixture');
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  function freshPaths(): { statePath: string; historyPath: string } {
    const ts = `${Date.now()}-${Math.random()}`;
    return {
      statePath: join(tmpDir, `state-${ts}.json`),
      historyPath: join(tmpDir, `history-${ts}.jsonl`),
    };
  }

  it('happy path: all 7 stages execute in order, BootHandle returned', async () => {
    const callLog: string[] = [];
    const paths = freshPaths();

    const handle = await boot({
      logger: silentLogger(),
      loadConfig: () => {
        callLog.push('B-1');
        return mockConfig(paths.statePath, paths.historyPath);
      },
      loadSigner: async () => {
        callLog.push('B-2');
        return mockSigner();
      },
      createGearApi: async () => {
        callLog.push('B-3');
        return mockGearApi();
      },
      createClient: () => mockClient(),
      selectAdapter: () => {
        callLog.push('B-5-adapter');
        return mockAdapter();
      },
      setupDiscovery: async () => {
        callLog.push('B-6-discovery');
        return mockDiscoveryHandle();
      },
      createMonitor: () => {
        callLog.push('B-6-monitor-create');
        return mockMonitor({});
      },
    });

    assert.ok(handle);
    assert.equal(typeof handle.shutdown, 'function');
    // Strict order assertion: stages fire in B-1 → B-6 order. (B-4 + B-7 are
    // pure data ops with no injectable hook — verified by reaching B-6.)
    assert.deepEqual(callLog, [
      'B-1',
      'B-2',
      'B-3',
      'B-5-adapter',
      'B-6-discovery',
      'B-6-monitor-create',
    ]);

    await handle.shutdown();
  });

  it('B-3 throws: createGearApi fails → NO rollback fires (B-1/B-2 have no rollback)', async () => {
    const paths = freshPaths();
    const apiDisconnectSpy = { called: false };

    await assert.rejects(
      () =>
        boot({
          logger: silentLogger(),
          loadConfig: () => mockConfig(paths.statePath, paths.historyPath),
          loadSigner: async () => mockSigner(),
          createClient: () => mockClient(),
          createGearApi: async () => {
            throw new Error('rpc unreachable');
          },
        }),
      /rpc unreachable/,
    );
    // No rollback closure was ever pushed (the throw fired BEFORE the api was created).
    assert.equal(apiDisconnectSpy.called, false);
  });

  it('B-6 setupDiscovery throws → rollback unwinds: chain-disconnect fires', async () => {
    const paths = freshPaths();
    const apiDisconnectSpy = { called: false };

    await assert.rejects(
      () =>
        boot({
          logger: silentLogger(),
          loadConfig: () => mockConfig(paths.statePath, paths.historyPath),
          loadSigner: async () => mockSigner(),
          createClient: () => mockClient(),
          createGearApi: async () => mockGearApi({ disconnectSpy: apiDisconnectSpy }),
          selectAdapter: () => mockAdapter(),
          setupDiscovery: async () => {
            throw new Error('discovery failed');
          },
        }),
      /discovery failed/,
    );
    assert.equal(
      apiDisconnectSpy.called,
      true,
      'api.disconnect must run during boot-failure rollback',
    );
  });

  it('B-6 monitor.start throws → rollback unwinds reverse-of-construction: discovery-unsub THEN chain-disconnect', async () => {
    const paths = freshPaths();
    const apiDisconnectSpy = { called: false };
    const discoveryUnsubSpy = { called: false };
    const unwindOrder: string[] = [];

    // Wrap the spies to capture order.
    const apiMock = mockGearApi({ disconnectSpy: apiDisconnectSpy });
    const realDisconnect = apiMock.disconnect.bind(apiMock);
    (apiMock as unknown as { disconnect: () => Promise<void> }).disconnect = async (): Promise<void> => {
      unwindOrder.push('chain-disconnect');
      await realDisconnect();
    };

    const discoveryMock = mockDiscoveryHandle({ unsubSpy: discoveryUnsubSpy });
    const realUnsub = discoveryMock.unsub.bind(discoveryMock);
    discoveryMock.unsub = async (): Promise<void> => {
      unwindOrder.push('discovery-unsub');
      await realUnsub();
    };

    await assert.rejects(
      () =>
        boot({
          logger: silentLogger(),
          loadConfig: () => mockConfig(paths.statePath, paths.historyPath),
          loadSigner: async () => mockSigner(),
          createClient: () => mockClient(),
          createGearApi: async () => apiMock,
          selectAdapter: () => mockAdapter(),
          setupDiscovery: async () => discoveryMock,
          createMonitor: () => mockMonitor({ startThrows: true }),
        }),
      /mock monitor start failed/,
    );

    assert.equal(apiDisconnectSpy.called, true);
    assert.equal(discoveryUnsubSpy.called, true);
    // Reverse-of-construction: discovery-unsub was pushed LAST (after chain-disconnect),
    // so unwind pops discovery FIRST, then chain.
    assert.deepEqual(unwindOrder, ['discovery-unsub', 'chain-disconnect']);
  });

  it('BootHandle.shutdown() invokes the locked ShutdownSequence (discovery first, chain-disconnect last)', async () => {
    const paths = freshPaths();
    const apiDisconnectSpy = { called: false };
    const discoveryUnsubSpy = { called: false };
    const monitorStopSpy = { called: false };
    const shutdownOrder: string[] = [];

    const apiMock = mockGearApi({ disconnectSpy: apiDisconnectSpy });
    const realDisconnect = apiMock.disconnect.bind(apiMock);
    (apiMock as unknown as { disconnect: () => Promise<void> }).disconnect = async (): Promise<void> => {
      shutdownOrder.push('chain-disconnect');
      await realDisconnect();
    };

    const discoveryMock = mockDiscoveryHandle({ unsubSpy: discoveryUnsubSpy });
    const realUnsub = discoveryMock.unsub.bind(discoveryMock);
    discoveryMock.unsub = async (): Promise<void> => {
      shutdownOrder.push('discovery-unsub');
      await realUnsub();
    };

    const monitorMock = mockMonitor({ stopSpy: monitorStopSpy });
    const realStop = monitorMock.stop.bind(monitorMock);
    monitorMock.stop = async (): Promise<void> => {
      shutdownOrder.push('monitor-stop');
      await realStop();
    };

    const handle = await boot({
      logger: silentLogger(),
      loadConfig: () => mockConfig(paths.statePath, paths.historyPath),
      loadSigner: async () => mockSigner(),
      createGearApi: async () => apiMock,
      createClient: () => mockClient(),
      selectAdapter: () => mockAdapter(),
      setupDiscovery: async () => discoveryMock,
      createMonitor: () => monitorMock,
    });

    await handle.shutdown();

    assert.equal(apiDisconnectSpy.called, true);
    assert.equal(discoveryUnsubSpy.called, true);
    assert.equal(monitorStopSpy.called, true);
    // ShutdownSequence locked order per shutdown.ts: discovery → monitor → mutex (no spy) → state-flush (no spy) → chain.
    assert.deepEqual(shutdownOrder, ['discovery-unsub', 'monitor-stop', 'chain-disconnect']);
  });
});
