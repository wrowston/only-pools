"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowUpRightIcon, LayersIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CreatePoolDialog } from "@/components/CreatePoolDialog";
import { EmptyState } from "@/components/EmptyState";
import { MyPoolsSkeleton } from "@/components/MyPoolsSkeleton";
import { eligibilityTone, type StatusChipTone } from "@/components/standings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { api } from "@/convex/_generated/api";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { HELP_FEEDBACK_LABEL } from "@/lib/helpNav";
import { useSyncParticipantAvatar } from "@/lib/useSyncParticipantAvatar";
import type { FunctionReturnType } from "convex/server";

type Membership = FunctionReturnType<
  typeof api.participants.myPools
>["memberships"][number];

function poolTypeLabel(type: Membership["type"]): string {
  return type === "survivor" ? "Survivor" : "Confidence";
}

function standingLabel(standing: Membership["standing"]): string {
  if (standing.kind === "survivor") {
    if (standing.eligibility === "eliminated") {
      return standing.eliminatedWeek != null
        ? `Eliminated W${standing.eliminatedWeek}`
        : "Eliminated";
    }
    if (standing.eligibility === "winner") return "Winner";
    return `Alive · ${standing.aliveCount}/${standing.memberCount}`;
  }
  if (standing.seasonRank != null) {
    return `#${standing.seasonRank} · ${standing.seasonPoints} pts`;
  }
  if (standing.seasonPoints > 0) {
    return `${standing.seasonPoints} pts`;
  }
  return "Unranked";
}

function standingChipTone(
  standing: Membership["standing"],
): StatusChipTone {
  if (standing.kind === "survivor") {
    return eligibilityTone(standing.eligibility);
  }
  return "neutral";
}

function actionChip(m: Membership): { tone: StatusChipTone; label: string } {
  if (m.archived || m.nextAction === "view_pool") {
    return { tone: "neutral", label: "Archived" };
  }
  if (m.nextAction === "view_standings") {
    return { tone: "neutral", label: "Standings" };
  }
  if (m.pickStatus === "needs_pick") {
    return { tone: "attention", label: "Needs pick" };
  }
  if (m.pickStatus === "pick_locked") {
    return { tone: "neutral", label: "Pick locked" };
  }
  if (m.pickStatus === "pick_saved") {
    return { tone: "alive", label: "Pick saved" };
  }
  return { tone: "neutral", label: "Open board" };
}

function MembershipRow({ m }: { m: Membership }) {
  const action = actionChip(m);
  return (
    <Item
      variant="default"
      size="sm"
      className="rounded-none border-0 px-4 py-3.5"
      render={<Link href={`/pools/${m.poolId}`} />}
    >
      <ItemContent className="gap-1.5">
        <ItemTitle className="text-op-text">{m.name}</ItemTitle>
        <ItemDescription className="text-xs text-op-muted">
          {poolTypeLabel(m.type)} · Week {m.boardWeek}
          {m.role === "owner" ? " · Owner" : ""}
          {m.archived ? " · Archived" : ""}
        </ItemDescription>
        <Badge variant={standingChipTone(m.standing)}>
          {standingLabel(m.standing)}
        </Badge>
      </ItemContent>
      <ItemActions>
        <Badge variant={action.tone}>{action.label}</Badge>
      </ItemActions>
    </Item>
  );
}

function VerificationIncomplete({ missing }: { missing: string[] }) {
  return (
    <EmptyState
      title="Could not open My Pools"
      description="Sign out and back in, then retry. If this keeps happening, the Clerk session is not establishing a Participant."
    >
      {missing.length > 0 ? (
        <p className="text-sm text-op-secondary">{missing.join(", ")}</p>
      ) : null}
    </EmptyState>
  );
}

