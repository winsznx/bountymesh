import type { ReactNode } from "react";

export function ParamTable({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 divide-y divide-abyssal-ink/10 overflow-hidden rounded-md border border-ash-white">
      {children}
    </div>
  );
}

export function Param({
  name,
  type,
  required = false,
  children,
}: {
  name: string;
  type: string;
  required?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <code className="rounded-sm bg-ash-white px-1.5 py-0.5 font-mono text-sm text-digital-orange">
          {name}
        </code>
        <span className="font-mono text-xs text-abyssal-ink/40">{type}</span>
        {required && (
          <span className="rounded-full bg-digital-orange/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-digital-orange">
            required
          </span>
        )}
      </div>
      {children && (
        <div className="text-sm leading-relaxed text-abyssal-ink/60 [&_p:last-child]:mb-0 [&_p]:mb-2">
          {children}
        </div>
      )}
    </div>
  );
}
