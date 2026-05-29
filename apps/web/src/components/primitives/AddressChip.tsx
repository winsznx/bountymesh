"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { encodeHexToSs58, formatAddressTruncated } from "@/lib/format/address";

type Props = {
  address: string;
  chainSS58?: number | null;
  label?: string;
};

export function AddressChip({ address, chainSS58 = null, label }: Props) {
  const { data: ss58 } = useQuery({
    queryKey: ["ss58", address, chainSS58],
    queryFn: () => encodeHexToSs58(address, chainSS58 as number),
    enabled: chainSS58 !== null && address.startsWith("0x"),
    staleTime: Infinity,
  });

  const display = formatAddressTruncated(address, chainSS58, ss58 ?? null);
  const copyValue = ss58 ?? address;

  const onCopy = () => {
    navigator.clipboard.writeText(copyValue).then(
      () => toast.success("Copied", { description: copyValue }),
      () => toast.error("Copy failed"),
    );
  };

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300"
      title={copyValue}
    >
      {label && <span className="text-slate-500">{label}</span>}
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 hover:text-cyan-400"
      >
        {display}
        <Copy className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}
