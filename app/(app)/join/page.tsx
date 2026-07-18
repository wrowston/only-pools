import { JoinInviteView } from "@/components/JoinInviteView";

/**
 * Join entry without a token — directs people to open a real invite link.
 */
export default function JoinPage() {
  return <JoinInviteView token="" />;
}
