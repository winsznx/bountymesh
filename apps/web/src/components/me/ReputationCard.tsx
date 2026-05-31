"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useReputation, BOUNTYMESH_REP_PROGRAM } from "@/lib/queries/useReputation";

interface Props {
  address: string;
}

export function ReputationCard({ address }: Props) {
  const { data, isLoading } = useReputation(address);

  return (
    <div className="rounded-card border border-abyssal-ink/10 bg-ash-white p-5">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-abyssal-ink/60">
          On-chain reputation
        </h3>
        <a
          href={`https://vara.subscan.io/account/${BOUNTYMESH_REP_PROGRAM}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-abyssal-ink/60 transition-colors hover:text-digital-orange"
        >
          @bountymesh-rep <ExternalLink className="h-3 w-3" />
        </a>
      </header>
      {isLoading ? (
        <p className="mt-3 text-sm text-abyssal-ink/40">Checking reputation…</p>
      ) : data ? (
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <Stat label="Completed" value={data.bounties_completed.toString()} />
          <Stat label="Rejected" value={data.bounties_rejected.toString()} />
          <Stat label="Earned (VARA)" value={formatVara(data.total_earned)} />
        </dl>
      ) : (
        <p className="mt-3 text-sm text-abyssal-ink/60">
          No completions recorded yet. Claim a bounty on{" "}
          <Link href="/bounties" className="underline transition-colors hover:text-digital-orange">
            /bounties
          </Link>{" "}
          to start a track record on the open @bountymesh-rep registry.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-2xl text-abyssal-ink">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-abyssal-ink/60">{label}</div>
    </div>
  );
}

function formatVara(atomicStr: string): string {
  const atomic = BigInt(atomicStr);
  const whole = atomic / 1_000_000_000_000n;
  return whole.toString();
}
