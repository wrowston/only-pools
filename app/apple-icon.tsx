import { ImageResponse } from "next/og";

/** iOS home-screen / apple-touch-icon size. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const HEAT = "#fa5d19";
const CANVAS = "#f9f9f9";

/**
 * Apple touch icon — bracket mark on brand canvas.
 * Without this, iOS “Add to Home Screen” falls back to a grey letter tile.
 *
 * Drawn with nested divs (not SVG) so `next/og` / Satori renders reliably.
 */
export default function AppleIcon() {
  const stroke = 10;
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: CANVAS,
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        {/* Bracket glyph: 4 → 2 → 1, matching BrandMark / icon.svg */}
        <div
          style={{
            display: "flex",
            height: 112,
            position: "relative",
            width: 112,
          }}
        >
          {/* Top-left fork */}
          <div
            style={{
              borderBottom: `${stroke}px solid ${HEAT}`,
              borderLeft: `${stroke}px solid ${HEAT}`,
              borderTop: `${stroke}px solid ${HEAT}`,
              display: "flex",
              height: 44,
              left: 4,
              position: "absolute",
              top: 8,
              width: 34,
            }}
          />
          {/* Bottom-left fork */}
          <div
            style={{
              borderBottom: `${stroke}px solid ${HEAT}`,
              borderLeft: `${stroke}px solid ${HEAT}`,
              borderTop: `${stroke}px solid ${HEAT}`,
              display: "flex",
              height: 44,
              left: 4,
              position: "absolute",
              top: 60,
              width: 34,
            }}
          />
          {/* Center vertical stem */}
          <div
            style={{
              background: HEAT,
              display: "flex",
              height: 96,
              left: 38,
              position: "absolute",
              top: 8,
              width: stroke,
            }}
          />
          {/* Champion arm */}
          <div
            style={{
              background: HEAT,
              display: "flex",
              height: stroke,
              left: 38,
              position: "absolute",
              top: 51,
              width: 66,
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
