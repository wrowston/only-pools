import { MyPoolsClient } from "@/components/MyPoolsClient";

/**
 * Server page reads `archived` so the client tree never suspends on the
 * search-params client hook (which painted a blank soft-nav fallback).
 */
export default async function MyPoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string | string[] }>;
}) {
  const params = await searchParams;
  const archived = params.archived;
  const includeArchived =
    archived === "1" ||
    (Array.isArray(archived) && archived.includes("1"));

  return <MyPoolsClient includeArchived={includeArchived} />;
}
