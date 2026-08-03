import type { MetadataRoute } from "next";
import { guides } from "@/lib/guides";
import { siteUrl } from "@/lib/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteUrl();
  return [
    {
      url: baseUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/guides`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/help`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    ...guides.map((guide) => ({
      url: `${baseUrl}/guides/${guide.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
