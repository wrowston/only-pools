import { WeekBoardView } from "@/components/WeekBoardView";
import type { Id } from "@/convex/_generated/dataModel";

export default async function PoolWeekBoardPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  return <WeekBoardView poolId={poolId as Id<"pools">} />;
}
