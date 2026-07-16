export function siteUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!configured) return "http://localhost:3000";
  const absoluteUrl = configured.startsWith("http")
    ? configured
    : `https://${configured}`;
  return absoluteUrl.replace(/\/+$/, "");
}
