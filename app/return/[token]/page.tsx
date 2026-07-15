import { JoinReturningInviteView } from "@/components/JoinReturningInviteView";

export default async function ReturnInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <JoinReturningInviteView token={token} />;
}
