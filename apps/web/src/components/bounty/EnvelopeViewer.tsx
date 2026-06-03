"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { canonicalJson } from "@/lib/envelope/canonical-json";
import { sha256Hex } from "@/lib/envelope/sha256";
import type { Envelope } from "@/lib/envelope/types";

type Props = {
  bountyId: bigint;
  resultHash: string | null;
  /** Canonical-JSON envelope string as projected from the on-chain result_payload field. */
  resultPayload: string | null;
};

interface EnvelopePayload {
  raw: string;
  parsed: Envelope | null;
  pretty: string;
}

function buildEnvelopePayload(raw: string | null): EnvelopePayload | null {
  if (!raw) return null;
  let parsed: Envelope | null = null;
  let pretty = raw;
  try {
    parsed = JSON.parse(raw) as Envelope;
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    // raw isn't JSON-parseable; keep raw text as pretty
  }
  return { raw, parsed, pretty };
}

export function EnvelopeViewer({ bountyId, resultHash, resultPayload }: Props) {
  const envelope = useMemo(() => buildEnvelopePayload(resultPayload), [resultPayload]);

  const verifyQuery = useQuery({
    queryKey: ["envelope-hash", bountyId.toString(), envelope?.raw ?? null],
    queryFn: async () => {
      if (!envelope) throw new Error("no envelope");
      if (!envelope.parsed) throw new Error("envelope not JSON");
      const canonical = canonicalJson(envelope.parsed);
      return await sha256Hex(canonical);
    },
    enabled: !!envelope?.parsed,
    staleTime: Infinity,
  });

  const onCopyHash = () => {
    if (!resultHash) return;
    navigator.clipboard.writeText(resultHash).then(
      () => toast.success("Copied", { description: resultHash }),
      () => toast.error("Copy failed"),
    );
  };

  const onCopyEnvelope = () => {
    if (!envelope) return;
    navigator.clipboard.writeText(envelope.raw).then(
      () => toast.success("Envelope JSON copied"),
      () => toast.error("Copy failed"),
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
        Submission envelope
      </h2>

      <div className="space-y-3 rounded-md border border-ash-white bg-ash-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-abyssal-ink/40">
              result_hash (on-chain)
            </div>
            {resultHash ? (
              <button
                type="button"
                onClick={onCopyHash}
                title={resultHash}
                className="inline-flex items-center gap-2 font-mono text-sm text-digital-orange hover:text-digital-orange"
              >
                {resultHash}
                <Copy className="h-3 w-3" aria-hidden />
              </button>
            ) : (
              <div className="text-sm italic text-abyssal-ink/40">no hash yet</div>
            )}
          </div>
          <VerificationBadge
            envelope={envelope}
            computedHash={verifyQuery.data ?? null}
            computedHashLoading={verifyQuery.isFetching}
            onChainHash={resultHash}
          />
        </div>

        <EnvelopeBody envelope={envelope} onCopy={onCopyEnvelope} />
      </div>
    </section>
  );
}

function VerificationBadge({
  envelope,
  computedHash,
  computedHashLoading,
  onChainHash,
}: {
  envelope: EnvelopePayload | null;
  computedHash: `0x${string}` | null;
  computedHashLoading: boolean;
  onChainHash: string | null;
}) {
  if (!envelope) return <Pill tone="slate">Awaiting submission</Pill>;
  if (!envelope.parsed) return <Pill tone="orange">Envelope not JSON</Pill>;
  if (!onChainHash) return <Pill tone="slate">No on-chain hash to verify against</Pill>;
  if (computedHashLoading || !computedHash) {
    return <Pill tone="slate" icon={<Loader2 className="h-3 w-3 animate-spin" aria-hidden />}>Verifying…</Pill>;
  }
  if (computedHash.toLowerCase() === onChainHash.toLowerCase()) {
    return <Pill tone="emerald" icon={<Check className="h-3 w-3" aria-hidden />}>Envelope verified</Pill>;
  }
  return <Pill tone="red" icon={<X className="h-3 w-3" aria-hidden />}>Hash mismatch</Pill>;
}

function EnvelopeBody({
  envelope,
  onCopy,
}: {
  envelope: EnvelopePayload | null;
  onCopy: () => void;
}) {
  if (!envelope) {
    return (
      <p className="py-4 text-sm text-abyssal-ink/40">
        Worker has not submitted yet — envelope will appear here once the on-chain Submit lands.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-abyssal-ink/40">payload</div>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-xs text-abyssal-ink/60 hover:text-digital-orange"
        >
          <Copy className="h-3 w-3" />
          Copy raw
        </button>
      </div>
      <pre className="max-h-96 overflow-auto rounded-md border border-ash-white bg-basalt-canvas p-3 font-mono text-xs leading-relaxed text-abyssal-ink/80">
        {envelope.pretty}
      </pre>
    </div>
  );
}

function Pill({
  tone,
  icon,
  children,
}: {
  tone: "emerald" | "red" | "slate" | "orange";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const styles = {
    emerald: "text-cyber-violet bg-cyber-violet/10",
    red: "text-digital-orange bg-digital-orange/10",
    slate: "text-abyssal-ink/60 bg-abyssal-ink/60/10",
    orange: "text-digital-orange bg-digital-orange/10",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${styles}`}
    >
      {icon}
      {children}
    </span>
  );
}
