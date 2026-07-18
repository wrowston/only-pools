import { PoolChromeProvider } from "@/components/PoolChrome";

export default async function PoolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  return <PoolChromeProvider poolId={poolId}>{children}</PoolChromeProvider>;
}
