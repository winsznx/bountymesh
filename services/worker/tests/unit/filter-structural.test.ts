import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyStructuralFilter } from '../../src/filter/structural.js';
import type { Candidate } from '../../src/discovery/types.js';

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

const DEFAULT_OPTS = {
  workerTrack: 'Services' as const,
  workerMinReward: 1_000_000_000_000n,
  myAddress: MY_ADDRESS,
};

describe('applyStructuralFilter', () => {
  it('passes a candidate matching all rules', () => {
    const result = applyStructuralFilter(makeCandidate(), DEFAULT_OPTS);
    assert.equal(result.decision, 'pass');
  });

  it('drops on track mismatch', () => {
    const result = applyStructuralFilter(makeCandidate({ track: 'Open' }), DEFAULT_OPTS);
    assert.equal(result.decision, 'drop');
    if (result.decision === 'drop') {
      assert.match(result.reason, /track-mismatch/);
    }
  });

  it('drops when reward < worker.minReward', () => {
    const result = applyStructuralFilter(
      makeCandidate({ reward: 500_000_000_000n }),
      DEFAULT_OPTS,
    );
    assert.equal(result.decision, 'drop');
    if (result.decision === 'drop') {
      assert.match(result.reason, /reward-below-floor/);
    }
  });

  it('drops when poster === my address (self-poster)', () => {
    const result = applyStructuralFilter(makeCandidate({ poster: MY_ADDRESS }), DEFAULT_OPTS);
    assert.equal(result.decision, 'drop');
    if (result.decision === 'drop') {
      assert.equal(result.reason, 'self-poster');
    }
  });

  it('self-poster check is case-insensitive on hex addresses', () => {
    const mixed = ('0x' + 'aa'.repeat(32).toUpperCase()) as `0x${string}`;
    const result = applyStructuralFilter(makeCandidate({ poster: mixed }), DEFAULT_OPTS);
    assert.equal(result.decision, 'drop');
    if (result.decision === 'drop') {
      assert.equal(result.reason, 'self-poster');
    }
  });

  it('rule order: track-mismatch reported even when reward is also below floor', () => {
    // Two structural failures present; track check runs first so its reason wins.
    const result = applyStructuralFilter(
      makeCandidate({ track: 'Open', reward: 500_000_000_000n }),
      DEFAULT_OPTS,
    );
    assert.equal(result.decision, 'drop');
    if (result.decision === 'drop') {
      assert.match(result.reason, /track-mismatch/);
    }
  });
});
