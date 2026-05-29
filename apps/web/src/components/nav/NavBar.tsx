"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Code, Package, ExternalLink } from "lucide-react";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";

const LINKS: { href: string; label: string }[] = [
  { href: "/bounties", label: "Bounties" },
  { href: "/post", label: "Post" },
  { href: "/me", label: "Me" },
  { href: "/agents", label: "Agents" },
  { href: "/stats", label: "Stats" },
  { href: "/docs/introduction", label: "Docs" },
  { href: "/about", label: "About" },
];

const SOCIAL: { href: string; label: string; icon: typeof Code }[] = [
  {
    href: "https://github.com/winsznx/bountymesh",
    label: "GitHub",
    icon: Code,
  },
  {
    href: "https://www.npmjs.com/package/@bountymesh/sdk",
    label: "npm package",
    icon: Package,
  },
  {
    href: "https://vara.subscan.io/account/0xfa09abea4ac2de874bc115cfcfd0992e07636ee9f74e62a21b3750fd6f218886",
    label: "Subscan",
    icon: ExternalLink,
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/docs/introduction") return pathname.startsWith("/docs");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 bg-basalt-canvas px-4 pt-4 md:px-8 md:pt-6">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 rounded-pill bg-ash-white px-3 py-2 shadow-sm lg:gap-4 lg:px-4">
        <Link
          href="/"
          aria-label="BountyMesh home"
          className="flex shrink-0 items-center gap-2 pl-2"
        >
          <span
            aria-hidden
            className="block h-7 w-7 rounded-full bg-digital-orange"
          />
          <span className="hidden font-display text-2xl tracking-heading-sm text-abyssal-ink sm:inline">
            bountymesh
          </span>
        </Link>

        <nav className="hidden items-center gap-x-1 lg:flex">
          {LINKS.map(({ href, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-pill px-3 py-1.5 text-sm font-medium transition-colors xl:px-4 ${
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

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-1 border-l border-abyssal-ink/10 pl-3 xl:flex">
            {SOCIAL.map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                title={label}
                className="rounded-pill p-2 text-abyssal-ink/60 transition-colors hover:bg-basalt-canvas hover:text-abyssal-ink"
              >
                <Icon className="h-4 w-4" />
              </a>
            ))}
          </div>
          <WalletConnectButton />
        </div>
      </div>

      {/* Mobile + tablet nav row (below lg) */}
      <nav className="mx-auto mt-3 flex w-full max-w-7xl flex-wrap items-center gap-x-1 gap-y-2 px-2 lg:hidden">
        {LINKS.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-pill px-3 py-1 text-sm font-medium transition-colors ${
                active
                  ? "bg-ash-white text-digital-orange"
                  : "text-abyssal-ink/70 hover:text-abyssal-ink"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
