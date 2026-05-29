import { formatAtomicRaw, formatAtomicVara } from "@/lib/format/bigint";

type Props = {
  atomic: bigint;
  align?: "left" | "right";
};

export function RewardCell({ atomic, align = "left" }: Props) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  return (
    <div className={`font-mono ${alignClass}`}>
      <div className="text-slate-100">{formatAtomicRaw(atomic)}</div>
      <div className="text-xs text-slate-500">{formatAtomicVara(atomic)}</div>
    </div>
  );
}
