import type { InviteSharePreview } from "@/lib/inviteShareMetadata";
import { poolTypeLabel } from "@/lib/inviteShareMetadata";
import { EmptyState } from "./EmptyState";
import { JoinInviteSignInActions } from "./JoinInviteSignInActions";

/**
 * Server-rendered guest invite chrome. The H1 is in the initial HTML so LCP
 * does not wait on Clerk / Convex client hydration.
 */
export function JoinInviteGuest({
  token,
  preview,
}: {
  token: string;
  preview: InviteSharePreview | null;
}) {
  if (preview === null) {
    return (
      <EmptyState
        title="Invite unavailable"
        description="This invite link is invalid, expired, or no longer active."
        action={<JoinInviteSignInActions token={token} unavailable />}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-op-text">
        Join {preview.poolName}
      </h1>
      <p className="text-sm text-op-secondary">
        {poolTypeLabel(preview.poolType)} · Start Week {preview.startWeek}
      </p>
      <p className="text-sm text-op-secondary">
        Sign in with a verified email and phone to accept this Pool Invite.
        Opening the link alone does not enroll you.
      </p>
      <JoinInviteSignInActions token={token} />
    </div>
  );
}
