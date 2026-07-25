import type { Metadata } from "next";

export type InviteSharePreview = {
  poolName: string;
  poolType: "survivor" | "confidence";
  startWeek: number;
};

/** iMessage truncates og:title around 44 characters — keep the pool name first. */
const OG_TITLE_MAX = 44;

export function poolTypeLabel(
  poolType: InviteSharePreview["poolType"],
): "Survivor" | "Confidence" {
  return poolType === "survivor" ? "Survivor" : "Confidence";
}

export function inviteShareOpenGraphTitle(
  preview: InviteSharePreview | null,
): string {
  if (!preview) return "Join a pool";
  const name = preview.poolName.trim() || "a pool";
  const title = `Join ${name}`;
  if (title.length <= OG_TITLE_MAX) return title;
  return `${title.slice(0, OG_TITLE_MAX - 1)}…`;
}

export function inviteShareDescription(
  preview: InviteSharePreview | null,
): string {
  if (!preview) {
    return "You've been invited to a private NFL pool on Only Pools. Sign in to review and accept — opening this link alone does not enroll you.";
  }
  const type = poolTypeLabel(preview.poolType);
  return `Join ${preview.poolName} — a private NFL ${type} pool starting week ${preview.startWeek}. Sign in to accept; opening this link alone does not enroll you.`;
}

export function inviteShareDocumentTitle(
  preview: InviteSharePreview | null,
): string {
  if (!preview) return "Join a pool";
  const name = preview.poolName.trim() || "a pool";
  return `Join ${name} · Only Pools`;
}

export function inviteShareMetadata(
  token: string,
  preview: InviteSharePreview | null,
): Metadata {
  const title = inviteShareOpenGraphTitle(preview);
  const description = inviteShareDescription(preview);
  const path = `/join/${token}`;

  return {
    title: inviteShareDocumentTitle(preview),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: path,
      siteName: "Only Pools",
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
