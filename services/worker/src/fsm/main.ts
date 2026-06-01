/**
 * Main FSM orchestrator.
 *
 * One run(candidate) call brackets a single bounty cycle:
 *   Idle → Claiming → Working → Submitting → Submitted   (happy)
 *   Idle → Claiming → Abandoned                          (claim-err)
 *   Idle → Claiming → Working → Submitting → Abandoned   (submit-err)
 *
 * Crash-resume:
 *   If workerState.inflight === candidate.id.toString() at entry, the worker
 *   crashed mid-Working in a previous process. Skip Claim (the chain already
 *   has it), propagate crashResumed=true to the adapter, and resume from
 *   Working. The boot resume-orchestrator feeds the candidate back to run();
 *   this FSM only DETECTS the resume.
 *
 * Closure ordering (operator lock):
 *   atomic-write/append FIRST, serializer release SECOND. Every persistence
 *   write (pending_accept on success, history on abandon) commits BEFORE the
 *   serializer is released. If any write throws, the run() throws → the caller
 *   transitions to WaitingForOperatorIntervention with the serializer still
 *   acquired (blocking new claims).
 */

import {
  buildEnvelope as buildOrchestratorEnvelope,
  classify,
  executeRoute,
  groqFallback,
  route,
} from '@bountymesh/orchestrator';
import { buildEnvelope } from '../envelope/index.js';
import { appendHistoryRecord } from '../state/history-writer.js';
import { doClaim, doSubmit, doWork } from './transitions.js';
import type {
  ClaimErrorReason,
  ClaimResult,
  MainFsmDeps,
  MainFsmState,
  SubmitErrorReason,
  SubmitResult,
} from './types.js';
import type { Candidate } from '../discovery/types.js';

function buildBountyContent(candidate: Candidate): string {
  return [
    `Title: ${candidate.title}`,
    `Description: ${candidate.description}`,
    `Acceptance: ${candidate.acceptance}`,
  ].join('\n');
}

export class MainFsm {
  private readonly deps: MainFsmDeps;

  constructor(deps: MainFsmDeps) {
    this.deps = deps;
  }

