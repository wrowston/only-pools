import type { Metadata } from "next";
import { JoinInviteClient } from "@/components/JoinInviteView";
import { JoinInviteGuest } from "@/components/JoinInviteGuest";
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
  const preview = await fetchInviteSharePreview(token);

  return (
    <JoinInviteClient token={token}>
      <JoinInviteGuest token={token} preview={preview} />
    </JoinInviteClient>
  );
}
