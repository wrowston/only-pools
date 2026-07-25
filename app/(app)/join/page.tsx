import type { Metadata } from "next";
import { JoinInviteView } from "@/components/JoinInviteView";

export const metadata: Metadata = {
  title: "Join a pool · Only Pools",
  description:
    "Open a Pool Invite link from a Pool Owner or Pool Admin to join. Opening a link alone does not enroll you.",
  openGraph: {
    title: "Join a pool",
    description:
      "Open a Pool Invite link from a Pool Owner or Pool Admin to join. Opening a link alone does not enroll you.",
    siteName: "Only Pools",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Join a pool",
    description:
      "Open a Pool Invite link from a Pool Owner or Pool Admin to join. Opening a link alone does not enroll you.",
  },
};

export default function JoinPage() {
  return <JoinInviteView token="" />;
}