function MyPoolsHome() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const searchParams = useSearchParams();
  const includeArchived = searchParams.get("archived") === "1";
  const ensureMyParticipant = useMutation(api.participants.ensureMyParticipant);
  const myPools = useQuery(
    api.participants.myPools,
    isAuthenticated ? { includeArchived } : "skip",
  );
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const [ensured, setEnsured] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  useSyncParticipantAvatar();

  useEffect(() => {
    if (!isAuthenticated || !userLoaded || ensured) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureMyParticipant({
          avatarUrl: user?.imageUrl,
        });
        if (!cancelled) {
          setEnsured(true);
          setEnsureError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setEnsureError(
            convexErrorMessage(e, "Could not establish Participant"),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isAuthenticated,
    userLoaded,
    user?.imageUrl,
    ensureMyParticipant,
    ensured,
  ]);

  if (isLoading || (isAuthenticated && myPools === undefined && !ensureError)) {
    return <MyPoolsSkeleton />;
  }

  if (!isAuthenticated) {
    return (
      <EmptyState
        title="Still connecting"
        description="You are signed in with Clerk, but Convex has not accepted the session yet. Sign out completely, sign back in, then open My Pools again (an old session token will keep failing)."
        action={
          <Button type="button" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        }
      />
    );
  }

  if (ensureError) {
    return (
      <EmptyState title="Could not open My Pools" description={ensureError} />
    );
  }

  if (!myPools) {
    return (
      <EmptyState
        title="My Pools unavailable"
        description="Your memberships could not be loaded. Refresh and try again."
        action={
          <Button type="button" onClick={() => window.location.reload()}>
            Refresh
          </Button>
        }
      />
    );
  }

  if (myPools.authError) {
    const missing: string[] = [];
    if (myPools.authError.includes("email")) missing.push("email");
    if (myPools.authError.includes("phone")) missing.push("phone");
    return (
      <VerificationIncomplete
        missing={missing.length > 0 ? missing : ["email", "phone"]}
      />
    );
  }

  const createJoinActions = (
    <>
      <Button
        type="button"
        disabled={!myPools.createPoolEnabled}
        onClick={() => setShowCreate(true)}
        title={
          myPools.createPoolEnabled
            ? "Create a Pool"
            : "Create Pool is disabled until an Available Season exists"
        }
      >
        Create Pool
      </Button>
      <Button variant="secondary" render={<Link href="/join" />}>
        Join a Pool
      </Button>
    </>
  );

  const createDialog = myPools.createPoolEnabled ? (
    <CreatePoolDialog
      open={showCreate}
      onClose={() => setShowCreate(false)}
    />
  ) : null;

  if (myPools.memberships.length === 0) {
    return (
      <div className="op-grid-bg-soft mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12">
        <Empty className="border border-dashed border-op-border bg-op-surface/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>No Pools yet</EmptyTitle>
            <EmptyDescription>
              {myPools.createPoolEnabled
                ? "Create a Pool for the Available Season, or join one with an invite link."
                : "You are not in any Pools yet. Create Pool stays disabled until Season Bootstrap finishes and an Available Season exists. You can still join with an invite link."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            {createJoinActions}
          </EmptyContent>
          {myPools.archivedCount > 0 ? (
            <p className="text-xs text-op-muted">
              {myPools.archivedCount} archived{" "}
              {myPools.archivedCount === 1 ? "Pool is" : "Pools are"} hidden.{" "}
              <Link
                href="/my-pools?archived=1"
                className="underline hover:text-op-text"
              >
                Show archived
              </Link>
            </p>
          ) : (
            <Link
              href="/guides/create-a-pool"
              className="inline-flex items-center gap-1 text-sm text-op-muted transition-colors hover:text-op-text"
            >
              Learn how to create a Pool
              <ArrowUpRightIcon className="size-3.5" aria-hidden />
            </Link>
          )}
        </Empty>
        {createDialog}
      </div>
    );
  }

  return (
    <div className="op-grid-bg-soft mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-medium tracking-tight text-op-text">
            My Pools
          </h1>
          <Link
            href="/help?source=account"
            className="op-btn op-btn-ghost h-8 px-2.5 text-[13px]"
          >
            {HELP_FEEDBACK_LABEL}
          </Link>
        </div>
        <p className="text-[15px] text-op-secondary">
          {includeArchived
            ? "Including archived Pools in this list."
            : "Standing, pick status, and next action for each membership."}
        </p>
        {includeArchived ? (
          <Link
            href="/my-pools"
            className="text-xs text-op-muted underline hover:text-op-text"
          >
            Hide archived
          </Link>
        ) : null}
      </header>

      <section aria-labelledby="memberships-heading" className="flex flex-col gap-3">
        <h2 id="memberships-heading" className="op-eyebrow">
          Memberships
        </h2>
        <ItemGroup className="op-panel gap-0 divide-y divide-op-border overflow-hidden p-0">
          {myPools.memberships.map((m) => (
            <MembershipRow key={m.poolId} m={m} />
          ))}
        </ItemGroup>
        {myPools.archivedCount > 0 ? (
          <p className="text-xs text-op-muted">
            {myPools.archivedCount} archived{" "}
            {myPools.archivedCount === 1 ? "Pool is" : "Pools are"} hidden from
            this list.{" "}
            <Link
              href="/my-pools?archived=1"
              className="underline hover:text-op-text"
            >
              Show archived
            </Link>
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="actions-heading"
        className="flex flex-wrap items-center gap-3"
      >
        <h2 id="actions-heading" className="sr-only">
          Create or join
        </h2>
        {createJoinActions}
        {!myPools.createPoolEnabled ? (
          <p className="basis-full text-xs text-op-muted">
            Create Pool stays disabled until Season Bootstrap finishes and an
            Available Season exists.
          </p>
        ) : null}
      </section>
      {createDialog}
    </div>
  );
}

export default function MyPoolsPage() {
  return (
    <Suspense fallback={<MyPoolsSkeleton />}>
      <MyPoolsGate />
    </Suspense>
  );
}

function MyPoolsGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoaded: userLoaded } = useUser();

  if (!isLoaded || !userLoaded) {
    return <MyPoolsSkeleton />;
  }

  if (!isSignedIn) {
    return (
      <EmptyState
        title="Sign in to open My Pools"
        description="Your Pool memberships live here after you sign in."
        action={
          <Button render={<Link href="/sign-in" />}>Sign in</Button>
        }
      />
    );
  }

  return <MyPoolsHome />;
}
