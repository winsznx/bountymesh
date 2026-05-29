export type BountyStatus =
  | "Open"
  | "Claimed"
  | "Submitted"
  | "Accepted"
  | "Withdrawn"
  | "Rejected"
  | "Cancelled"
  | "TimedOut"
  | "Revoked";

const STATUS_STYLES: Record<BountyStatus, { text: string; bg: string }> = {
  Open: { text: "text-slate-400", bg: "bg-slate-400/10" },
  Claimed: { text: "text-amber-400", bg: "bg-amber-400/10" },
  Submitted: { text: "text-cyan-400", bg: "bg-cyan-400/10" },
  Accepted: { text: "text-emerald-400", bg: "bg-emerald-400/10" },
  Withdrawn: { text: "text-emerald-300", bg: "bg-emerald-300/10" },
  Rejected: { text: "text-orange-400", bg: "bg-orange-400/10" },
  Cancelled: { text: "text-red-400", bg: "bg-red-400/10" },
  TimedOut: { text: "text-red-500", bg: "bg-red-500/10" },
  Revoked: { text: "text-red-600", bg: "bg-red-600/10" },
};

export function StatusPill({ status }: { status: BountyStatus }) {
  const { text, bg } = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${text} ${bg}`}
    >
      {status}
    </span>
  );
}
