import { Info, AlertTriangle, Lightbulb, AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

type Variant = "info" | "warning" | "tip" | "error";

const STYLES: Record<
  Variant,
  { border: string; bg: string; iconColor: string; Icon: typeof Info }
> = {
  info: {
    border: "border-digital-orange/30",
    bg: "bg-digital-orange/10",
    iconColor: "text-digital-orange",
    Icon: Info,
  },
  warning: {
    border: "border-pixel-glare",
    bg: "bg-pixel-glare/30",
    iconColor: "text-abyssal-ink",
    Icon: AlertTriangle,
  },
  tip: {
    border: "border-cyber-violet/30",
    bg: "bg-cyber-violet/10",
    iconColor: "text-cyber-violet",
    Icon: Lightbulb,
  },
  error: {
    border: "border-digital-orange/30",
    bg: "bg-digital-orange/10",
    iconColor: "text-digital-orange",
    Icon: AlertCircle,
  },
};

export function Callout({
  type = "info",
  children,
  title,
}: {
  type?: Variant;
  children: ReactNode;
  title?: string;
}) {
  const { border, bg, iconColor, Icon } = STYLES[type];
  return (
    <div className={`my-6 rounded-md border ${border} ${bg} p-4`}>
      <div className="flex gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} aria-hidden />
        <div className="min-w-0 flex-1">
          {title && (
            <div className="mb-1 text-sm font-medium text-abyssal-ink">{title}</div>
          )}
          <div className="text-sm leading-relaxed text-abyssal-ink/80 [&_p:last-child]:mb-0 [&_p]:mb-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
