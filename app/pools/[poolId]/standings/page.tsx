import { PoolStandingsView } from "@/components/PoolStandingsView";
import type { Id } from "@/convex/_generated/dataModel";

export default async function PoolStandingsPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  return <PoolStandingsView poolId={poolId as Id<"pools">} />;
}
