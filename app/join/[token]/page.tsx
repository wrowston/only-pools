import { JoinInviteView } from "@/components/JoinInviteView";

export default async function JoinWithTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <JoinInviteView token={token} />;
}
