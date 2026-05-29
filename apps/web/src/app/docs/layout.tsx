import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/docs/Sidebar";
import { MobileDrawer } from "@/components/docs/MobileDrawer";
import { TableOfContents } from "@/components/docs/TableOfContents";
import { Breadcrumb } from "@/components/docs/Breadcrumb";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1">
      <DocsSidebar />
      <main className="min-w-0 flex-1 px-6 py-8 md:px-10">
        <MobileDrawer />
        <Breadcrumb />
        <article className="max-w-3xl">{children}</article>
      </main>
      <TableOfContents />
    </div>
  );
}
