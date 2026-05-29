export type Track = "Services" | "Economy" | "Social" | "Open";

/**
 * Themed track pill. Bordered, 100px radius, uppercase DM Sans.
 * Color-neutral (border-only) so it sits quietly next to the louder StatusPill.
 */
export function TrackPill({ track }: { track: Track }) {
  return (
    <span className="inline-flex items-center rounded-input border-2 border-abyssal-ink px-3 py-1 text-xs font-medium uppercase tracking-wider text-abyssal-ink">
      {track}
    </span>
  );
}