  /**
   * Drive one bounty cycle through Main FSM closure.
   *
   * Returns 'Submitted' on success (pending_accept entry persisted, inflight
   * cleared, serializer released, P3.8 will pick up from pending_accept[]).
   * Returns 'Abandoned' on any chain-Err or transport-throw path (history
   * record persisted with status='abandoned', inflight cleared, serializer
   * released).
   *
   * Throws (caller wraps to WaitingForOperatorIntervention) if a persistence
   * write fails after we've already taken on-chain action.
   */
  async run(candidate: Candidate): Promise<MainFsmState> {
    const inflightId = candidate.id;
    const log = this.deps.logger;
    const bountyIdStr = inflightId.toString();
    const baseFields = { op: 'fsm', candidateId: bountyIdStr };

    // Per-transition structured log line for integration-test observability.
    // One log per state edge.
    const transition = (from: string, to: string): void => {
      log.info({ op: 'fsm', event: 'transition', bountyId: bountyIdStr, from, to });
    };

    // Crash-resume detection: if a prior process crashed during Working for
    // this same candidate, workerState.inflight will already match.
    const priorInflight = this.deps.workerState.current().inflight;
    const crashResumed = priorInflight === bountyIdStr;

    log.info({ ...baseFields, state: 'Idle', crashResumed });

    // Persist inflight upfront so a crash mid-Working can be detected on reboot.
    if (!crashResumed) {
      await this.deps.workerState.setInflight(inflightId);
    }

    // ---- CLAIMING (skipped on crash-resume — chain already has our Claim) ----
    let claimTxHash: `0x${string}` | undefined;
    if (!crashResumed) {
      transition('Idle', 'Claiming');
      log.info({ ...baseFields, state: 'Claiming' });
      const claim = await doClaim(this.deps.client, inflightId, this.deps.signerMutex);
      if (!claim.ok) {
        transition('Claiming', 'Abandoned');
        await this.abandonAtClaim(candidate, claim);
        return 'Abandoned';
      }
      claimTxHash = claim.txHash;
      transition('Claiming', 'Working');
    } else {
      // Resume path: Idle → Working directly.
      transition('Idle', 'Working');
    }

    // ---- WORKING ----
    log.info({ ...baseFields, state: 'Working', crashResumed });
    // The crashResumed proof line. Asserted in the crash-resume integration
    // test (parses second worker's stdout for op:'adapter' + event:
    // 'execute-start' + crashResumed:true).
    log.info({
      op: 'adapter',
      event: 'execute-start',
      bountyId: bountyIdStr,
      crashResumed,
    });
    const adapterOutput = await doWork(this.deps.adapter, candidate, crashResumed);
    if (adapterOutput.upstream.error !== null) {
      log.warn({
        ...baseFields,
        state: 'Working',
        adapterError: adapterOutput.upstream.error,
        msg: 'adapter returned failure-shape; submitting failure envelope on-chain',
      });
    }

    // ---- SUBMITTING ----
    transition('Working', 'Submitting');
    log.info({ ...baseFields, state: 'Submitting' });
    const producedAtBlock = await this.deps.getCurrentBlock();

    // Worker envelope still computed for adapter observability — its hash is
    // logged alongside the orchestrator envelope so a reviewer can correlate
    // the on-chain submission with the local adapter snapshot if needed.
    const built = buildEnvelope({
      bountyId: inflightId,
      workerAddress: this.deps.workerAddress,
      producedAtBlock,
      adapterOutput,
      crashResumed,
    });

    // P13.2: orchestrator route → executeRoute → buildOrchestratorEnvelope.
    // On any route miss or executeRoute Err, fall through to groqFallback.
    // The envelope that lands on-chain is ALWAYS the orchestrator envelope;
    // the worker adapter snapshot above is observability-only from here on.
    const bountyContent = buildBountyContent(candidate);
    const topics = classify(bountyContent);
    const bountyIdNumber = Number(inflightId);

    let orchestratorEnvelope: ReturnType<typeof buildOrchestratorEnvelope> | null = null;
    const r = route(topics, bountyContent);
    if (r !== null) {
      const ext = await executeRoute(this.deps.api, r);
      if (ext.ok) {
        orchestratorEnvelope = buildOrchestratorEnvelope({
          bountyId: bountyIdNumber,
          result: ext.data,
          source: 'external',
          sourceProgram: ext.source_program,
          sourceMethod: ext.source_method,
          sourceTxHash: ext.source_tx_hash,
          deliveredBy: this.deps.workerAddress,
          deliveredAtBlock: producedAtBlock,
        });
        log.info({
          ...baseFields,
          op: 'orchestrator',
          source: 'external',
          app: r.app,
          programId: r.programId,
          service: r.service,
          method: r.method,
          topic: r.topic,
          adapterEnvelopeSha256: built.resultHash,
          orchestratorEnvelopeSha256: orchestratorEnvelope.sha256,
        });
      } else {
        log.warn({
          ...baseFields,
          op: 'orchestrator',
          phase: 'execute-route',
          app: r.app,
          programId: r.programId,
          method: `${r.service}/${r.method}`,
          err: ext.error,
          msg: 'executeRoute failed; falling back to groq',
        });
      }
    } else {
      log.info({
        ...baseFields,
        op: 'orchestrator',
        phase: 'route',
        result: 'no-match',
        topics,
        msg: 'no external route matched; falling back to groq',
      });
    }

    if (orchestratorEnvelope === null) {
      const fb = await groqFallback(bountyContent);
      const result: unknown = fb.ok
        ? fb.text
        : { error: 'groq_fallback_failed', detail: fb.error };
      orchestratorEnvelope = buildOrchestratorEnvelope({
        bountyId: bountyIdNumber,
        result,
        source: 'groq_fallback',
        deliveredBy: this.deps.workerAddress,
        deliveredAtBlock: producedAtBlock,
      });
      log.info({
        ...baseFields,
        op: 'orchestrator',
        source: 'groq_fallback',
        groqOk: fb.ok,
        adapterEnvelopeSha256: built.resultHash,
        orchestratorEnvelopeSha256: orchestratorEnvelope.sha256,
      });
    }

    const submit = await doSubmit(
      this.deps.client,
      inflightId,
      orchestratorEnvelope.json,
      orchestratorEnvelope.sha256,
      this.deps.signerMutex,
    );
    if (!submit.ok) {
      transition('Submitting', 'Abandoned');
      await this.abandonAtSubmit(
        candidate,
        claimTxHash,
        orchestratorEnvelope.sha256,
        submit,
      );
      return 'Abandoned';
    }

    // ---- SUBMITTED ----
    // Persistence FIRST (pending_accept atomic-write), serializer release SECOND.
    // If addPendingAccept throws, we never reach release → caller catches +
    // transitions to WaitingForOperatorIntervention (P2 §C).
    const submitBlockNumber = await this.deps.getCurrentBlock();
    await this.deps.workerState.addPendingAccept({
      id: bountyIdStr,
      submit_tx_hash: submit.txHash,
      submit_block_number: submitBlockNumber,
      envelope_sha256: orchestratorEnvelope.sha256,
      added_at: new Date().toISOString(),
    });
    await this.deps.workerState.clearInflight();
    this.deps.serializer.release();
    transition('Submitting', 'Submitted');
    log.info({
      ...baseFields,
      state: 'Submitted',
      envelopeSha256: orchestratorEnvelope.sha256,
    });
    return 'Submitted';
  }

