/**
 * Indexer GraphQL catch-up client (single-page, no pagination).
 *
 * Boot stage B-4: query the indexer for currently-Open bounties so the
 * worker can claim ones posted while the worker was down. The bounties
 * projection (post-F1) carries title/description/acceptance/deadline;
 * catchup-sourced Candidates have blockHash=null (not in the projection)
 * and txHash from the postTxHash column.
 *
 * Pagination: NONE. pageSize hardcoded at 1000. totalCount > pageSize
 * throws PaginationOverflowError — forces operator to revisit at Phase 6
 * scale. Cursor pagination is a Phase 6 implementation item.
 */

import type { Track } from '../config/index.js';
import { ALLOWED_TRACKS } from '../config/index.js';
import type { Candidate } from './types.js';

export const CATCHUP_PAGE_SIZE = 1000;

export class PaginationOverflowError extends Error {
  readonly totalCount: number;
  readonly pageSize: number;
  constructor(totalCount: number, pageSize: number) {
    super(
      `Catchup pagination overflow: indexer returned totalCount=${totalCount} ` +
        `which exceeds the hardcoded pageSize=${pageSize}. ` +
        `Phase 6 scaling concern; implement cursor pagination before mainnet scale.`,
    );
    this.name = 'PaginationOverflowError';
    this.totalCount = totalCount;
    this.pageSize = pageSize;
  }
}

export class CatchupFetchError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CatchupFetchError';
    this.cause = cause;
  }
}

export class CatchupDecodeError extends Error {
  readonly bountyId: string | null;
  constructor(message: string, bountyId: string | null = null) {
    super(message);
    this.name = 'CatchupDecodeError';
    this.bountyId = bountyId;
  }
}

interface GqlNode {
  id: string;
  poster: string;
  reward: string;
  track: string;
  postedAt: string;
  title: string | null;
  description: string | null;
  acceptance: string | null;
  deadline: string | null;
  postTxHash: string | null;
}

interface GqlResponse {
  data?: {
    allBounties?: {
      totalCount: number;
      nodes: GqlNode[];
    };
  };
  errors?: Array<{ message: string }>;
}

const CATCHUP_QUERY = `query Catchup($pageSize: Int!) {
  allBounties(filter: { status: { equalTo: "Open" } }, first: $pageSize) {
    totalCount
    nodes {
      id
      poster
      reward
      track
      postedAt
      title
      description
      acceptance
      deadline
      postTxHash
    }
  }
}`;

export interface FetchCatchupOptions {
  indexerBaseUrl: string;
  fetchFn?: typeof fetch;
}

function isTrack(value: string): value is Track {
  return (ALLOWED_TRACKS as readonly string[]).includes(value);
}

function decodeNode(node: GqlNode): Candidate {
  if (node.title === null || node.description === null || node.acceptance === null) {
    throw new CatchupDecodeError(
      `bounty id=${node.id} has null title/description/acceptance — ` +
        `indexer is missing F1 projection or this is a pre-F1 bounty in history`,
      node.id,
    );
  }
  if (!isTrack(node.track)) {
    throw new CatchupDecodeError(
      `bounty id=${node.id} has unknown track="${node.track}"`,
      node.id,
    );
  }

  return {
    id: BigInt(node.id),
    poster: node.poster as `0x${string}`,
    reward: BigInt(node.reward),
    track: node.track,
    postedAt: Number(node.postedAt),
    title: node.title,
    description: node.description,
    acceptance: node.acceptance,
    deadline: node.deadline === null ? null : Number(node.deadline),
    blockHash: null,
    txHash: node.postTxHash === null ? null : (node.postTxHash as `0x${string}`),
    phase: 'catchup',
  };
}

/**
 * Fetch all currently-Open bounties from the indexer via GraphQL.
 *
 * Throws:
 *   - CatchupFetchError       : transport / HTTP / GraphQL-level error
 *   - PaginationOverflowError : totalCount > CATCHUP_PAGE_SIZE
 *   - CatchupDecodeError      : a node failed schema validation
 */
export async function fetchOpenBountiesForCatchup(
  opts: FetchCatchupOptions,
): Promise<Candidate[]> {
  const fetchImpl = opts.fetchFn ?? fetch;
  const url = `${opts.indexerBaseUrl.replace(/\/$/, '')}/graphql`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: CATCHUP_QUERY, variables: { pageSize: CATCHUP_PAGE_SIZE } }),
    });
  } catch (err) {
    throw new CatchupFetchError(`catchup fetch transport error: ${url}`, err);
  }

  if (!res.ok) {
    throw new CatchupFetchError(`catchup fetch HTTP ${res.status}: ${url}`);
  }

  let body: GqlResponse;
  try {
    body = (await res.json()) as GqlResponse;
  } catch (err) {
    throw new CatchupFetchError(`catchup response not valid JSON: ${url}`, err);
  }

  if (body.errors && body.errors.length > 0) {
    throw new CatchupFetchError(
      `catchup GraphQL errors: ${body.errors.map((e) => e.message).join(' ; ')}`,
    );
  }

  const conn = body.data?.allBounties;
  if (!conn) {
    throw new CatchupFetchError(`catchup response missing data.allBounties`);
  }

  if (conn.totalCount > CATCHUP_PAGE_SIZE) {
    throw new PaginationOverflowError(conn.totalCount, CATCHUP_PAGE_SIZE);
  }

  return conn.nodes.map(decodeNode);
}
