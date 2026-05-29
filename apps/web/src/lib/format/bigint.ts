const VARA_DECIMALS = 12n;
const VARA_DIVISOR = 10n ** VARA_DECIMALS;
const ATOMIC_PER_VARA = Number(VARA_DIVISOR);

export function parseAtomicUnits(s: string): bigint {
  return BigInt(s);
}

export function formatAtomicRaw(atomic: bigint): string {
  return atomic.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatAtomicVara(atomic: bigint): string {
  const whole = atomic / VARA_DIVISOR;
  const fraction = atomic % VARA_DIVISOR;
  if (fraction === 0n) return `${whole.toString()} VARA`;
  const combined = Number(whole) + Number(fraction) / ATOMIC_PER_VARA;
  const trimmed = combined.toFixed(3).replace(/\.?0+$/, "");
  return `${trimmed} VARA`;
}
