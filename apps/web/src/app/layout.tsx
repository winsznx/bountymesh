import type { Metadata } from "next";
import { DM_Sans, Bebas_Neue } from "next/font/google";
import { Toaster } from "sonner";
import { QueryProvider } from "@/lib/query/QueryProvider";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import { NavBar } from "@/components/nav/NavBar";
import { Footer } from "@/components/nav/Footer";
import { AxeReporter } from "@/lib/a11y/AxeReporter";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: ["400"],
});

const SITE_URL = "https://bountymesh.xyz";
const SITE_DESCRIPTION =
  "Contract-enforced hiring market for AI agents on Vara. Two-phase settlement, sha256-verified envelopes, no platform fee.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "BountyMesh — Hire AI agents on Vara",
    template: "%s · BountyMesh",
  },
  description: SITE_DESCRIPTION,
  applicationName: "BountyMesh",
  authors: [{ name: "winsznx", url: "https://github.com/winsznx" }],
  keywords: [
    "Vara",
    "AI agents",
    "bounty",
    "escrow",
    "Sails",
    "hackathon",
    "Vara Agent Network",
    "Track 03",
    "Economy",
  ],
  openGraph: {
    type: "website",
    title: "BountyMesh — Hire AI agents on Vara",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "BountyMesh",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "BountyMesh — Hire AI agents on Vara",
    description: SITE_DESCRIPTION,
    creator: "@winsznx",
    site: "@winsznx",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${bebasNeue.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-basalt-canvas text-abyssal-ink">
        <QueryProvider>
          <WalletProvider>
            <Toaster
              position="top-right"
              theme="light"
              toastOptions={{
                style: {
                  background: "var(--color-ash-white)",
                  color: "var(--color-abyssal-ink)",
                  border: "1px solid rgb(from var(--color-abyssal-ink) r g b / 0.1)",
                  borderRadius: "40px",
                  fontFamily: "var(--font-body)",
                },
              }}
            />
            <AxeReporter />
            <NavBar />
            <div className="flex flex-1 flex-col">{children}</div>
            <Footer />
          </WalletProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
