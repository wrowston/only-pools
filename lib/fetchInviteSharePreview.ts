import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { InviteSharePreview } from "@/lib/inviteShareMetadata";

/** Server-only Convex read for invite Open Graph / metadata generation. */
export async function fetchInviteSharePreview(
  token: string,
): Promise<InviteSharePreview | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl || !token) return null;

  try {
    const client = new ConvexHttpClient(convexUrl);
    return await client.query(api.invites.sharePreview, { token });
  } catch {
    return null;
  }
}
