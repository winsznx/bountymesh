import { formatAtomicRaw, formatAtomicVara } from "@/lib/format/bigint";

type Props = {
  atomic: bigint;
  align?: "left" | "right";
};

/**
 * RewardCell — the headline moneyshot. The big number uses the display font;
 * the atomic-unit caption below uses DM Sans so the eye reads the headline first.
 */
export function RewardCell({ atomic, align = "left" }: Props) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  return (
    <div className={alignClass}>
      <div className="font-display text-heading-sm leading-heading-sm tracking-heading-sm text-abyssal-ink">
        {formatAtomicVara(atomic)}
      </div>
      <div className="mt-1 text-xs text-abyssal-ink/40">
        {formatAtomicRaw(atomic)} atomic
      </div>
    </div>
  );
}
