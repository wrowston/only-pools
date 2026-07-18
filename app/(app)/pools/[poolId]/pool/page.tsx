import { PoolPanelView } from "@/components/PoolPanelView";
import type { Id } from "@/convex/_generated/dataModel";

export default async function PoolDetailsPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  return <PoolPanelView poolId={poolId as Id<"pools">} />;
}
