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

/**
 * Themed status pill. 100px (input) radius — pill-shaped, never a chip.
 * Each status maps to a distinct color recipe per the v2 status surface.
 */
const STATUS_STYLES: Record<BountyStatus, string> = {
  // Pre-terminal (active lifecycle)
  Open: "bg-cyber-violet text-pure-white",
  Claimed: "bg-pixel-glare text-abyssal-ink",
  Submitted: "bg-digital-orange text-pure-white",
  Accepted: "bg-ash-white text-abyssal-ink border-2 border-abyssal-ink",
  Withdrawn: "bg-abyssal-ink text-pure-white",
  // v2 terminal states — each visually distinct
  Cancelled:
    "bg-basalt-canvas text-abyssal-ink/60 border border-abyssal-ink/30",
  Rejected:
    "bg-pure-white text-digital-orange border-2 border-digital-orange",
  TimedOut:
    "bg-pure-white text-abyssal-ink/60 border-2 border-abyssal-ink/30",
  Revoked: "bg-abyssal-ink text-pixel-glare",
};

export function StatusPill({ status }: { status: BountyStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-input px-3 py-1 text-body-sm font-medium leading-body-sm ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
