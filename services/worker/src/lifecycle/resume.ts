/**
 * Resume orchestrator (P3.10a / boot stage B-5.5).
 *
 * Inspects workerState.inflight at boot. If set, the prior process crashed
 * mid-cycle. Branches by current chain state (queried via indexer GraphQL —
 * discipline H: indexer is already a hard dep at B-3+ probe, no chain RPC):
 *
 *   inflight === null              → no-op
 *   bounty not in indexer          → abandoned history + clearInflight
 *   status === 'Open'              → unexpected; clearInflight, no history
 *   status === 'Claimed', mine     → resume FSM from Working (fire-and-forget);
 *                                    crashResumed=true detected inside fsm.run
 *                                    via inflight match (NOT cleared first)
 *   status === 'Claimed', other    → abandoned history + clearInflight
 *   status === 'Submitted'         → reconstruct pending_accept (envelope_sha256
 *                                    lost — sentinel zero hash); clearInflight.
 *                                    Monitor catches via live Accept event.
 *   status === 'Accepted'          → same reconstruction; Monitor's boot-resume
 *                                    GraphQL query catches immediately. Idempotent
 *                                    on AlreadyWithdrawn (chain says withdrawn).
 *   other status                   → abandoned history + clearInflight
 *
 * Resume FSM.run is fire-and-forget: boot proceeds to B-6 without awaiting
 * Submit completion. The InflightSerializer is PRE-ACQUIRED here so concurrent
 * live BountyPosted candidates from discovery wait on the serializer until the
 * resume FSM releases (Submitted closure OR Abandoned closure). If the resume
 * FSM throws (no release), serializer stays acquired → worker is degraded;
 * new claims blocked until operator restart.
 */

import type { Logger } from 'pino';
import type { Candidate } from '../discovery/types.js';
import type { WorkHistoryDedup } from '../filter/dedup.js';
import type { InflightSerializer } from '../filter/serializer.js';
import type { MainFsm } from '../fsm/main.js';
import type { Track } from '../config/index.js';
import { ALLOWED_TRACKS } from '../config/index.js';
import { appendHistoryRecord } from '../state/history-writer.js';
import type { WorkerStateFile } from '../state/worker-state.js';

