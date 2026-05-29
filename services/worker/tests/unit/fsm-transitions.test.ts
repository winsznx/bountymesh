import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type {
  BountyMeshClient,
  TxResult,
} from '@bountymesh/sdk';
import type { Candidate } from '../../src/discovery/types.js';
import type { AdapterOutput, WorkAdapter } from '../../src/adapter/index.js';
import { doClaim, doSubmit, doWork, SignerMutex } from '../../src/fsm/index.js';

const TX = `0x${'aa'.repeat(32)}` as const;
const BLOCK = `0x${'bb'.repeat(32)}` as const;

function mockClient(overrides: {
  claim?: (id: bigint) => Promise<TxResult<null>>;
  submit?: (
    id: bigint,
    payload: string,
    hash: `0x${string}`,
  ) => Promise<TxResult<null>>;
}): BountyMeshClient {
  return {
    claim: overrides.claim ?? (async () => ({ ok: true, value: null, txHash: TX, blockHash: BLOCK })),
    submit: overrides.submit ?? (async () => ({ ok: true, value: null, txHash: TX, blockHash: BLOCK })),
  } as unknown as BountyMeshClient;
}

function mockAdapter(out: AdapterOutput): WorkAdapter {
  return {
    name: 'mock',
    version: '0.0.1',
    execute: async () => out,
  };
}

function fixtureCandidate(): Candidate {
  return {
    id: 5n,
    poster: `0x${'cc'.repeat(32)}`,
    reward: 2_000_000_000_000n,
    track: 'Services',
    postedAt: 100,
    title: 't',
    description: 'd',
    acceptance: 'a',
    deadline: null,
    blockHash: null,
    txHash: null,
    phase: 'live',
  };
}

function fixtureAdapterOutput(): AdapterOutput {
  return {
    output_inline: 'work',
    output_blob_url: null,
    output_blob_sha256: null,
    upstream: {
      provider: 'mock',
      model: 'mock-0',
      request_canonical: {},
      response_sha256: `0x${'ee'.repeat(32)}`,
      response_body_inline: 'work',
      attempts: 1,
      request_at: '2026-05-19T12:00:00.000Z',
      response_at: '2026-05-19T12:00:01.000Z',
      error: null,
    },
  };
}

describe('doClaim', () => {
  it('returns ok=true on TxOk from SDK', async () => {
    const r = await doClaim(mockClient({}), 1n, new SignerMutex());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.txHash, TX);
      assert.equal(r.blockHash, BLOCK);
    }
  });

  it('returns ok=false with chain error code on TxErr', async () => {
    const r = await doClaim(
      mockClient({
        claim: async () => ({ ok: false, error: 'BountyNotOpen', txHash: TX, blockHash: BLOCK }),
      }),
      1n,
      new SignerMutex(),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, 'BountyNotOpen');
      assert.equal(r.txHash, TX);
    }
  });

  it('returns ok=false with TransportError on SDK throw', async () => {
    const r = await doClaim(
      mockClient({
        claim: async () => {
          throw new Error('network down');
        },
      }),
      1n,
      new SignerMutex(),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, 'TransportError');
      assert.equal(r.txHash, null);
    }
  });

  it('wraps client.claim in mutex.runExclusive (P2 §A nonce serialization)', async () => {
    const mutex = new SignerMutex();
    const original = mutex.runExclusive.bind(mutex);
    let runExclusiveCalls = 0;
    mutex.runExclusive = (fn: () => Promise<unknown>): Promise<unknown> => {
      runExclusiveCalls++;
      return original(fn);
    };
    await doClaim(mockClient({}), 1n, mutex);
    assert.equal(runExclusiveCalls, 1);
  });
});

describe('doSubmit', () => {
  it('returns ok=true on TxOk', async () => {
    const r = await doSubmit(mockClient({}), 1n, 'payload', `0x${'ee'.repeat(32)}`, new SignerMutex());
    assert.equal(r.ok, true);
  });

  it('returns ok=false with chain error code on TxErr', async () => {
    const r = await doSubmit(
      mockClient({
        submit: async () => ({
          ok: false,
          error: 'BountyNotClaimed',
          txHash: TX,
          blockHash: BLOCK,
        }),
      }),
      1n,
      'p',
      `0x${'ee'.repeat(32)}`,
      new SignerMutex(),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, 'BountyNotClaimed');
      assert.equal(r.txHash, TX);
    }
  });

  it('returns ok=false with TransportError on SDK throw', async () => {
    const r = await doSubmit(
      mockClient({
        submit: async () => {
          throw new Error('network down');
        },
      }),
      1n,
      'p',
      `0x${'ee'.repeat(32)}`,
      new SignerMutex(),
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, 'TransportError');
      assert.equal(r.txHash, null);
    }
  });

  it('wraps client.submit in mutex.runExclusive (P2 §A nonce serialization)', async () => {
    const mutex = new SignerMutex();
    const original = mutex.runExclusive.bind(mutex);
    let runExclusiveCalls = 0;
    mutex.runExclusive = (fn: () => Promise<unknown>): Promise<unknown> => {
      runExclusiveCalls++;
      return original(fn);
    };
    await doSubmit(mockClient({}), 1n, 'p', `0x${'ee'.repeat(32)}`, mutex);
    assert.equal(runExclusiveCalls, 1);
  });
});

describe('doWork', () => {
  it('returns the adapter output verbatim on success', async () => {
    const out = fixtureAdapterOutput();
    const r = await doWork(mockAdapter(out), fixtureCandidate(), false);
    assert.equal(r.output_inline, 'work');
    assert.equal(r.upstream.error, null);
  });

  it('returns failure-shape adapter output verbatim (no throw)', async () => {
    const failure: AdapterOutput = {
      output_inline: null,
      output_blob_url: null,
      output_blob_sha256: null,
      upstream: {
        provider: 'mock',
        model: 'mock-0',
        request_canonical: {},
        response_sha256: null,
        response_body_inline: null,
        attempts: 2,
        request_at: '2026-05-19T12:00:00.000Z',
        response_at: '2026-05-19T12:02:00.000Z',
        error: 'other: mock failure',
      },
    };
    const r = await doWork(mockAdapter(failure), fixtureCandidate(), false);
    assert.equal(r.output_inline, null);
    assert.equal(r.upstream.error, 'other: mock failure');
  });
});
