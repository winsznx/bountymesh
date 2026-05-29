import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, it } from 'node:test';
import {
  ConfigError,
  loadConfig,
  type WorkerConfig,
} from '../../src/config/index.js';
import {
  validateBigInt,
  validateEnum,
  validateHex,
  validateNumber,
  validateUrl,
} from '../../src/config/validators.js';

const ALL_WORKER_VARS = [
  'VARA_RPC_URL',
  'BOUNTYMESH_PROGRAM_ID',
  'INDEXER_BASE_URL',
  'WORKER_TRACK',
  'WORKER_MIN_REWARD_ATOMIC',
  'INDEXER_MAX_LAG_BLOCKS',
  'WORKER_KEYSTORE_PATH',
  'WORKER_ADAPTER',
  'GROQ_MODEL',
  'WORKER_STATE_PATH',
  'WORKER_HISTORY_PATH',
  'WORKER_RESUME_TTL_MS',
  'LOG_LEVEL',
] as const;

const REQUIRED_VARS: ReadonlyArray<(typeof ALL_WORKER_VARS)[number]> = [
  'VARA_RPC_URL',
  'BOUNTYMESH_PROGRAM_ID',
  'INDEXER_BASE_URL',
  'WORKER_TRACK',
  'WORKER_MIN_REWARD_ATOMIC',
];

const FIXTURE_RPC = 'wss://test-fixture-rpc.invalid';
const FIXTURE_PROGRAM_ID = `0x${'cf'.repeat(32)}` as const;
const FIXTURE_INDEXER = 'http://test-fixture-indexer.invalid';
const FIXTURE_TRACK = 'Services';
const FIXTURE_MIN_REWARD = '12345678901234567890';

function setRequiredEnv(): void {
  process.env.VARA_RPC_URL = FIXTURE_RPC;
  process.env.BOUNTYMESH_PROGRAM_ID = FIXTURE_PROGRAM_ID;
  process.env.INDEXER_BASE_URL = FIXTURE_INDEXER;
  process.env.WORKER_TRACK = FIXTURE_TRACK;
  process.env.WORKER_MIN_REWARD_ATOMIC = FIXTURE_MIN_REWARD;
}

describe('config — validators', () => {
  describe('validateUrl', () => {
    it('accepts a valid wss:// URL when protocol allowed', () => {
      const r = validateUrl('TEST', 'wss://rpc.example/path', ['ws:', 'wss:']);
      assert.ok(r.ok);
      assert.equal(r.value, 'wss://rpc.example/path');
    });

    it('rejects a URL with a disallowed protocol', () => {
      const r = validateUrl('TEST', 'http://example/x', ['ws:', 'wss:']);
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'invalid-format');
      assert.match(r.error.detail, /protocol http:/);
    });
  });

  describe('validateHex', () => {
    it('accepts 0x + 64 hex chars for 32-byte length', () => {
      const r = validateHex('TEST', `0x${'ab'.repeat(32)}`, 32);
      assert.ok(r.ok);
      assert.equal(r.value.length, 66);
    });

    it('rejects wrong length', () => {
      const r = validateHex('TEST', `0x${'ab'.repeat(16)}`, 32);
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'invalid-format');
      assert.match(r.error.detail, /expected 66 chars/);
    });

    it('rejects non-hex characters', () => {
      const r = validateHex('TEST', `0x${'gg'.repeat(32)}`, 32);
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'invalid-format');
      assert.match(r.error.detail, /non-hex/);
    });
  });

  describe('validateBigInt', () => {
    it('accepts a positive bigint string', () => {
      const r = validateBigInt('TEST', '12345678901234567890', { min: 0n });
      assert.ok(r.ok);
      assert.equal(r.value, 12345678901234567890n);
    });

    it('rejects negative when min=0', () => {
      const r = validateBigInt('TEST', '-1', { min: 0n });
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'invalid-range');
    });
  });

  describe('validateEnum', () => {
    it('accepts a value in the allowed set', () => {
      const r = validateEnum('TEST', 'Services', ['Services', 'Social'] as const);
      assert.ok(r.ok);
      assert.equal(r.value, 'Services');
    });

    it('rejects a value not in the allowed set', () => {
      const r = validateEnum('TEST', 'Politics', ['Services', 'Social'] as const);
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'invalid-format');
    });
  });

  describe('validateNumber', () => {
    it('accepts a positive integer within range', () => {
      const r = validateNumber('TEST', '42', { min: 1, max: 100 });
      assert.ok(r.ok);
      assert.equal(r.value, 42);
    });

    it('rejects a value below min', () => {
      const r = validateNumber('TEST', '0', { min: 1 });
      assert.ok(!r.ok);
      assert.equal(r.error.code, 'invalid-range');
    });
  });
});

