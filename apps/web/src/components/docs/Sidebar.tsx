"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_SIDEBAR, type SidebarItem } from "@/config/docs-sidebar";

export function DocsSidebar() {
  return (
    <aside className="hidden h-full w-64 shrink-0 overflow-y-auto border-r border-ash-white px-4 py-8 md:block">
      <SidebarNav />
    </aside>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-6">
      {DOCS_SIDEBAR.map((group) => (
        <div key={group.title} className="space-y-1">
          <div className="mb-2 px-2 font-mono text-xs font-medium uppercase tracking-wider text-abyssal-ink/60">
            {group.title}
          </div>
          {group.items.map((item) => (
            <SidebarNode
              key={item.slug}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function SidebarNode({
  item,
  pathname,
  depth = 0,
  onNavigate,
}: {
  item: SidebarItem;
  pathname: string;
  depth?: number;
  onNavigate?: () => void;
}) {
  const isActive = pathname === item.slug;
  const hasChildren = item.items && item.items.length > 0;
  return (
    <div>
      <Link
        href={item.slug}
        onClick={onNavigate}
        className={`block rounded-sm px-2 py-1 text-sm transition-colors ${
          isActive
            ? "bg-digital-orange/10 text-digital-orange"
            : "text-abyssal-ink/80 hover:bg-pure-white hover:text-abyssal-ink"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {item.title}
      </Link>
      {hasChildren && (
        <div className="mt-1 space-y-1">
          {item.items!.map((child) => (
            <SidebarNode
              key={child.slug}
              item={child}
              pathname={pathname}
              depth={depth + 1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
