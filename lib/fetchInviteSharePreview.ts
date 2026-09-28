import { cache } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { InviteSharePreview } from "@/lib/inviteShareMetadata";
import { promiseWithTimeout } from "@/lib/promiseWithTimeout";

/** Cap Convex round-trip so invite HTML TTFB cannot stall on a hung provider. */
const SHARE_PREVIEW_TIMEOUT_MS = 400;

/**
 * Server-only Convex read for invite Open Graph / metadata generation.
 * Cached per-request so `generateMetadata` and the page share one round-trip.
 */
export const fetchInviteSharePreview = cache(
  async (token: string): Promise<InviteSharePreview | null> => {
    // Repeatable page-load bench: skip remote I/O so TTFB reflects HTML serve.
    if (process.env.PAGE_LOAD_BENCH === "1") return null;

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl || !token) return null;

    try {
      const client = new ConvexHttpClient(convexUrl);
      return await promiseWithTimeout(
        client.query(api.invites.sharePreview, { token }),
        SHARE_PREVIEW_TIMEOUT_MS,
      );
    } catch {
      return null;
    }
  },
);
