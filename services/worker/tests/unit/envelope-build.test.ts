import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildEnvelope } from '../../src/envelope/index.js';
import type { AdapterOutput } from '../../src/adapter/types.js';

const WORKER_ADDR = `0x${'aa'.repeat(32)}` as const;

function successOutput(overrides: Partial<AdapterOutput> = {}): AdapterOutput {
  return {
    output_inline: 'hello world',
    output_blob_url: null,
    output_blob_sha256: null,
    upstream: {
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      request_canonical: { system: 'sys', user: 'usr', temperature: 0 },
      response_sha256: `0x${'bb'.repeat(32)}`,
      response_body_inline: 'hello world',
      attempts: 1,
      request_at: '2026-05-19T12:00:00.000Z',
      response_at: '2026-05-19T12:00:01.000Z',
      error: null,
    },
    ...overrides,
  };
}

describe('buildEnvelope', () => {
  it('produces envelope with locked field shape (v=1, P0 §C1)', () => {
    const { envelope, resultHash } = buildEnvelope({
      bountyId: 7n,
      workerAddress: WORKER_ADDR,
      producedAtBlock: 1000,
      adapterOutput: successOutput(),
      crashResumed: false,
    });
    assert.equal(envelope.v, 1);
    assert.equal(envelope.task, '7');
    assert.equal(envelope.worker, WORKER_ADDR);
    assert.equal(envelope.produced_at, 1000);
    assert.equal(envelope.output_inline, 'hello world');
    assert.equal(envelope.output_blob_url, null);
    assert.equal(envelope.crash_resumed, false);
    assert.equal(envelope.reproducibility, 'best-effort');
    assert.equal(envelope.provider_determinism, 'temp-0-bounded');
    assert.match(resultHash, /^0x[0-9a-f]{64}$/);
  });

  it('hash is deterministic across calls with identical inputs (canonical-JSON guarantee)', () => {
    const a = buildEnvelope({
      bountyId: 1n,
      workerAddress: WORKER_ADDR,
      producedAtBlock: 100,
      adapterOutput: successOutput(),
      crashResumed: false,
    });
    const b = buildEnvelope({
      bountyId: 1n,
      workerAddress: WORKER_ADDR,
      producedAtBlock: 100,
      adapterOutput: successOutput(),
      crashResumed: false,
    });
    assert.equal(a.resultHash, b.resultHash);
    assert.equal(a.canonical, b.canonical);
  });

  it('crash_resumed flag propagates to envelope and affects hash', () => {
    const noResume = buildEnvelope({
      bountyId: 1n,
      workerAddress: WORKER_ADDR,
      producedAtBlock: 100,
      adapterOutput: successOutput(),
      crashResumed: false,
    });
    const resumed = buildEnvelope({
      bountyId: 1n,
      workerAddress: WORKER_ADDR,
      producedAtBlock: 100,
      adapterOutput: successOutput(),
      crashResumed: true,
    });
    assert.equal(resumed.envelope.crash_resumed, true);
    assert.equal(noResume.envelope.crash_resumed, false);
    // Different inputs → different hashes.
    assert.notEqual(noResume.resultHash, resumed.resultHash);
  });

  it('failure-shape AdapterOutput → envelope.output_inline === null, upstream.error populated', () => {
    const failure: AdapterOutput = {
      output_inline: null,
      output_blob_url: null,
      output_blob_sha256: null,
      upstream: {
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        request_canonical: { system: 'sys', user: 'usr' },
        response_sha256: null,
        response_body_inline: null,
        attempts: 2,
        request_at: '2026-05-19T12:00:00.000Z',
        response_at: '2026-05-19T12:02:00.000Z',
        error: 'anthropic[500]: internal_error',
      },
    };
    const { envelope, resultHash } = buildEnvelope({
      bountyId: 1n,
      workerAddress: WORKER_ADDR,
      producedAtBlock: 100,
      adapterOutput: failure,
      crashResumed: false,
    });
    assert.equal(envelope.output_inline, null);
    const upstream = envelope.upstream as Record<string, unknown>;
    assert.equal(upstream.error, 'anthropic[500]: internal_error');
    assert.equal(upstream.attempts, 2);
    assert.match(resultHash, /^0x[0-9a-f]{64}$/);
  });

  it('different bounty ids → different result hashes', () => {
    const a = buildEnvelope({
      bountyId: 1n,
      workerAddress: WORKER_ADDR,
      producedAtBlock: 100,
      adapterOutput: successOutput(),
      crashResumed: false,
    });
    const b = buildEnvelope({
      bountyId: 2n,
      workerAddress: WORKER_ADDR,
      producedAtBlock: 100,
      adapterOutput: successOutput(),
      crashResumed: false,
    });
    assert.notEqual(a.resultHash, b.resultHash);
  });
});
