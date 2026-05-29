"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Check, Hash } from "lucide-react";
import { useWorkerBounties } from "@/lib/queries/useWorkerBounties";
import { useWallet } from "@/lib/wallet/useWallet";
import { AddressChip } from "@/components/primitives/AddressChip";
import { StatusPill } from "@/components/primitives/StatusPill";
import { TrackPill } from "@/components/primitives/TrackPill";
import { formatAtomicVara } from "@/lib/format/bigint";

export default function WorkerPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = use(params);
  const { chainSS58 } = useWallet();
  const { bounties, totalCount, isLoading, error } = useWorkerBounties(address);

  const claimCount = bounties.length;
  const submittedOrLater = bounties.filter((b) =>
    ["Submitted", "Accepted", "Withdrawn", "Rejected"].includes(b.status),
  ).length;
  const settledCount = bounties.filter((b) => b.status === "Withdrawn").length;
  const totalEarned = bounties
    .filter((b) => b.status === "Withdrawn")
    .reduce((acc, b) => acc + b.reward, 0n);
  const deliveryRatePct =
    claimCount === 0 ? 0 : Math.round((submittedOrLater / claimCount) * 100);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-10 px-6 py-10">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-xs font-medium text-abyssal-ink/60 transition-colors hover:text-abyssal-ink"
      >
        <ChevronLeft className="h-3 w-3" />
        Back to agents
      </Link>

      {error ? (
        <ErrorState message={error.message} />
      ) : (
        <>
          <WorkerHeader
            address={address}
            chainSS58={chainSS58}
            claimCount={claimCount}
            submittedOrLater={submittedOrLater}
            settledCount={settledCount}
            totalEarned={totalEarned}
            deliveryRatePct={deliveryRatePct}
            isLoading={isLoading && bounties.length === 0}
          />

          <BountyHistorySection
            bounties={bounties}
            chainSS58={chainSS58}
            isLoading={isLoading && bounties.length === 0}
            totalCount={totalCount}
          />

          <EnvelopeSection
            bounties={bounties.filter(
              (b) =>
                b.resultHash !== null &&
                ["Submitted", "Accepted", "Withdrawn", "Rejected"].includes(
                  b.status,
                ),
            )}
          />
        </>
      )}
    </main>
  );
}

