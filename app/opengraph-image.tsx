import { ImageResponse } from "next/og";

export const alt =
  "Only Pools — private NFL Survivor and Confidence pools without the busywork";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const teams = [
  { abbreviation: "BUF", value: "14" },
  { abbreviation: "DET", value: "12" },
  { abbreviation: "KC", value: "10" },
];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#f9f9f9",
          color: "#262626",
          display: "flex",
          fontFamily: "sans-serif",
          height: "100%",
          justifyContent: "space-between",
          overflow: "hidden",
          padding: "64px 72px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            backgroundImage:
              "linear-gradient(#ededed 1px, transparent 1px), linear-gradient(90deg, #ededed 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            display: "flex",
            inset: 0,
            maskImage:
              "linear-gradient(90deg, rgba(0,0,0,.52), rgba(0,0,0,.08))",
            position: "absolute",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            justifyContent: "space-between",
            position: "relative",
            width: "610px",
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: "14px" }}>
            <BracketMark />
            <span
              style={{
                fontSize: 27,
                fontWeight: 700,
                letterSpacing: "-1px",
              }}
            >
              Only Pools
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                color: "#fa5d19",
                display: "flex",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "2px",
                marginBottom: "20px",
                textTransform: "uppercase",
              }}
            >
              Survivor · Confidence
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: 64,
                fontWeight: 700,
                letterSpacing: "-3.5px",
                lineHeight: 1.02,
              }}
            >
              <span>NFL pools</span>
              <span>without the busywork.</span>
            </div>
            <div
              style={{
                color: "#6a6a6a",
                display: "flex",
                fontSize: 23,
                lineHeight: 1.4,
                marginTop: "24px",
              }}
            >
              Invite your people. Make your picks. Follow the standings.
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e3e3e3",
            borderRadius: "22px",
            boxShadow: "0 28px 70px rgba(38, 38, 38, 0.12)",
            display: "flex",
            flexDirection: "column",
            padding: "26px",
            position: "relative",
            transform: "rotate(2deg)",
            width: "390px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              borderBottom: "1px solid #ededed",
              display: "flex",
              justifyContent: "space-between",
              paddingBottom: "18px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 13, color: "#8a8a8a" }}>WEEK 8</span>
              <span style={{ fontSize: 22, fontWeight: 700, marginTop: "5px" }}>
                Make your picks
              </span>
            </div>
            <span
              style={{
                background: "#fff0e9",
                borderRadius: "999px",
                color: "#c44512",
                display: "flex",
                fontSize: 13,
                fontWeight: 700,
                padding: "8px 11px",
              }}
            >
              36 PTS
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              paddingTop: "18px",
            }}
          >
            {teams.map((team, index) => (
              <div
                key={team.abbreviation}
                style={{
                  alignItems: "center",
                  background: index === 0 ? "#fff7f3" : "#f9f9f9",
                  border:
                    index === 0 ? "1px solid #fa5d19" : "1px solid #ededed",
                  borderRadius: "12px",
                  display: "flex",
                  height: "64px",
                  padding: "0 16px",
                }}
              >
                <span
                  style={{
                    alignItems: "center",
                    background: index === 0 ? "#fa5d19" : "#e9e9e9",
                    borderRadius: "9px",
                    color: index === 0 ? "#ffffff" : "#555555",
                    display: "flex",
                    fontSize: 14,
                    fontWeight: 700,
                    height: "36px",
                    justifyContent: "center",
                    width: "48px",
                  }}
                >
                  {team.abbreviation}
                </span>
                <span style={{ fontSize: 18, fontWeight: 700, marginLeft: "14px" }}>
                  {index === 0 ? "Your pick" : "Available"}
                </span>
                <span
                  style={{
                    color: index === 0 ? "#c44512" : "#6a6a6a",
                    fontSize: 20,
                    fontWeight: 700,
                    marginLeft: "auto",
                  }}
                >
                  {team.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function BracketMark() {
  return (
    <div
      style={{
        display: "flex",
        height: "42px",
        position: "relative",
        width: "42px",
      }}
    >
      <div
        style={{
          borderBottom: "4px solid #fa5d19",
          borderLeft: "4px solid #fa5d19",
          borderTop: "4px solid #fa5d19",
          display: "flex",
          height: "34px",
          left: "2px",
          position: "absolute",
          top: "4px",
          width: "15px",
        }}
      />
      <div
        style={{
          background: "#fa5d19",
          display: "flex",
          height: "4px",
          left: "17px",
          position: "absolute",
          top: "19px",
          width: "23px",
        }}
      />
    </div>
  );
}
