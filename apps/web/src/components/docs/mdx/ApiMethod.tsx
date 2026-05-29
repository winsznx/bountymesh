import type { ReactNode } from "react";

const TONES = {
  command: { label: "command", className: "bg-digital-orange/10 text-digital-orange" },
  query: { label: "query", className: "bg-cyber-violet/10 text-cyber-violet" },
  event: { label: "event", className: "bg-pixel-glare/30 text-pixel-glare" },
} as const;

type Kind = keyof typeof TONES;

export function ApiMethod({
  kind = "command",
  path,
  children,
}: {
  kind?: Kind;
  path: string;
  children?: ReactNode;
}) {
  const tone = TONES[kind];
  return (
    <div className="mb-6 mt-8 flex flex-wrap items-center gap-3 border-b border-ash-white pb-3">
      <span
        className={`rounded-sm px-2 py-1 font-mono text-xs font-medium uppercase tracking-wider ${tone.className}`}
      >
        {tone.label}
      </span>
      <code className="break-all font-mono text-lg text-abyssal-ink">{path}</code>
      {children && (
        <div className="mt-1 w-full text-sm text-abyssal-ink/60">{children}</div>
      )}
    </div>
  );
}
