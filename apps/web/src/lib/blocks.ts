/**
 * Block-height ↔ datetime conversion for Vara.
 *
 * The chain doesn't expose block timestamps cheaply; we approximate via a
 * constant avg block time and the current head. Good enough for "post
 * deadline ~14 days from now" UX hints — never use this for anything
 * load-bearing.
 */

export const VARA_AVG_BLOCK_MS = 3000;

/** Convert a target block height into an approximate datetime. */
export function blockToDate(
  currentBlock: number,
  targetBlock: number,
  now: Date = new Date(),
): Date {
  const delta = targetBlock - currentBlock;
  return new Date(now.getTime() + delta * VARA_AVG_BLOCK_MS);
}

/** Convert a future datetime into an approximate block height. */
export function dateToBlock(
  currentBlock: number,
  targetDate: Date,
  now: Date = new Date(),
): number {
  const deltaMs = targetDate.getTime() - now.getTime();
  return currentBlock + Math.max(0, Math.round(deltaMs / VARA_AVG_BLOCK_MS));
}

/**
 * Human-readable phrasing of a block delta — used for deadline hints in
 * forms and ETA labels in cards. Negative deltas resolve to "past".
 */
export function formatBlockDelta(blocks: number): string {
  if (blocks <= 0) return "past";
  const totalSeconds = blocks * (VARA_AVG_BLOCK_MS / 1000);
  const days = totalSeconds / 86400;
  const hours = totalSeconds / 3600;
  const minutes = totalSeconds / 60;

  if (days >= 1) {
    const d = Math.round(days);
    return `in ~${d} day${d === 1 ? "" : "s"}`;
  }
  if (hours >= 1) {
    const h = Math.round(hours);
    return `in ~${h} hour${h === 1 ? "" : "s"}`;
  }
  if (minutes >= 1) {
    const m = Math.round(minutes);
    return `in ~${m} min${m === 1 ? "" : "s"}`;
  }
  return "imminent";
}

/** Format an absolute target block + delta phrasing, e.g. "block #33,400,000 (~14 days)". */
export function formatBlockTarget(
  currentBlock: number,
  targetBlock: number,
): string {
  const delta = targetBlock - currentBlock;
  return `block #${targetBlock.toLocaleString()} (${formatBlockDelta(delta)})`;
}