describe('config — loadConfig', () => {
  const originals = new Map<string, string | undefined>();

  before(() => {
    for (const v of ALL_WORKER_VARS) originals.set(v, process.env[v]);
  });

  after(() => {
    for (const [v, prev] of originals) {
      if (prev === undefined) delete process.env[v];
      else process.env[v] = prev;
    }
  });

  beforeEach(() => {
    for (const v of ALL_WORKER_VARS) delete process.env[v];
  });

  it('happy path: all required env vars valid → returns full WorkerConfig', () => {
    setRequiredEnv();
    const cfg: WorkerConfig = loadConfig();
    assert.equal(cfg.varaRpcUrl, FIXTURE_RPC);
    assert.equal(cfg.bountymeshProgramId, FIXTURE_PROGRAM_ID);
    assert.equal(cfg.indexerBaseUrl, FIXTURE_INDEXER);
    assert.equal(cfg.workerTrack, FIXTURE_TRACK);
    assert.equal(cfg.workerMinReward, BigInt(FIXTURE_MIN_REWARD));
  });

  it('defaults applied when only required vars are set', () => {
    setRequiredEnv();
    const cfg = loadConfig();
    assert.equal(cfg.indexerHealthMaxLagBlocks, 100);
    assert.equal(cfg.adapter, 'groq');
    assert.equal(cfg.groqModel, 'llama-3.3-70b-versatile');
    assert.equal(cfg.workerResumeTtlMs, 6 * 60 * 60 * 1000);
    assert.equal(cfg.logLevel, 'info');
    assert.equal(cfg.keystorePath, null);
    assert.match(cfg.workerStatePath, /worker\.state\.json$/);
    assert.match(cfg.workerHistoryPath, /worker\.history\.jsonl$/);
  });

  it('multiple missing vars surface ALL errors at once (aggregator proof)', () => {
    // No env vars set. Expect ConfigError listing every required var.
    assert.throws(
      () => loadConfig(),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.equal(err.errors.length, REQUIRED_VARS.length);
        const seen = new Set(err.errors.map((e) => e.varName));
        for (const required of REQUIRED_VARS) {
          assert.ok(seen.has(required), `expected ${required} in errors`);
        }
        for (const e of err.errors) assert.equal(e.code, 'missing');
        return true;
      },
    );
  });

  it('invalid-format on a required var surfaces that specific error', () => {
    setRequiredEnv();
    process.env.BOUNTYMESH_PROGRAM_ID = '0xnothex'; // wrong length AND non-hex
    assert.throws(
      () => loadConfig(),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        const programIdErrors = err.errors.filter((e) => e.varName === 'BOUNTYMESH_PROGRAM_ID');
        assert.equal(programIdErrors.length, 1);
        assert.equal(programIdErrors[0].code, 'invalid-format');
        return true;
      },
    );
  });

  it('WORKER_TRACK rejects values outside the 4-track enum', () => {
    setRequiredEnv();
    process.env.WORKER_TRACK = 'Politics';
    assert.throws(
      () => loadConfig(),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        const trackErrors = err.errors.filter((e) => e.varName === 'WORKER_TRACK');
        assert.equal(trackErrors.length, 1);
        assert.equal(trackErrors[0].code, 'invalid-format');
        return true;
      },
    );
  });
});
