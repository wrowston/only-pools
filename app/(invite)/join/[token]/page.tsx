import type { Metadata } from "next";
import { JoinInviteView } from "@/components/JoinInviteView";
import { fetchInviteSharePreview } from "@/lib/fetchInviteSharePreview";
import { inviteShareMetadata } from "@/lib/inviteShareMetadata";

type JoinWithTokenPageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({
  params,
}: JoinWithTokenPageProps): Promise<Metadata> {
  const { token } = await params;
  const preview = await fetchInviteSharePreview(token);
  return inviteShareMetadata(token, preview);
}

export default async function JoinWithTokenPage({
  params,
}: JoinWithTokenPageProps) {
  const { token } = await params;
  return <JoinInviteView token={token} />;
}
