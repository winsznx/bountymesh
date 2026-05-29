import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, it } from 'node:test';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { createFilterPipeline } from '../../src/filter/pipeline.js';
import { WorkHistoryDedup } from '../../src/filter/dedup.js';
import { InflightSerializer } from '../../src/filter/serializer.js';
import type { Candidate } from '../../src/discovery/types.js';
import type { WorkerConfig } from '../../src/config/index.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

const MY_ADDRESS = `0x${'aa'.repeat(32)}` as const;
const OTHER_ADDRESS = `0x${'bb'.repeat(32)}` as const;

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1n,
    poster: OTHER_ADDRESS,
    reward: 2_000_000_000_000n,
    track: 'Services',
    postedAt: 100,
    title: 'fixture',
    description: 'fixture-d',
    acceptance: 'fixture-a',
    deadline: null,
    blockHash: null,
    txHash: null,
    phase: 'live',
    ...overrides,
  };
}

function makeConfig(): WorkerConfig {
  return {
    varaRpcUrl: 'wss://test.invalid',
    bountymeshProgramId: `0x${'cf'.repeat(32)}`,
    indexerBaseUrl: 'http://test.invalid',
    indexerHealthMaxLagBlocks: 100,
    keystorePath: null,
    adapter: 'claude-api',
    anthropicModel: 'claude-opus-4-7',
    workerTrack: 'Services',
    workerMinReward: 1_000_000_000_000n,
    workerStatePath: '/tmp/test.state.json',
    workerHistoryPath: '/tmp/test.history.jsonl',
    workerResumeTtlMs: 6 * 60 * 60 * 1000,
    logLevel: 'info',
  };
}

interface CapturedLog {
  level: 'info' | 'error';
  fields: Record<string, unknown>;
}

function makeLogger(): { logs: CapturedLog[]; logger: Logger } {
  const logs: CapturedLog[] = [];
  const logger = {
    info: (obj: Record<string, unknown>): void => {
      logs.push({ level: 'info', fields: obj });
    },
    error: (obj: Record<string, unknown>): void => {
      logs.push({ level: 'error', fields: obj });
    },
    warn: (): void => undefined,
    debug: (): void => undefined,
    trace: (): void => undefined,
    fatal: (): void => undefined,
    child: function (): Logger {
      return this as unknown as Logger;
    },
    level: 'info',
  } as unknown as Logger;
  return { logs, logger };
}

