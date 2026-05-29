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
      className="inline-flex items-center gap-1.5 rounded-sm bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300"
      title={hash}
    >
      {label && <span className="text-slate-500">{label}</span>}
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 hover:text-cyan-400"
      >
        {truncate(hash)}
        <Copy className="h-3 w-3" aria-hidden />
      </button>
      {explorerBaseUrl && (
        <a
          href={`${explorerBaseUrl}${hash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center text-slate-400 hover:text-cyan-400"
          aria-label="View on explorer"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}