  private async abandonAtClaim(candidate: Candidate, claim: ClaimResult): Promise<void> {
    if (claim.ok) return; // unreachable; type guard
    const errorReason: ClaimErrorReason = claim.error;
    this.deps.logger.warn({
      op: 'fsm',
      candidateId: candidate.id.toString(),
      state: 'Abandoned',
      reason: `claim-err:${errorReason}`,
    });

    // Per operator (b): on Claim-Err the abandoned record carries tx_hashes
    // with only `post` populated (from candidate); claim is NOT recorded even
    // if the SDK's TxErr provided a hash. envelope_sha256 is null (no work done).
    const txHashes: Record<string, `0x${string}`> = {};
    if (candidate.txHash !== null) txHashes.post = candidate.txHash;

    appendHistoryRecord(this.deps.historyPath, this.deps.dedup, {
      id: candidate.id,
      status: 'abandoned',
      completed_at: new Date().toISOString(),
      tx_hashes: txHashes,
      envelope_sha256: null,
    });

    await this.deps.workerState.clearInflight();
    this.deps.serializer.release();
  }

  private async abandonAtSubmit(
    candidate: Candidate,
    claimTxHash: `0x${string}` | undefined,
    envelopeSha256: `0x${string}`,
    submit: SubmitResult,
  ): Promise<void> {
    if (submit.ok) return; // unreachable; type guard
    const errorReason: SubmitErrorReason = submit.error;
    this.deps.logger.warn({
      op: 'fsm',
      candidateId: candidate.id.toString(),
      state: 'Abandoned',
      reason: `submit-err:${errorReason}`,
    });

    // On Submit-Err the abandoned record carries full tx_hashes (post + claim)
    // + envelope_sha256 (work product hash, even though it didn't land on-chain
    // — useful for post-mortem correlation).
    const txHashes: Record<string, `0x${string}`> = {};
    if (candidate.txHash !== null) txHashes.post = candidate.txHash;
    if (claimTxHash) txHashes.claim = claimTxHash;

    appendHistoryRecord(this.deps.historyPath, this.deps.dedup, {
      id: candidate.id,
      status: 'abandoned',
      completed_at: new Date().toISOString(),
      tx_hashes: txHashes,
      envelope_sha256: envelopeSha256,
    });

    await this.deps.workerState.clearInflight();
    this.deps.serializer.release();
  }
}