describe('createFilterPipeline', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  function freshDeps(): {
    dedup: WorkHistoryDedup;
    serializer: InflightSerializer;
    historyPath: string;
  } {
    const historyPath = join(tmpDir, `history-${Date.now()}-${Math.random()}.jsonl`);
    const dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    return { dedup, serializer: new InflightSerializer(), historyPath };
  }

  beforeEach(() => {
    /* per-test fresh deps via freshDeps() */
  });

  it('happy path: candidate passes all filters → onAccepted called, serializer holds slot', async () => {
    const { dedup, serializer } = freshDeps();
    const accepted: Candidate[] = [];
    const { logger } = makeLogger();
    const pipeline = createFilterPipeline({
      config: makeConfig(),
      myAddress: MY_ADDRESS,
      workHistory: dedup,
      serializer,
      getCurrentBlock: async () => 500,
      onAccepted: (c) => {
        accepted.push(c);
      },
      logger,
    });

    await pipeline(makeCandidate({ id: 7n }));
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].id, 7n);
    assert.equal(serializer.isInflight(), true);
    assert.equal(serializer.inflightId(), 7n);
  });

  it('dedup rejects: candidate.id already in work_history → drop, onAccepted not called', async () => {
    const { dedup, serializer } = freshDeps();
    dedup.add(42n);

    const accepted: Candidate[] = [];
    const { logs, logger } = makeLogger();
    const pipeline = createFilterPipeline({
      config: makeConfig(),
      myAddress: MY_ADDRESS,
      workHistory: dedup,
      serializer,
      getCurrentBlock: async () => 500,
      onAccepted: (c) => {
        accepted.push(c);
      },
      logger,
    });

    await pipeline(makeCandidate({ id: 42n }));
    assert.equal(accepted.length, 0);
    assert.equal(serializer.isInflight(), false);
    assert.equal(logs[0].fields.reason, 'in-work-history');
  });

  it('serializer rejects: inflight busy → drop, onAccepted not called', async () => {
    const { dedup, serializer } = freshDeps();
    serializer.tryAcquire(99n); // pre-occupy

    const accepted: Candidate[] = [];
    const { logs, logger } = makeLogger();
    const pipeline = createFilterPipeline({
      config: makeConfig(),
      myAddress: MY_ADDRESS,
      workHistory: dedup,
      serializer,
      getCurrentBlock: async () => 500,
      onAccepted: (c) => {
        accepted.push(c);
      },
      logger,
    });

    await pipeline(makeCandidate({ id: 5n }));
    assert.equal(accepted.length, 0);
    assert.equal(serializer.inflightId(), 99n, 'pre-existing inflight unaffected');
    assert.equal(logs[0].fields.reason, 'inflight-busy');
  });

  it('structural rejects: track mismatch → drop, serializer released', async () => {
    const { dedup, serializer } = freshDeps();
    const accepted: Candidate[] = [];
    const { logs, logger } = makeLogger();
    const pipeline = createFilterPipeline({
      config: makeConfig(),
      myAddress: MY_ADDRESS,
      workHistory: dedup,
      serializer,
      getCurrentBlock: async () => 500,
      onAccepted: (c) => {
        accepted.push(c);
      },
      logger,
    });

    await pipeline(makeCandidate({ id: 5n, track: 'Open' }));
    assert.equal(accepted.length, 0);
    assert.equal(serializer.isInflight(), false, 'serializer released after structural reject');
    assert.match(logs[0].fields.reason as string, /track-mismatch/);
  });

  it('deadline rejects: deadline ≤ currentBlock → drop, serializer released', async () => {
    const { dedup, serializer } = freshDeps();
    const accepted: Candidate[] = [];
    const { logs, logger } = makeLogger();
    const pipeline = createFilterPipeline({
      config: makeConfig(),
      myAddress: MY_ADDRESS,
      workHistory: dedup,
      serializer,
      getCurrentBlock: async () => 1000,
      onAccepted: (c) => {
        accepted.push(c);
      },
      logger,
    });

    await pipeline(makeCandidate({ id: 5n, deadline: 999 }));
    assert.equal(accepted.length, 0);
    assert.equal(serializer.isInflight(), false, 'serializer released after deadline reject');
    assert.match(logs[0].fields.reason as string, /deadline-passed/);
  });

  it('order: dedup runs BEFORE serializer (id in history but also wrong track → dedup wins)', async () => {
    const { dedup, serializer } = freshDeps();
    dedup.add(42n);

    const { logs, logger } = makeLogger();
    const pipeline = createFilterPipeline({
      config: makeConfig(),
      myAddress: MY_ADDRESS,
      workHistory: dedup,
      serializer,
      getCurrentBlock: async () => 500,
      onAccepted: () => undefined,
      logger,
    });

    // Candidate would also fail structural (Open track) AND deadline. Dedup
    // runs first; reason MUST be 'in-work-history'. Serializer must NOT have
    // been acquired (we'd see no release-after-acquire side effect).
    await pipeline(makeCandidate({ id: 42n, track: 'Open', deadline: 1 }));
    assert.equal(logs[0].fields.reason, 'in-work-history');
    assert.equal(serializer.isInflight(), false);
  });

  it('onAccepted throws → serializer released defensively, error propagates', async () => {
    const { dedup, serializer } = freshDeps();
    const { logs, logger } = makeLogger();
    const pipeline = createFilterPipeline({
      config: makeConfig(),
      myAddress: MY_ADDRESS,
      workHistory: dedup,
      serializer,
      getCurrentBlock: async () => 500,
      onAccepted: () => {
        throw new Error('downstream FSM bug');
      },
      logger,
    });

    await assert.rejects(
      () => pipeline(makeCandidate({ id: 5n })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'downstream FSM bug');
        return true;
      },
    );
    assert.equal(serializer.isInflight(), false, 'serializer released on onAccepted throw');
    const errLog = logs.find((l) => l.level === 'error');
    assert.ok(errLog, 'error log emitted');
  });
});
