export type Track = "Services" | "Economy" | "Social" | "Open";

export function TrackPill({ track }: { track: Track }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">
      {track}
    </span>
  );
}
