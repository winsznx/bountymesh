/**
 * Submission envelope builder (P0 §C1 lock).
 *
 * Envelope shape:
 *   {
 *     v: 1,
 *     task: <bountyId-string>,
 *     worker: <hex-address>,
 *     produced_at: <block-number>,
 *     output_inline: <string | null>,
 *     output_blob_url: <url | null>,
 *     output_blob_sha256: <hex | null>,
 *     upstream: { provider, model, request_canonical, response_sha256, ... },
 *     reproducibility: 'best-effort',
 *     provider_determinism: 'temp-0-bounded',
 *     crash_resumed: <bool>
 *   }
 *
 * result_hash = sha256(canonicalJson(envelope) bytes). This hash is what the
 * worker calls Submit with on-chain. End-to-end verifiable: a reviewer can
 * pull the on-chain result_payload (= the canonical string), re-canonicalize,
 * re-hash, and confirm match.
 */

import type { AdapterOutput } from '../adapter/types.js';
import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

export interface BuildEnvelopeInput {
  bountyId: bigint;
  workerAddress: `0x${string}`;
  producedAtBlock: number;
  adapterOutput: AdapterOutput;
  /** P2 §2 / P3.6 lock D: set by the FSM when boot detected status='Working'. */
  crashResumed: boolean;
}

export interface BuiltEnvelope {
  envelope: Record<string, unknown>;
  canonical: string;
  resultHash: `0x${string}`;
}

export function buildEnvelope(input: BuildEnvelopeInput): BuiltEnvelope {
  const envelope: Record<string, unknown> = {
    v: 1,
    task: input.bountyId.toString(),
    worker: input.workerAddress,
    produced_at: input.producedAtBlock,
    output_inline: input.adapterOutput.output_inline,
    output_blob_url: input.adapterOutput.output_blob_url,
    output_blob_sha256: input.adapterOutput.output_blob_sha256,
    upstream: input.adapterOutput.upstream as unknown as Record<string, unknown>,
    reproducibility: 'best-effort',
    provider_determinism: 'temp-0-bounded',
    crash_resumed: input.crashResumed,
  };
  const canonical = canonicalJson(envelope);
  const resultHash = sha256Hex(canonical);
  return { envelope, canonical, resultHash };
}
