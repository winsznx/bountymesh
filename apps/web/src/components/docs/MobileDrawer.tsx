"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { SidebarNav } from "./Sidebar";

export function MobileDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Open documentation menu"
          className="mb-4 inline-flex items-center gap-2 rounded-sm border border-ash-white px-3 py-1.5 text-sm text-abyssal-ink/80 hover:border-digital-orange/30 hover:text-digital-orange md:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden />
          Menu
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-basalt-canvas backdrop-blur data-[state=open]:animate-in data-[state=open]:fade-in md:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-r border-ash-white bg-basalt-canvas px-4 py-6 shadow-2xl data-[state=open]:animate-in data-[state=open]:slide-in-from-left md:hidden">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-mono text-sm font-semibold uppercase tracking-wider text-abyssal-ink">
              Docs
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close documentation menu"
                className="rounded-sm p-1 text-abyssal-ink/60 hover:bg-pure-white hover:text-abyssal-ink"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
