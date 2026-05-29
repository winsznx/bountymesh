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
  { href: "/docs/introduction", label: "Docs" },
  { href: "/about", label: "About" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/docs/introduction") return pathname.startsWith("/docs");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar() {
  const pathname = usePathname();
  return (
    <header className="bg-basalt-canvas">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5">
        <Link
          href="/"
          className="font-display text-2xl tracking-heading-sm text-abyssal-ink transition-opacity hover:opacity-70"
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
                className={`relative px-3 py-1.5 font-medium transition-colors ${
                  active
                    ? "text-digital-orange"
                    : "text-abyssal-ink/70 hover:text-abyssal-ink"
                }`}
              >
                {label}
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