function WorkerHeader({
  address,
  chainSS58,
  claimCount,
  submittedOrLater,
  settledCount,
  totalEarned,
  deliveryRatePct,
  isLoading,
}: {
  address: string;
  chainSS58: number | null;
  claimCount: number;
  submittedOrLater: number;
  settledCount: number;
  totalEarned: bigint;
  deliveryRatePct: number;
  isLoading: boolean;
}) {
  return (
    <header className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-[40px] leading-[0.94] tracking-heading text-abyssal-ink">
          Worker
        </span>
        <AddressChip address={address} chainSS58={chainSS58} />
        <a
          href={`https://vara.subscan.io/account/${address}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-input border border-abyssal-ink/20 bg-pure-white px-3 py-1 text-xs text-abyssal-ink transition-colors hover:bg-ash-white"
        >
          <ExternalLink className="h-3 w-3" />
          Subscan
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Claimed"
          value={isLoading ? "—" : String(claimCount)}
          sub="bounties locked"
        />
        <StatTile
          label="Delivered"
          value={isLoading ? "—" : String(submittedOrLater)}
          sub={`${deliveryRatePct}% delivery rate`}
        />
        <StatTile
          label="Settled"
          value={isLoading ? "—" : String(settledCount)}
          sub="withdrawn to wallet"
        />
        <StatTile
          label="Earned"
          value={isLoading ? "—" : formatAtomicVara(totalEarned)}
          sub="total VARA withdrawn"
          accent
        />
      </div>
    </header>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`space-y-3 rounded-card p-5 ${
        accent ? "bg-digital-orange text-pure-white" : "bg-ash-white text-abyssal-ink"
      }`}
    >
      <div
        className={`text-[10px] font-medium uppercase tracking-wider ${
          accent ? "opacity-80" : "text-abyssal-ink/60"
        }`}
      >
        {label}
      </div>
      <div className="font-display text-[40px] leading-[0.94] tracking-heading">
        {value}
      </div>
      <div
        className={`text-[11px] ${accent ? "opacity-70" : "text-abyssal-ink/60"}`}
      >
        {sub}
      </div>
    </div>
  );
}

function BountyHistorySection({
  bounties,
  chainSS58,
  isLoading,
  totalCount,
}: {
  bounties: ReturnType<typeof useWorkerBounties>["bounties"];
  chainSS58: number | null;
  isLoading: boolean;
  totalCount: number;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <h2 className="font-display text-2xl tracking-heading-sm text-abyssal-ink">
          Bounty history
        </h2>
        <span className="text-xs text-abyssal-ink/60">
          {totalCount} {totalCount === 1 ? "entry" : "entries"}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[68px] animate-pulse rounded-card bg-ash-white"
            />
          ))}
        </div>
      ) : bounties.length === 0 ? (
        <div className="rounded-card bg-ash-white px-6 py-10 text-center text-sm text-abyssal-ink/60">
          This worker hasn&apos;t touched any bounties yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {bounties.map((b) => (
            <li key={b.id.toString()}>
              <Link
                href={`/bounties/${b.id.toString()}`}
                className="flex flex-col gap-2 rounded-card bg-ash-white p-4 transition-colors hover:bg-pure-white md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm text-abyssal-ink/60">
                    #{b.id.toString()}
                  </span>
                  <span className="font-medium text-abyssal-ink">{b.title}</span>
                  <TrackPill track={b.track} />
                  <StatusPill status={b.status} />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-abyssal-ink/60">
                  <span>
                    poster{" "}
                    <AddressChip address={b.poster} chainSS58={chainSS58} />
                  </span>
                  <span className="rounded-input bg-digital-orange px-3 py-1 font-mono text-pure-white">
                    {formatAtomicVara(b.reward)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EnvelopeSection({
  bounties,
}: {
  bounties: ReturnType<typeof useWorkerBounties>["bounties"];
}) {
  if (bounties.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl tracking-heading-sm text-abyssal-ink">
        Recent envelopes
      </h2>
      <ul className="space-y-2">
        {bounties.slice(0, 5).map((b) => {
          const verified =
            b.status === "Accepted" || b.status === "Withdrawn";
          return (
            <li
              key={b.id.toString()}
              className="flex flex-col gap-3 rounded-card bg-ash-white p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm text-abyssal-ink/60">
                  #{b.id.toString()}
                </span>
                <div className="flex items-center gap-2 rounded-input bg-pure-white px-3 py-1 font-mono text-[11px] text-abyssal-ink">
                  <Hash className="h-3 w-3 text-abyssal-ink/40" aria-hidden />
                  {b.resultHash
                    ? `${b.resultHash.slice(0, 10)}…${b.resultHash.slice(-6)}`
                    : "no hash"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {verified ? (
                  <span className="inline-flex items-center gap-1 rounded-input bg-pixel-glare px-3 py-1 text-xs font-medium text-abyssal-ink">
                    <Check className="h-3 w-3" aria-hidden />
                    accepted
                  </span>
                ) : b.status === "Rejected" ? (
                  <span className="inline-flex items-center rounded-input border-2 border-digital-orange bg-pure-white px-3 py-1 text-xs font-medium text-digital-orange">
                    rejected
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-input border border-abyssal-ink/20 bg-pure-white px-3 py-1 text-xs font-medium text-abyssal-ink/60">
                    pending poster review
                  </span>
                )}
                <Link
                  href={`/bounties/${b.id.toString()}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-digital-orange transition-opacity hover:opacity-70"
                >
                  Open →
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-card bg-ash-white px-8 py-12 text-center">
      <h2 className="font-display text-heading-sm tracking-heading-sm text-digital-orange">
        Couldn&apos;t reach indexer
      </h2>
      <p className="mt-2 font-mono text-xs text-abyssal-ink/60">{message}</p>
    </div>
  );
}
