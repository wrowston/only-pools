import { MyPoolsSkeleton } from "@/components/MyPoolsSkeleton";

/** Visible while the server page resolves search params on soft navigation. */
export default function MyPoolsLoading() {
  return <MyPoolsSkeleton />;
}
