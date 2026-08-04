import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalDocument,
  LegalList,
  LegalSection,
} from "@/components/legal/LegalDocument";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Only Pools collects, how we use it, and who can see your contact details in a Pool.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      description="This explains what data Only Pools collects and how we use it. We keep this short and tied to how the product actually works."
      updatedLabel="Last updated: August 4, 2026"
    >
      <LegalSection title="Who we are">
        <p>
          Only Pools (“we”) runs private NFL Survivor and Confidence pools at
          tryonlypools.com. This policy covers the website and application.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <p>Depending on how you use the product, we may collect:</p>
        <LegalList
          items={[
            <>
              <strong className="font-medium text-op-text">
                Account identity
              </strong>{" "}
              — verified email, verified phone number, display name, avatar, and
              authentication identifiers from our sign-in provider (Clerk),
              including session information.
            </>,
            <>
              <strong className="font-medium text-op-text">
                Eligibility confirmation
              </strong>{" "}
              — your confirmation that you are 18 or older.
            </>,
            <>
              <strong className="font-medium text-op-text">
                Pool activity
              </strong>{" "}
              — Pool memberships and roles, invites you accept, picks, standings
              history, and related audit events needed to run competition
              fairly.
            </>,
            <>
              <strong className="font-medium text-op-text">
                Help &amp; feedback
              </strong>{" "}
              — messages you submit, optional reply email, and optional
              diagnostics you choose to include (for example page, browser
              summary, or app version). Anonymous feedback does not attach your
              account identifiers.
            </>,
            <>
              <strong className="font-medium text-op-text">
                Product usage
              </strong>{" "}
              — analytics events about how features are used (for example
              opening Help, saving a pick) via PostHog, usually linked to your
              Clerk user id when signed in.
            </>,
            <>
              <strong className="font-medium text-op-text">
                Reliability data
              </strong>{" "}
              — error and performance reports via Sentry to keep the service
              working.
            </>,
          ]}
        />
        <p>
          We do not sell personal information. We do not run ads against your
          Pool data.
        </p>
      </LegalSection>

      <LegalSection title="How we use data">
        <p>We use this information to:</p>
        <LegalList
          items={[
            "create and secure your Participant account;",
            "run Pools (membership, picks, locks, scoring, standings);",
            "let Pool Owners and Admins administer their Pools;",
            "respond to Help & feedback;",
            "understand product usage at a high level and fix bugs;",
            "detect abuse and protect the service.",
          ]}
        />
        <p>
          We do not use your picks or Pool membership for advertising, marketing
          lists, or resale.
        </p>
      </LegalSection>

      <LegalSection title="Who can see what in a Pool">
        <p>
          Your display name and avatar are visible to current participants in a
          Pool. Verified email and phone are visible to that Pool’s Owner and
          Admins for administration (including while the Pool is Completed or
          Archived). Ordinary Members cannot see another participant’s contact
          fields. Before you join via invite, you acknowledge this contact
          visibility. Leaving or removal ends that contact visibility for
          Owners/Admins, while competitive history may remain.
        </p>
        <p>
          More detail lives in{" "}
          <Link
            href="/guides/accounts-verification-and-privacy"
            className="font-medium text-op-selected-fg underline underline-offset-4"
          >
            Accounts, verification, and privacy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>We rely on processors that help us operate the product:</p>
        <LegalList
          items={[
            "Clerk — authentication, verification, and session management;",
            "Convex — application database and backend;",
            "PostHog — product analytics;",
            "Sentry — error monitoring;",
            "email delivery for Help & feedback when configured.",
          ]}
        />
        <p>
          NFL schedule and results data come from sports-data providers and are
          not your personal information.
        </p>
      </LegalSection>

      <LegalSection title="Retention">
        <p>
          Account and Pool competitive records are kept while needed to operate
          the product and preserve Pool history. Help & feedback submissions are
          stored temporarily (about 90 days) for support handling. If you delete
          your identity, personal contact and profile fields are removed or
          anonymized; accepted picks and standings may remain as a Former
          Participant placeholder so Pool history stays intact.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can update profile details through your account, leave a Pool when
          the product allows, submit Help & feedback without optional
          diagnostics, and request account deletion through the product flows
          or Help. Some competitive history may remain for Pool integrity after
          deletion.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          Only Pools is for adults 18+. We do not knowingly collect personal
          information from anyone under 18.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update this policy. The “Last updated” date at the top will
          change when we do. Continued use means you accept the updated policy.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Privacy questions go through{" "}
          <Link
            href="/help"
            className="font-medium text-op-selected-fg underline underline-offset-4"
          >
            Help &amp; feedback
          </Link>
          . Related product rules are also in our{" "}
          <Link
            href="/terms"
            className="font-medium text-op-selected-fg underline underline-offset-4"
          >
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
