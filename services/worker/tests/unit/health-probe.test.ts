import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  IndexerProbeError,
  RETRY_DELAYS_MS,
  probeIndexerHealth,
} from '../../src/discovery/health-probe.js';

const INDEXER_URL = 'http://test-fixture-indexer.invalid';
const CHAIN_HEAD = 1000;
const MAX_LAG = 100;

function healthOk(overrides: Record<string, unknown> = {}): Response {
  // Actual indexer /health shape: chain is a flat string, NOT nested.
  const body = {
    status: 'ok',
    chain: 'connected',
    mode: 'live',
    lastFinalizedBlock: 995,
    headBlock: 1000,
    lagFromHead: 5,
    wsReconnects1h: 0,
    parseErrors1h: 0,
    uptime: '00:01:23',
    ...overrides,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

interface SleepRecorder {
  sleeps: number[];
  fn: (ms: number) => Promise<void>;
}

function recordingSleep(): SleepRecorder {
  const sleeps: number[] = [];
  return {
    sleeps,
    fn: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

describe('health-probe — probeIndexerHealth', () => {
  it('happy path: succeeds on first attempt; no sleeps recorded', async () => {
    const sleep = recordingSleep();
    const fetchFn = async (): Promise<Response> => healthOk();
    const health = await probeIndexerHealth({
      indexerBaseUrl: INDEXER_URL,
      chainHeadAtBootStart: CHAIN_HEAD,
      maxLagBlocks: MAX_LAG,
      sleepFn: sleep.fn,
      fetchFn,
    });
    assert.equal(health.status, 'ok');
    assert.equal(health.chain, 'connected');
    assert.deepEqual(sleep.sleeps, []);
  });

  it('retry schedule: 3 transport failures then success → sleeps recorded as [1s, 2s, 4s]', async () => {
    const sleep = recordingSleep();
    let attempt = 0;
    const fetchFn = async (): Promise<Response> => {
      attempt++;
      if (attempt <= 3) return new Response('', { status: 503 });
      return healthOk();
    };
    const health = await probeIndexerHealth({
      indexerBaseUrl: INDEXER_URL,
      chainHeadAtBootStart: CHAIN_HEAD,
      maxLagBlocks: MAX_LAG,
      sleepFn: sleep.fn,
      fetchFn,
    });
    assert.equal(health.status, 'ok');
    assert.deepEqual(sleep.sleeps, [1000, 2000, 4000]);
  });

  it('exhausts retries → IndexerProbeError code=unreachable', async () => {
    const sleep = recordingSleep();
    const fetchFn = async (): Promise<Response> => new Response('', { status: 503 });
    await assert.rejects(
      () =>
        probeIndexerHealth({
          indexerBaseUrl: INDEXER_URL,
          chainHeadAtBootStart: CHAIN_HEAD,
          maxLagBlocks: MAX_LAG,
          sleepFn: sleep.fn,
          fetchFn,
        }),
      (err: unknown) => {
        assert.ok(err instanceof IndexerProbeError);
        assert.equal(err.code, 'unreachable');
        return true;
      },
    );
    // Exhausted = initial + all retries. Sleep called once per retry.
    assert.equal(sleep.sleeps.length, RETRY_DELAYS_MS.length);
  });

  it('chain.status="disconnected" → IndexerProbeError code=chain-disconnected (NO retry)', async () => {
    const sleep = recordingSleep();
    const fetchFn = async (): Promise<Response> =>
      healthOk({ chain: 'disconnected' });
    await assert.rejects(
      () =>
        probeIndexerHealth({
          indexerBaseUrl: INDEXER_URL,
          chainHeadAtBootStart: CHAIN_HEAD,
          maxLagBlocks: MAX_LAG,
          sleepFn: sleep.fn,
          fetchFn,
        }),
      (err: unknown) => {
        assert.ok(err instanceof IndexerProbeError);
        assert.equal(err.code, 'chain-disconnected');
        return true;
      },
    );
    assert.deepEqual(sleep.sleeps, [], 'no retries on chain-disconnected');
  });

  it('mode!="live" → IndexerProbeError code=mode-not-live (NO retry)', async () => {
    const sleep = recordingSleep();
    const fetchFn = async (): Promise<Response> => healthOk({ mode: 'serve' });
    await assert.rejects(
      () =>
        probeIndexerHealth({
          indexerBaseUrl: INDEXER_URL,
          chainHeadAtBootStart: CHAIN_HEAD,
          maxLagBlocks: MAX_LAG,
          sleepFn: sleep.fn,
          fetchFn,
        }),
      (err: unknown) => {
        assert.ok(err instanceof IndexerProbeError);
        assert.equal(err.code, 'mode-not-live');
        return true;
      },
    );
    assert.deepEqual(sleep.sleeps, [], 'no retries on mode-not-live');
  });

  it('lastFinalizedBlock too far behind chain head → IndexerProbeError code=lag-too-high (NO retry)', async () => {
    const sleep = recordingSleep();
    const fetchFn = async (): Promise<Response> =>
      healthOk({ lastFinalizedBlock: CHAIN_HEAD - MAX_LAG - 1, lagFromHead: MAX_LAG + 1 });
    await assert.rejects(
      () =>
        probeIndexerHealth({
          indexerBaseUrl: INDEXER_URL,
          chainHeadAtBootStart: CHAIN_HEAD,
          maxLagBlocks: MAX_LAG,
          sleepFn: sleep.fn,
          fetchFn,
        }),
      (err: unknown) => {
        assert.ok(err instanceof IndexerProbeError);
        assert.equal(err.code, 'lag-too-high');
        return true;
      },
    );
    assert.deepEqual(sleep.sleeps, [], 'no retries on lag-too-high');
  });
});
