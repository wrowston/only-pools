import { SurvivorStandingsView } from "@/components/SurvivorStandingsView";
import type { Id } from "@/convex/_generated/dataModel";

export default async function PoolStandingsPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  return <SurvivorStandingsView poolId={poolId as Id<"pools">} />;
}
