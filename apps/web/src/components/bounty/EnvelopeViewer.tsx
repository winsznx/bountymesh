"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { canonicalJson } from "@/lib/envelope/canonical-json";
import { sha256Hex } from "@/lib/envelope/sha256";
import type { Envelope } from "@/lib/envelope/types";

type Props = {
  bountyId: bigint;
  resultHash: string | null;
};

interface EnvelopePayload {
  raw: string;
  parsed: Envelope | null;
  pretty: string;
}

async function fetchEnvelope(bountyId: bigint): Promise<EnvelopePayload> {
  const res = await fetch(`/envelopes/${bountyId.toString()}.json`);
  if (!res.ok) {
    throw new Error("not-available");
  }
  const raw = await res.text();
  let parsed: Envelope | null = null;
  let pretty = raw;
  try {
    parsed = JSON.parse(raw) as Envelope;
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    // raw is not JSON-parseable; keep raw text as pretty too
  }
  return { raw, parsed, pretty };
}

export function EnvelopeViewer({ bountyId, resultHash }: Props) {
  const envelopeQuery = useQuery({
    queryKey: ["envelope", bountyId.toString()],
    queryFn: () => fetchEnvelope(bountyId),
    staleTime: Infinity,
    retry: 0,
  });

  const verifyQuery = useQuery({
    queryKey: ["envelope-hash", bountyId.toString(), envelopeQuery.data?.raw ?? null],
    queryFn: async () => {
      if (!envelopeQuery.data) throw new Error("no envelope");
      if (!envelopeQuery.data.parsed) throw new Error("envelope not JSON");
      const canonical = canonicalJson(envelopeQuery.data.parsed);
      return await sha256Hex(canonical);
    },
    enabled: !!envelopeQuery.data?.parsed,
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
    if (!envelopeQuery.data) return;
    navigator.clipboard.writeText(envelopeQuery.data.raw).then(
      () => toast.success("Envelope JSON copied"),
      () => toast.error("Copy failed"),
    );
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
        Submission envelope
      </h2>

      <div className="space-y-3 rounded-md border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              result_hash (on-chain)
            </div>
            {resultHash ? (
              <button
                type="button"
                onClick={onCopyHash}
                title={resultHash}
                className="inline-flex items-center gap-2 font-mono text-sm text-cyan-400 hover:text-cyan-300"
              >
                {resultHash}
                <Copy className="h-3 w-3" aria-hidden />
              </button>
            ) : (
              <div className="text-sm italic text-slate-500">no hash yet</div>
            )}
          </div>
          <VerificationBadge
            envelope={envelopeQuery.data ?? null}
            envelopeError={envelopeQuery.error}
            envelopeLoading={envelopeQuery.isLoading}
            computedHash={verifyQuery.data ?? null}
            computedHashLoading={verifyQuery.isFetching}
            onChainHash={resultHash}
          />
        </div>

        <EnvelopeBody
          envelope={envelopeQuery.data ?? null}
          envelopeError={envelopeQuery.error}
          envelopeLoading={envelopeQuery.isLoading}
          onCopy={onCopyEnvelope}
        />
      </div>
    </section>
  );
}

function VerificationBadge({
  envelope,
  envelopeError,
  envelopeLoading,
  computedHash,
  computedHashLoading,
  onChainHash,
}: {
  envelope: EnvelopePayload | null;
  envelopeError: Error | null;
  envelopeLoading: boolean;
  computedHash: `0x${string}` | null;
  computedHashLoading: boolean;
  onChainHash: string | null;
}) {
  if (envelopeLoading) return <Pill tone="slate" icon={<Loader2 className="h-3 w-3 animate-spin" aria-hidden />}>Loading envelope</Pill>;
  if (envelopeError) return <Pill tone="slate">Envelope not available</Pill>;
  if (!envelope?.parsed) return <Pill tone="orange">Envelope not JSON</Pill>;
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
  envelopeError,
  envelopeLoading,
  onCopy,
}: {
  envelope: EnvelopePayload | null;
  envelopeError: Error | null;
  envelopeLoading: boolean;
  onCopy: () => void;
}) {
  if (envelopeLoading) {
    return <div className="h-24 animate-pulse rounded-sm bg-slate-800/50" />;
  }
  if (envelopeError) {
    return (
      <p className="py-4 text-sm text-slate-500">
        Envelope not available — payload may not be indexed yet.
      </p>
    );
  }
  if (!envelope) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-500">payload</div>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-400"
        >
          <Copy className="h-3 w-3" />
          Copy raw
        </button>
      </div>
      <pre className="max-h-96 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-300">
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
    emerald: "text-emerald-400 bg-emerald-400/10",
    red: "text-red-400 bg-red-400/10",
    slate: "text-slate-400 bg-slate-400/10",
    orange: "text-orange-400 bg-orange-400/10",
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
