import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

export function Card({
  title,
  description,
  href,
  icon,
  children,
}: {
  title: string;
  description?: string;
  href?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  const Inner = (
    <div className="group flex h-full flex-col gap-2 rounded-md border border-ash-white bg-ash-white p-4 transition-colors hover:border-digital-orange/30 hover:bg-pure-white/70">
      {icon && <div className="mb-1 text-digital-orange">{icon}</div>}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-abyssal-ink">{title}</h3>
        {href && (
          <ArrowRight
            className="h-4 w-4 text-abyssal-ink/40 transition-transform group-hover:translate-x-0.5 group-hover:text-digital-orange"
            aria-hidden
          />
        )}
      </div>
      {description && (
        <p className="text-sm leading-relaxed text-abyssal-ink/60">{description}</p>
      )}
      {children && <div className="text-sm text-abyssal-ink/80">{children}</div>}
    </div>
  );
  if (!href) return Inner;
  return <Link href={href}>{Inner}</Link>;
}
