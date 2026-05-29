/**
 * PendingAcceptMonitor — Pending-Accept state machine (P2 §8 / P3.8b).
 *
 * Passive, unbounded over `pending_accept[]` entries persisted by the
 * Main FSM's Submitted closure. Drives `processWithdraw` on each
 * BountyAccepted observation.
 *
 * start() order (discipline B):
 *   1. Open SDK onBountyAccepted subscription FIRST (P2 §1 boot-buffer pattern).
 *      Events during steps 2-3 queue into `bootBuffer` until the flip.
 *   2. Query indexer for pending entries already in chain-state='Accepted'
 *      (boot-resume case 1 — Accepts that fired while the worker was down).
 *   3. Fire processWithdraw for each already-Accepted entry via the SAME
 *      path as live events; dedup via in-mutex re-read (withdraw.ts).
 *   4. Flip subscription to active; drain the buffered live events.
 *
 * Edge case (open): if the indexer is up to MAX_LAG=100 blocks behind chain
 * at worker boot, recent Accepts may be missed. Stuck-bounty mitigation is a
 * known follow-up.
 */

import type { Logger } from 'pino';
import type {
  BountyAcceptedEvent,
  BountyMeshClient,
  Unsubscribe,
} from '@bountymesh/sdk';
import type { WorkHistoryDedup } from '../filter/dedup.js';
import type { WorkerStateFile } from '../state/worker-state.js';
import type { SignerMutex } from './signer-mutex.js';
import { processWithdraw } from './withdraw.js';

export interface PendingAcceptMonitorDeps {
  client: BountyMeshClient;
  workerState: WorkerStateFile;
  dedup: WorkHistoryDedup;
  historyPath: string;
  signerMutex: SignerMutex;
  indexerBaseUrl: string;
  workerAddress: `0x${string}`;
  logger: Logger;
  /** Inject a mock for unit tests. */
  fetchFn?: typeof fetch;
}

export class PendingAcceptMonitor {
  private readonly deps: PendingAcceptMonitorDeps;
  private liveUnsub: Unsubscribe | null = null;
  private bootComplete = false;
  private readonly bootBuffer: BountyAcceptedEvent[] = [];

  constructor(deps: PendingAcceptMonitorDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    const log = this.deps.logger;
    log.info({ op: 'monitor', stage: 'start' });

    // (1) Open subscription FIRST. Buffer events until bootComplete.
    this.liveUnsub = await this.deps.client.onBountyAccepted(
      { worker: this.deps.workerAddress },
      (e: BountyAcceptedEvent) => {
        if (!this.bootComplete) {
          this.bootBuffer.push(e);
        } else {
          void this.processForEventId(e.id, 'live-subscription');
        }
      },
    );

    // (2) Boot-resume: query indexer for pending entries already in
    //     chain-state='Accepted' before the live subscription opened.
    const pending = this.deps.workerState.getPendingAccepts();
    if (pending.length > 0) {
      try {
        const acceptedIds = await this.queryAcceptedPending(pending.map((e) => e.id));
        log.info({
          op: 'monitor',
          stage: 'boot-resume',
          pending_count: pending.length,
          already_accepted: acceptedIds.length,
        });
        // (3) Fire processWithdraw via the SAME path as live events.
        //     processWithdraw's in-mutex re-read collapses any race with
        //     buffered live events for the same id.
        for (const id of acceptedIds) {
          void this.processForEventId(BigInt(id), 'indexer-query');
        }
      } catch (err) {
        log.error({
          op: 'monitor',
          stage: 'boot-resume-failed',
          err: err instanceof Error ? err.message : String(err),
          msg: 'boot-resume query failed; live subscription still active',
        });
      }
    }

    // (4) Flip to active + drain buffered events.
    this.bootComplete = true;
    const buffered = this.bootBuffer.splice(0, this.bootBuffer.length);
    for (const e of buffered) {
      // Buffered events were observed by the live subscription before flip;
      // treat them as live-source for observability.
      void this.processForEventId(e.id, 'live-subscription');
    }
    log.info({ op: 'monitor', stage: 'live', drained: buffered.length });
  }

  async stop(): Promise<void> {
    if (this.liveUnsub) {
      this.liveUnsub();
      this.liveUnsub = null;
    }
  }

  private async processForEventId(
    id: bigint,
    source: 'indexer-query' | 'live-subscription',
  ): Promise<void> {
    // Look up the pending entry for this bountyId. Read at processing time
    // (not capture-time) so a concurrent clearPendingAccept is visible.
    const entry = this.deps.workerState
      .getPendingAccepts()
      .find((e) => e.id === id.toString());
    if (!entry) {
      this.deps.logger.info({
        op: 'monitor',
        candidateId: id.toString(),
        decision: 'ignored-not-pending',
        source,
      });
      return;
    }
    // Source-discriminated event log proves WHICH path surfaced the Accept.
    // The integration test asserts source==='indexer-query' to verify the
    // boot-resume GraphQL path fired (not the live channel race).
    this.deps.logger.info({
      op: 'monitor',
      event: source === 'indexer-query' ? 'boot-resume-fired' : 'live-fired',
      bountyId: id.toString(),
      source,
    });
    try {
      await processWithdraw(entry, {
        client: this.deps.client,
        workerState: this.deps.workerState,
        dedup: this.deps.dedup,
        historyPath: this.deps.historyPath,
        signerMutex: this.deps.signerMutex,
        logger: this.deps.logger,
      });
    } catch (err) {
      // processWithdraw re-throws on pre-chain-call errors. Log and leave
      // the entry pending — it'll be retried via the next live event or
      // next process boot's boot-resume.
      this.deps.logger.error({
        op: 'monitor',
        candidateId: id.toString(),
        err: err instanceof Error ? err.message : String(err),
        msg: 'processWithdraw threw; entry remains pending — retry via next event or boot',
      });
    }
  }

  private async queryAcceptedPending(pendingIds: string[]): Promise<string[]> {
    const fetchImpl = this.deps.fetchFn ?? fetch;
    const url = `${this.deps.indexerBaseUrl.replace(/\/$/, '')}/graphql`;
    const query = `query AcceptedPending($ids: [BigInt!]!) {
      allBounties(filter: { id: { in: $ids }, status: { equalTo: "Accepted" } }) {
        nodes { id }
      }
    }`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { ids: pendingIds } }),
    });
    if (!res.ok) {
      throw new Error(`indexer responded HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: { allBounties?: { nodes: Array<{ id: string }> } };
      errors?: Array<{ message: string }>;
    };
    if (body.errors && body.errors.length > 0) {
      throw new Error(
        `GraphQL errors: ${body.errors.map((e) => e.message).join(' ; ')}`,
      );
    }
    return body.data?.allBounties?.nodes?.map((n) => n.id) ?? [];
  }
}
