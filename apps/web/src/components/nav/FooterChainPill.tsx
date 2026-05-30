"use client";

import { useChainHead } from "@/lib/queries/useChainHead";

/**
 * Client-only chain-head pill for the footer. Lives in its own file so
 * Footer.tsx can import it via `next/dynamic` with `ssr: false`, which
 * guarantees the server never renders the dynamic head/down state — that
 * was the source of the prior hydration mismatch warning that surfaced
 * in production devtools.
 */
export function FooterChainPill() {
  const head = useChainHead();
  const healthy = head !== null;

  return (
    <>
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          healthy ? "bg-cyber-violet" : "bg-digital-orange"
        }`}
        aria-hidden
      />
      {healthy ? `head #${head.head.toLocaleString()}` : "indexer down"}
    </>
  );
}
