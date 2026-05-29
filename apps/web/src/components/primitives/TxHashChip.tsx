"use client";

import { Copy, ExternalLink } from "lucide-react";
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

export function TxHashChip({ hash, explorerBaseUrl, label }: Props) {
  const onCopy = () => {
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
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 transition-colors hover:text-digital-orange"
      >
        {truncate(hash)}
        <Copy className="h-3 w-3" aria-hidden />
      </button>
      {explorerBaseUrl && (
        <a
          href={`${explorerBaseUrl}${hash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center text-abyssal-ink/60 transition-colors hover:text-digital-orange"
          aria-label="View on explorer"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}
