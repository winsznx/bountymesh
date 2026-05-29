"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { encodeHexToSs58, formatAddressTruncated } from "@/lib/format/address";

type Props = {
  address: string;
  chainSS58?: number | null;
  label?: string;
  copyable?: boolean;
};

export function AddressChip({
  address,
  chainSS58 = null,
  label,
  copyable = true,
}: Props) {
  const { data: ss58 } = useQuery({
    queryKey: ["ss58", address, chainSS58],
    queryFn: () => encodeHexToSs58(address, chainSS58 as number),
    enabled: chainSS58 !== null && address.startsWith("0x"),
    staleTime: Infinity,
  });

  const display = formatAddressTruncated(address, chainSS58, ss58 ?? null);
  const copyValue = ss58 ?? address;
  const subscanValue = ss58 ?? address;

  const onCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(copyValue).then(
      () => toast.success("Copied", { description: copyValue }),
      () => toast.error("Copy failed"),
    );
  };

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-input border border-abyssal-ink/20 bg-ash-white px-3 py-1 font-mono text-xs text-abyssal-ink"
      title={copyValue}
    >
      {label && <span className="text-abyssal-ink/60">{label}</span>}
      {copyable ? (
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 transition-colors hover:text-digital-orange"
        >
          {display}
          <Copy className="h-3 w-3" aria-hidden />
        </button>
      ) : (
        <span>{display}</span>
      )}
      <a
        href={`https://vara.subscan.io/account/${subscanValue}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label="View on Subscan"
        className="inline-flex items-center text-abyssal-ink/40 transition-colors hover:text-digital-orange"
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </span>
  );
}
