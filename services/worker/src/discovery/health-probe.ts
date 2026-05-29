/**
 * Indexer /health probe — boot stage B-3.
 *
 * Retry transport failures (HTTP error, fetch throw, malformed JSON) with
 * exponential backoff: 1s / 2s / 4s / 8s / 16s = ~31s total over 6 attempts.
 *
 * Each acceptance condition (chain-connected, mode-live, lag-within-limit)
 * is checked independently and throws an IndexerProbeError with its own
 * code immediately on failure — these are NOT retried because they reflect
 * indexer state that won't fix itself in 31s. Operator intervention needed.
 */

export type IndexerProbeErrorCode =
  | 'unreachable'
  | 'malformed-response'
  | 'chain-disconnected'
  | 'mode-not-live'
  | 'lag-too-high';

export class IndexerProbeError extends Error {
  readonly code: IndexerProbeErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: IndexerProbeErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'IndexerProbeError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Actual /health shape (services/indexer/src/lifecycle/health.ts:buildHealthResponse):
 *   chain is FLAT — a ChainStatus string ('connected'|'disconnected'), NOT a
 *   nested { status: string }. P2 §1's spec had it nested; reality is flat.
 */
export interface HealthResponse {
  status: string;
  chain: string;
  mode: string;
  lastFinalizedBlock: number;
  headBlock: number;
  lagFromHead: number;
  wsReconnects1h: number;
  parseErrors1h: number;
  uptime: string;
}

export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000];

export interface ProbeIndexerHealthOptions {
  indexerBaseUrl: string;
  chainHeadAtBootStart: number;
  maxLagBlocks: number;
  retryDelaysMs?: readonly number[];
  sleepFn?: (ms: number) => Promise<void>;
  fetchFn?: typeof fetch;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function validateHealthShape(body: unknown): HealthResponse | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  // Strict on the 3 fields the acceptance check gates on. Other fields are
  // observability-only — carry through with defensive defaults if absent.
  // Protects against future indexer schema additions without forcing a
  // worker patch.
  if (typeof o.chain !== 'string') return null;
  if (typeof o.mode !== 'string') return null;
  if (typeof o.lastFinalizedBlock !== 'number') return null;
  return {
    status: typeof o.status === 'string' ? o.status : 'unknown',
    chain: o.chain,
    mode: o.mode,
    lastFinalizedBlock: o.lastFinalizedBlock,
    headBlock: typeof o.headBlock === 'number' ? o.headBlock : 0,
    lagFromHead: typeof o.lagFromHead === 'number' ? o.lagFromHead : 0,
    wsReconnects1h: typeof o.wsReconnects1h === 'number' ? o.wsReconnects1h : 0,
    parseErrors1h: typeof o.parseErrors1h === 'number' ? o.parseErrors1h : 0,
    uptime: typeof o.uptime === 'string' ? o.uptime : '',
  };
}

/**
 * Probe the indexer's /health endpoint and assert acceptance conditions.
 *
 * Throws IndexerProbeError on:
 *   - 'unreachable'         : exhausted all retries (HTTP / fetch failures)
 *   - 'malformed-response'  : exhausted all retries (response shape mismatch)
 *   - 'chain-disconnected'  : health.chain.status !== 'connected' (no retry)
 *   - 'mode-not-live'       : health.mode !== 'live' (no retry)
 *   - 'lag-too-high'        : lastFinalizedBlock < chainHead - maxLag (no retry)
 */
export async function probeIndexerHealth(
  opts: ProbeIndexerHealthOptions,
): Promise<HealthResponse> {
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const sleep = opts.sleepFn ?? defaultSleep;
  const fetchImpl = opts.fetchFn ?? fetch;
  const url = `${opts.indexerBaseUrl.replace(/\/$/, '')}/health`;

  let lastError: IndexerProbeError = new IndexerProbeError(
    'unreachable',
    `${url}: no attempts made`,
  );

  // Total attempts = 1 (initial) + delays.length (retries).
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      await sleep(delays[attempt - 1]);
    }

    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch (err) {
      lastError = new IndexerProbeError(
        'unreachable',
        `${url}: fetch threw — ${err instanceof Error ? err.message : String(err)}`,
        { attempt },
      );
      continue;
    }

    if (!res.ok) {
      lastError = new IndexerProbeError(
        'unreachable',
        `${url}: HTTP ${res.status}`,
        { attempt, status: res.status },
      );
      continue;
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      lastError = new IndexerProbeError(
        'malformed-response',
        `${url}: response not valid JSON`,
        { attempt, err: err instanceof Error ? err.message : String(err) },
      );
      continue;
    }

    const health = validateHealthShape(body);
    if (!health) {
      lastError = new IndexerProbeError(
        'malformed-response',
        `${url}: response did not match expected /health shape`,
        { attempt },
      );
      continue;
    }

    // Three acceptance conditions — each independent so operator can see WHICH
    // failed. None are retried: indexer state that fails any of these won't
    // self-correct in 31s.
    if (health.chain !== 'connected') {
      throw new IndexerProbeError(
        'chain-disconnected',
        `${url}: chain='${health.chain}', expected 'connected'`,
        { health },
      );
    }
    if (health.mode !== 'live') {
      throw new IndexerProbeError(
        'mode-not-live',
        `${url}: mode='${health.mode}', expected 'live'`,
        { health },
      );
    }
    const minAcceptable = opts.chainHeadAtBootStart - opts.maxLagBlocks;
    if (health.lastFinalizedBlock < minAcceptable) {
      throw new IndexerProbeError(
        'lag-too-high',
        `${url}: lastFinalizedBlock=${health.lastFinalizedBlock} < ${minAcceptable} ` +
          `(chainHead=${opts.chainHeadAtBootStart}, maxLag=${opts.maxLagBlocks})`,
        { health, minAcceptable, chainHeadAtBootStart: opts.chainHeadAtBootStart },
      );
    }

    return health;
  }

  throw lastError;
}
