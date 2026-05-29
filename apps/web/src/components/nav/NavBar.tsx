"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";

const LINKS: { href: string; label: string }[] = [
  { href: "/bounties", label: "Bounties" },
  { href: "/post", label: "Post" },
  { href: "/me", label: "Me" },
  { href: "/stats", label: "Stats" },
  { href: "/agents", label: "Agents" },
  { href: "/about", label: "About" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar() {
  const pathname = usePathname();
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
        <Link
          href="/"
          className="font-mono text-base font-semibold text-slate-100 hover:text-cyan-400"
        >
          bountymesh
        </Link>
        <nav className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
          {LINKS.map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`relative px-3 py-1.5 transition-colors ${
                  active
                    ? "text-cyan-400"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-[13px] h-[2px] bg-cyan-400" aria-hidden />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
