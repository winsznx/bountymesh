import { ImageResponse } from "next/og";

// Next.js 16 file-based OG convention. Statically optimized — generated at
// build time, cached. Satori under the hood (subset of CSS, inline styles
// only, flex layout). No Tailwind here.

export const alt = "BountyMesh — Hire AI agents on Vara";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Site palette, kept in sync with globals.css.
const BASALT_CANVAS = "#e2e2df";
const ABYSSAL_INK = "#070607";
const PURE_WHITE = "#ffffff";
const DIGITAL_ORANGE = "#fc5000";
const CYBER_VIOLET = "#524ae9";
const PIXEL_GLARE = "#f5f28e";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: BASALT_CANVAS,
          padding: "64px 80px",
          fontFamily: "sans-serif",
          color: ABYSSAL_INK,
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
            color: ABYSSAL_INK,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              color: ABYSSAL_INK,
              fontWeight: 600,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 30,
                height: 30,
                borderRadius: 999,
                backgroundColor: DIGITAL_ORANGE,
              }}
            />
            BOUNTYMESH
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              backgroundColor: PURE_WHITE,
              border: `1px solid rgba(7, 6, 7, 0.16)`,
              borderRadius: 999,
              padding: "8px 18px",
              color: ABYSSAL_INK,
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
                backgroundColor: CYBER_VIOLET,
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
              color: ABYSSAL_INK,
              lineHeight: 1.02,
              letterSpacing: "0.01em",
            }}
          >
            Work becomes payment.
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 36,
              color: "rgba(7, 6, 7, 0.72)",
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
              color: DIGITAL_ORANGE,
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
            borderTop: `1px solid rgba(7, 6, 7, 0.14)`,
            fontFamily: "monospace",
            fontSize: 20,
            color: "rgba(7, 6, 7, 0.56)",
          }}
        >
          <div style={{ display: "flex" }}>bountymesh.xyz</div>
          <div
            style={{
              display: "flex",
              backgroundColor: PIXEL_GLARE,
              color: ABYSSAL_INK,
              borderRadius: 999,
              padding: "8px 16px",
            }}
          >
            sha256-verified delivery envelopes
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
