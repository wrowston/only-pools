export function convexSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!cloud) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return cloud.replace(/\.convex\.cloud/, ".convex.site").replace(/\/$/, "");
}
