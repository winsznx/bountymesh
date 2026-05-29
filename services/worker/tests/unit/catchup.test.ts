import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  CATCHUP_PAGE_SIZE,
  CatchupDecodeError,
  CatchupFetchError,
  PaginationOverflowError,
  fetchOpenBountiesForCatchup,
} from '../../src/discovery/catchup.js';

const INDEXER_URL = 'http://test-fixture-indexer.invalid';

function gqlOk(totalCount: number, nodes: unknown[]): Response {
  return new Response(JSON.stringify({ data: { allBounties: { totalCount, nodes } } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function gqlError(message: string): Response {
  return new Response(JSON.stringify({ errors: [{ message }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function validNode(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    poster: `0x${'aa'.repeat(32)}`,
    reward: '1000000000000',
    track: 'Services',
    postedAt: '100',
    title: 'indexer-projection-title',
    description: 'indexer-projection-description',
    acceptance: 'indexer-projection-acceptance',
    deadline: '3000000',
    postTxHash: `0x${'cc'.repeat(32)}`,
    ...overrides,
  };
}

describe('catchup — fetchOpenBountiesForCatchup', () => {
  it('happy path: 2 valid nodes decode to 2 Candidates with phase=catchup', async () => {
    const fetchFn = async (): Promise<Response> => gqlOk(2, [validNode('1'), validNode('2')]);
    const candidates = await fetchOpenBountiesForCatchup({ indexerBaseUrl: INDEXER_URL, fetchFn });

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].id, 1n);
    assert.equal(candidates[0].phase, 'catchup');
    assert.equal(candidates[0].title, 'indexer-projection-title');
    assert.equal(candidates[0].reward, 1_000_000_000_000n);
    assert.equal(candidates[0].deadline, 3_000_000);
    assert.equal(candidates[0].blockHash, null); // not on projection
    assert.equal(candidates[1].id, 2n);
  });

  it('throws PaginationOverflowError when totalCount > pageSize', async () => {
    const fetchFn = async (): Promise<Response> => gqlOk(CATCHUP_PAGE_SIZE + 1, []);
    await assert.rejects(
      () => fetchOpenBountiesForCatchup({ indexerBaseUrl: INDEXER_URL, fetchFn }),
      (err: unknown) => {
        assert.ok(err instanceof PaginationOverflowError);
        assert.equal(err.totalCount, CATCHUP_PAGE_SIZE + 1);
        assert.equal(err.pageSize, CATCHUP_PAGE_SIZE);
        return true;
      },
    );
  });

  it('throws CatchupFetchError on GraphQL-level errors', async () => {
    const fetchFn = async (): Promise<Response> => gqlError('schema mismatch');
    await assert.rejects(
      () => fetchOpenBountiesForCatchup({ indexerBaseUrl: INDEXER_URL, fetchFn }),
      (err: unknown) => {
        assert.ok(err instanceof CatchupFetchError);
        assert.match(err.message, /schema mismatch/);
        return true;
      },
    );
  });

  it('throws CatchupFetchError on transport failure (fetch throws)', async () => {
    const fetchFn = async (): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    };
    await assert.rejects(
      () => fetchOpenBountiesForCatchup({ indexerBaseUrl: INDEXER_URL, fetchFn }),
      (err: unknown) => {
        assert.ok(err instanceof CatchupFetchError);
        assert.match(err.message, /transport error/);
        return true;
      },
    );
  });

  it('throws CatchupDecodeError when a node has null strings (F1 projection missing)', async () => {
    const badNode = validNode('99', { title: null });
    const fetchFn = async (): Promise<Response> => gqlOk(1, [badNode]);
    await assert.rejects(
      () => fetchOpenBountiesForCatchup({ indexerBaseUrl: INDEXER_URL, fetchFn }),
      (err: unknown) => {
        assert.ok(err instanceof CatchupDecodeError);
        assert.equal(err.bountyId, '99');
        return true;
      },
    );
  });
});
