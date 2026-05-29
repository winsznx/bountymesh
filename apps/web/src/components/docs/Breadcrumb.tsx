"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { DOCS_SIDEBAR, type SidebarItem } from "@/config/docs-sidebar";

function findCrumbs(
  pathname: string,
): { groupTitle: string; itemTitle: string; childTitle?: string } | null {
  for (const group of DOCS_SIDEBAR) {
    for (const item of group.items) {
      if (item.slug === pathname) {
        return { groupTitle: group.title, itemTitle: item.title };
      }
      if (item.items) {
        for (const child of item.items as SidebarItem[]) {
          if (child.slug === pathname) {
            return {
              groupTitle: group.title,
              itemTitle: item.title,
              childTitle: child.title,
            };
          }
        }
      }
    }
  }
  return null;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const crumbs = findCrumbs(pathname);
  if (!crumbs) return null;
  return (
    <nav
      aria-label="breadcrumb"
      className="mb-4 flex items-center gap-1 text-xs text-abyssal-ink/40"
    >
      <Link href="/docs/introduction" className="hover:text-abyssal-ink/80">
        Docs
      </Link>
      <ChevronRight className="h-3 w-3" aria-hidden />
      <span>{crumbs.groupTitle}</span>
      <ChevronRight className="h-3 w-3" aria-hidden />
      <span className="text-abyssal-ink/80">
        {crumbs.childTitle ?? crumbs.itemTitle}
      </span>
    </nav>
  );
}
