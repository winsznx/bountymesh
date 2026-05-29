import { StatusPill, type BountyStatus } from "@/components/primitives/StatusPill";
import type { StatsCounts } from "@/lib/queries/useStats";

const STATUS_ORDER: { status: BountyStatus; key: keyof StatsCounts }[] = [
  { status: "Open", key: "open" },
  { status: "Claimed", key: "claimed" },
  { status: "Submitted", key: "submitted" },
  { status: "Accepted", key: "accepted" },
  { status: "Withdrawn", key: "withdrawn" },
  { status: "Rejected", key: "rejected" },
];

export function StatusBreakdown({ counts }: { counts: StatsCounts }) {
  return (
    <section className="space-y-4 rounded-md border border-slate-800 bg-slate-900/30 p-6">
      <h2 className="text-xs font-medium uppercase tracking-wider text-slate-400">
        Status breakdown
      </h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {STATUS_ORDER.map(({ status, key }) => {
          const count = counts[key];
          const isZero = count === 0;
          return (
            <div
              key={status}
              className={`flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/50 px-4 py-3 transition-opacity ${
                isZero ? "opacity-50" : "opacity-100"
              }`}
            >
              <StatusPill status={status} />
              <span className="font-mono text-2xl text-slate-100">{count}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
