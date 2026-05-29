import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { QueryProvider } from "@/lib/query/QueryProvider";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import { NavBar } from "@/components/nav/NavBar";
import { Footer } from "@/components/nav/Footer";
import { AxeReporter } from "@/lib/a11y/AxeReporter";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
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
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-950 text-slate-100">
        <QueryProvider>
          <WalletProvider>
            <Toaster position="top-right" theme="dark" />
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
