import { ImageResponse } from "next/og";
import { fetchInviteSharePreview } from "@/lib/fetchInviteSharePreview";
import {
  inviteShareOpenGraphTitle,
  poolTypeLabel,
} from "@/lib/inviteShareMetadata";

export const alt = "Join a private NFL pool on Only Pools";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type InviteOgImageProps = {
  params: Promise<{ token: string }>;
};

export default async function InviteOpenGraphImage({
  params,
}: InviteOgImageProps) {
  const { token } = await params;
  const preview = await fetchInviteSharePreview(token);
  const title = preview?.poolName.trim() || "a private NFL pool";
  const eyebrow = preview
    ? `${poolTypeLabel(preview.poolType)} · Start week ${preview.startWeek}`
    : "Survivor · Confidence";
  const subtitle = preview
    ? "Sign in to accept this invite. Opening the link alone does not enroll you."
    : "You've been invited. Sign in to review the pool and accept.";

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
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
            width: "680px",
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
              {"You're invited"}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: title.length > 28 ? 52 : 64,
                fontWeight: 700,
                letterSpacing: "-3px",
                lineHeight: 1.05,
              }}
            >
              <span>Join</span>
              <span>{title}</span>
            </div>
            <div
              style={{
                color: "#6a6a6a",
                display: "flex",
                fontSize: 23,
                lineHeight: 1.4,
                marginTop: "24px",
                maxWidth: "620px",
              }}
            >
              {subtitle}
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
            justifyContent: "space-between",
            padding: "28px",
            position: "relative",
            transform: "rotate(2deg)",
            width: "360px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ color: "#8a8a8a", fontSize: 13, fontWeight: 600 }}>
              POOL INVITE
            </span>
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: "-1px",
                lineHeight: 1.15,
              }}
            >
              {inviteShareOpenGraphTitle(preview)}
            </span>
            <span style={{ color: "#6a6a6a", fontSize: 18, marginTop: "6px" }}>
              {eyebrow}
            </span>
          </div>

          <div
            style={{
              alignItems: "center",
              background: "#fff0e9",
              borderRadius: "14px",
              color: "#c44512",
              display: "flex",
              fontSize: 16,
              fontWeight: 700,
              justifyContent: "center",
              padding: "14px 16px",
            }}
          >
            Accept after sign-in
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
