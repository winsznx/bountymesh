/**
 * WorkAdapter contract (P0 §A1 lock).
 *
 * v1 surface intentionally narrow: name + version + execute. The richer
 * shapes I sketched in P0 §5 (describe() + canHandle()) are v2+ extensions
 * for Pattern C multi-adapter selection. v1 ships Pattern A — static
 * config-flag dispatch — so the adapter doesn't need self-description.
 */

import type { Candidate } from '../discovery/types.js';

/**
 * UpstreamSnapshot — what the adapter captured from the external provider.
 * Embedded inside the on-chain envelope (P0 §C3) so a reviewer can replay
 * the call and verify the output deterministically (modulo provider
 * non-determinism — flagged via envelope.provider_determinism).
 */
export interface UpstreamSnapshot {
  provider: string;
  model: string;
  /** JSON-canonicalizable; covered by the envelope's sha256. */
  request_canonical: unknown;
  response_sha256: `0x${string}` | null;
  response_body_inline: string | null;
  attempts: number;
  request_at: string;
  response_at: string | null;
  /** Sanitized string per P2 §3; null on success. */
  error: string | null;
}

/**
 * On success: output_inline (or blob_url+sha256) populated; upstream.error null.
 * On final failure: output_inline === null; upstream.error populated.
 * The envelope-builder maps this directly to the on-chain submission shape.
 */
export interface AdapterOutput {
  output_inline: string | null;
  output_blob_url: string | null;
  output_blob_sha256: `0x${string}` | null;
  upstream: UpstreamSnapshot;
}

/**
 * Adapter execute() options.
 *
 * crashResumed (discipline note D): true if boot detected status='Working'
 * for this bountyId — the worker crashed mid-execution and we're re-trying.
 * Threaded through to envelope.crash_resumed for reviewer visibility. The
 * state machine (P3.7+) detects the resume-from-Working condition and
 * supplies the flag; the adapter itself does NOT read worker state.
 */
export interface ExecuteOptions {
  crashResumed: boolean;
}

export interface WorkAdapter {
  readonly name: string;
  readonly version: string;
  execute(candidate: Candidate, opts: ExecuteOptions): Promise<AdapterOutput>;
}
