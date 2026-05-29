import { Children, type ReactNode } from "react";

export function Steps({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <ol className="my-6 space-y-6 border-l-2 border-ash-white pl-6">
      {items.map((child, i) => (
        <li key={i} className="relative">
          <span
            className="absolute -left-[33px] flex h-7 w-7 items-center justify-center rounded-full border border-abyssal-ink/20 bg-ash-white font-mono text-xs text-abyssal-ink/80"
            aria-hidden
          >
            {i + 1}
          </span>
          {child}
        </li>
      ))}
    </ol>
  );
}

export function Step({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 text-base font-semibold text-abyssal-ink">{title}</h4>
      <div className="text-sm leading-relaxed text-abyssal-ink/80 [&_p:last-child]:mb-0 [&_p]:mb-2">
        {children}
      </div>
    </div>
  );
}
