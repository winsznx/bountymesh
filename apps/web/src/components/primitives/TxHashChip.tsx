"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

type Props = {
  hash: string;
  explorerBaseUrl?: string;
  label?: string;
};

function truncate(h: string): string {
  if (h.length <= 14) return h;
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

const DEFAULT_EXPLORER = "https://vara.subscan.io/extrinsic/";

export function TxHashChip({
  hash,
  explorerBaseUrl = DEFAULT_EXPLORER,
  label,
}: Props) {
  const onCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(hash).then(
      () => toast.success("Copied", { description: hash }),
      () => toast.error("Copy failed"),
    );
  };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-input border border-abyssal-ink/20 bg-ash-white px-3 py-1 font-mono text-xs text-abyssal-ink"
      title={hash}
    >
      {label && <span className="text-abyssal-ink/60">{label}</span>}
      <a
        href={`${explorerBaseUrl}${hash}`}
        target="_blank"
        rel="noreferrer"
        className="transition-colors hover:text-digital-orange"
      >
        {truncate(hash)}
      </a>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy hash"
        className="inline-flex items-center text-abyssal-ink/40 transition-colors hover:text-digital-orange"
      >
        <Copy className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}
