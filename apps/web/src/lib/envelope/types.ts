/**
 * Envelope shape (mirror of services/worker/src/envelope/build.ts).
 *
 * Used by EnvelopeViewer to type the parsed JSON it receives from
 * /envelopes/{id}.json (the side-channel storage path).
 *
 * When the indexer extension extracts result_payload from extrinsic args and
 * serves via PostGraphile, EnvelopeViewer will switch its data source but the
 * shape stays the same.
 */

export interface UpstreamSnapshot {
  provider: string;
  model: string;
  request_canonical: unknown;
  response_sha256: `0x${string}` | null;
  response_body_inline: string | null;
  attempts: number;
  request_at: string;
  response_at: string | null;
  error: string | null;
}

export interface Envelope {
  v: 1;
  task: string;
  worker: `0x${string}`;
  produced_at: number;
  output_inline: string | null;
  output_blob_url: string | null;
  output_blob_sha256: `0x${string}` | null;
  upstream: UpstreamSnapshot;
  reproducibility: "best-effort";
  provider_determinism: "temp-0-bounded";
  crash_resumed: boolean;
}
