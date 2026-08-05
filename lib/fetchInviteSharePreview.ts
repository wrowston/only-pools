import { cache } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { InviteSharePreview } from "@/lib/inviteShareMetadata";

/** Cap Convex round-trip so invite HTML TTFB cannot stall on a hung provider. */
const SHARE_PREVIEW_TIMEOUT_MS = 400;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
      return await withTimeout(
        client.query(api.invites.sharePreview, { token }),
        SHARE_PREVIEW_TIMEOUT_MS,
      );
    } catch {
      return null;
    }
  },
);
