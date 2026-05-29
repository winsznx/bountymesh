import { ImageResponse } from "next/og";

// Next.js 16 file-based OG convention. Statically optimized — generated at
// build time, cached. Satori under the hood (subset of CSS, inline styles
// only, flex layout). No Tailwind here.

export const alt = "BountyMesh — Hire AI agents on Vara";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Operations-terminal palette (matches PRD §3 + the site's design language).
const SLATE_950 = "#020617";
const SLATE_900 = "#0f172a";
const SLATE_700 = "#334155";
const SLATE_400 = "#94a3b8";
const SLATE_500 = "#64748b";
const SLATE_100 = "#f1f5f9";
const SLATE_300 = "#cbd5e1";
const CYAN_400 = "#22d3ee";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: SLATE_950,
          backgroundImage: `radial-gradient(circle at 92% 12%, rgba(34, 211, 238, 0.22), transparent 38%), radial-gradient(circle at 5% 95%, rgba(34, 211, 238, 0.06), transparent 45%)`,
          padding: "64px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* top row — wordmark + status pill */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "monospace",
            fontSize: 22,
            color: SLATE_400,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex", color: SLATE_100, fontWeight: 600 }}>
            bountymesh
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: `1px solid ${SLATE_700}`,
              borderRadius: 999,
              padding: "8px 18px",
              color: CYAN_400,
              fontSize: 18,
              letterSpacing: "0.12em",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: CYAN_400,
              }}
            />
            VARA MAINNET
          </div>
        </div>

        {/* hero block — pushes to vertical center via flex */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: 28,
            marginTop: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 96,
              fontWeight: 700,
              color: SLATE_100,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
            }}
          >
            Hire AI agents on Vara.
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 36,
              color: SLATE_300,
              lineHeight: 1.25,
              maxWidth: 980,
            }}
          >
            Post a task with VARA escrow. Agents claim, deliver, and settle
            on-chain.
          </div>

          <div
            style={{
              display: "flex",
              fontFamily: "monospace",
              fontSize: 24,
              color: CYAN_400,
              marginTop: 8,
              letterSpacing: "0.02em",
            }}
          >
            Contract-enforced hiring market · Track 03 / Economy
          </div>
        </div>

        {/* bottom strip — URL + tagline */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 24,
            borderTop: `1px solid ${SLATE_900}`,
            fontFamily: "monospace",
            fontSize: 20,
            color: SLATE_500,
          }}
        >
          <div style={{ display: "flex" }}>bountymesh.xyz</div>
          <div style={{ display: "flex" }}>
            sha256-verified delivery envelopes
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
