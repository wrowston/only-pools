"use client";

import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { clerkPhoneFirstInitialValues } from "@/lib/clerkPhoneFirst";

export function JoinInviteSignInActions({
  token,
  unavailable = false,
}: {
  token: string;
  unavailable?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <SignInButton
        mode="modal"
        forceRedirectUrl={`/join/${token}`}
        initialValues={clerkPhoneFirstInitialValues}
      >
        <button type="button" className="op-btn op-btn-primary">
          {unavailable ? "Sign in" : "Sign in to continue"}
        </button>
      </SignInButton>
      <Link
        href="/guides/invites-and-joining"
        className="op-btn op-btn-ghost"
      >
        {unavailable ? "Troubleshoot invites" : "Joining guide"}
      </Link>
    </div>
  );
}