export interface ResumeDeps {
  workerState: WorkerStateFile;
  fsm: MainFsm;
  dedup: WorkHistoryDedup;
  historyPath: string;
  indexerBaseUrl: string;
  workerAddress: `0x${string}`;
  serializer: InflightSerializer;
  logger: Logger;
  /** Injected for unit tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

interface IndexerBountyRow {
  id: string;
  poster: string;
  worker: string | null;
  reward: string;
  track: string;
  status: string;
  postedAt: number;
  submittedAt: number | null;
  title: string | null;
  description: string | null;
  acceptance: string | null;
  deadline: number | null;
  postTxHash: string | null;
  submitTxHash: string | null;
  withdrawn: boolean;
}

const SENTINEL_ZERO_HASH = `0x${'0'.repeat(64)}` as `0x${string}`;

function isTrack(value: string): value is Track {
  return (ALLOWED_TRACKS as readonly string[]).includes(value);
}

function rowToCandidate(row: IndexerBountyRow): Candidate {
  if (row.title === null || row.description === null || row.acceptance === null) {
    throw new Error(
      `resume: bounty ${row.id} has null title/description/acceptance — indexer pre-F1 or projection drift`,
    );
  }
  if (!isTrack(row.track)) {
    throw new Error(`resume: bounty ${row.id} has unknown track="${row.track}"`);
  }
  return {
    id: BigInt(row.id),
    poster: row.poster as `0x${string}`,
    reward: BigInt(row.reward),
    track: row.track,
    postedAt: row.postedAt,
    title: row.title,
    description: row.description,
    acceptance: row.acceptance,
    deadline: row.deadline,
    blockHash: null, // Path X carryover — bounties projection doesn't store post block_hash
    txHash: row.postTxHash === null ? null : (row.postTxHash as `0x${string}`),
    phase: 'resume',
  };
}

async function queryIndexerBounty(
  deps: ResumeDeps,
  bountyId: bigint,
): Promise<IndexerBountyRow | null> {
  const fetchImpl = deps.fetchFn ?? fetch;
  const url = `${deps.indexerBaseUrl.replace(/\/$/, '')}/graphql`;
  const query = `query Q($id: BigInt!) {
    bountyById(id: $id) {
      id poster worker reward track status
      postedAt submittedAt
      title description acceptance deadline
      postTxHash submitTxHash
      withdrawn
    }
  }`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: bountyId.toString() } }),
  });
  if (!res.ok) {
    throw new Error(`resume: indexer responded HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    data?: { bountyById?: IndexerBountyRow | null };
    errors?: Array<{ message: string }>;
  };
  if (body.errors && body.errors.length > 0) {
    throw new Error(
      `resume: GraphQL errors: ${body.errors.map((e) => e.message).join(' ; ')}`,
    );
  }
  return body.data?.bountyById ?? null;
}

export async function recoverInflight(deps: ResumeDeps): Promise<void> {
  const inflightStr = deps.workerState.current().inflight;
  if (inflightStr === null) {
    deps.logger.info({ op: 'resume', decision: 'no-op-no-inflight' });
    return;
  }
  const bountyId = BigInt(inflightStr);
  const baseFields = { op: 'resume', candidateId: inflightStr };

  // Query — throws propagate so boot fails (operator intervenes per lock).
  const row = await queryIndexerBounty(deps, bountyId);

  if (row === null) {
    deps.logger.warn({ ...baseFields, decision: 'abandoned-not-in-indexer' });
    appendHistoryRecord(deps.historyPath, deps.dedup, {
      id: bountyId,
      status: 'abandoned',
      completed_at: new Date().toISOString(),
      tx_hashes: {},
      envelope_sha256: null,
    });
    await deps.workerState.clearInflight();
    return;
  }

  const myAddrLower = deps.workerAddress.toLowerCase();
  const claimerLower = row.worker ? row.worker.toLowerCase() : null;

  switch (row.status) {
    case 'Open': {
      deps.logger.warn({ ...baseFields, decision: 'open-clear-inflight' });
      await deps.workerState.clearInflight();
      return;
    }
    case 'Claimed': {
      if (claimerLower === myAddrLower) {
        // Resume FSM from Working. crashResumed=true detected inside fsm.run
        // via inflight-match (we deliberately DON'T clear inflight first).
        // Pre-acquire serializer so concurrent live candidates wait.
        if (!deps.serializer.tryAcquire(bountyId)) {
          deps.logger.error({
            ...baseFields,
            decision: 'serializer-busy-at-resume',
            msg: 'unexpected: serializer occupied at boot',
          });
          return;
        }
        const candidate = rowToCandidate(row);
        deps.logger.info({ ...baseFields, decision: 'resume-fsm-from-working' });
        // Fire-and-forget. If FSM throws before release, serializer stays
        // acquired — worker degraded (P2 §C WaitingForOperatorIntervention).
        void deps.fsm.run(candidate).catch((err) => {
          deps.logger.error(
            {
              ...baseFields,
              err: err instanceof Error ? err.message : String(err),
              msg: 'resume FSM threw — worker degraded; serializer held; operator must restart',
            },
          );
        });
        return;
      }
      // Claimed by other.
      deps.logger.error({
        ...baseFields,
        decision: 'abandoned-claimed-by-other',
        otherWorker: row.worker,
      });
      appendHistoryRecord(deps.historyPath, deps.dedup, {
        id: bountyId,
        status: 'abandoned',
        completed_at: new Date().toISOString(),
        tx_hashes: row.postTxHash
          ? { post: row.postTxHash as `0x${string}` }
          : {},
        envelope_sha256: null,
      });
      await deps.workerState.clearInflight();
      return;
    }
    case 'Submitted':
    case 'Accepted': {
      const inflightId = inflightStr;
      const existing = deps.workerState
        .getPendingAccepts()
        .find((e) => e.id === inflightId);
      if (!existing) {
        // envelope_sha256 was in-memory only at pre-crash FSM. Lost.
        // Use sentinel zero hash — reviewer can see it's a recovery entry.
        await deps.workerState.addPendingAccept({
          id: inflightId,
          submit_tx_hash: (row.submitTxHash ?? SENTINEL_ZERO_HASH) as `0x${string}`,
          submit_block_number: row.submittedAt ?? 0,
          envelope_sha256: SENTINEL_ZERO_HASH,
          added_at: new Date().toISOString(),
        });
        deps.logger.info({
          ...baseFields,
          decision: `reconstruct-pending-accept-from-${row.status}`,
        });
      } else {
        deps.logger.info({ ...baseFields, decision: 'pending-accept-already-present' });
      }
      await deps.workerState.clearInflight();
      return;
    }
    default: {
      // Unreachable on current chain surface (Cancelled/Rejected/Revoked/
      // TimedOut have no exports). Defensive — handle any future status.
      deps.logger.warn({
        ...baseFields,
        status: row.status,
        decision: 'abandoned-unhandled-status',
      });
      appendHistoryRecord(deps.historyPath, deps.dedup, {
        id: bountyId,
        status: 'abandoned',
        completed_at: new Date().toISOString(),
        tx_hashes: row.postTxHash ? { post: row.postTxHash as `0x${string}` } : {},
        envelope_sha256: null,
      });
      await deps.workerState.clearInflight();
      return;
    }
  }
}
