import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalDocument,
  LegalList,
  LegalSection,
} from "@/components/legal/LegalDocument";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Basic terms for using Only Pools — private NFL Survivor and Confidence pools.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      description="These are the basic rules for using Only Pools. They are written in plain language and are not a substitute for formal legal advice."
      updatedLabel="Last updated: August 4, 2026"
    >
      <LegalSection title="The service">
        <p>
          Only Pools provides private NFL Survivor and Confidence prediction
          competitions for groups. There are no buy-ins, prizes, or wagering —
          the product is prediction competition only.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          Signup and each new sign-in require a verified email address and
          verified phone number. You are responsible for the accuracy of your
          account information and for activity under your account. Do not share
          invite links or account credentials in ways that let others impersonate
          you.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            "harass other participants or abuse Pool administration tools;",
            "attempt to bypass Pick Locks, scoring, verification, or access controls;",
            "scrape, overload, or disrupt the service;",
            "use Only Pools for gambling, paid entry, or prize pools;",
            "post illegal content or content you do not have rights to share.",
          ]}
        />
        <p>
          We may suspend accounts after human review of abuse or security
          concerns, as described in product guides.
        </p>
      </LegalSection>

      <LegalSection title="Pools and content">
        <p>
          Pool Owners and Admins manage membership and administration within the
          product rules. Competitive history (display names, accepted picks,
          results, and standings) may remain visible to current Pool
          participants after someone leaves. Contact fields are handled under
          the{" "}
          <Link
            href="/privacy"
            className="font-medium text-op-selected-fg underline underline-offset-4"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Availability">
        <p>
          We aim to keep the service available during the NFL regular season,
          but we do not guarantee uninterrupted access. Features, schedules, and
          provider data may change.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimer">
        <p>
          Only Pools is provided “as is.” To the fullest extent allowed by law,
          we disclaim warranties of merchantability, fitness for a particular
          purpose, and non-infringement. We are not responsible for disputes
          between participants in a private Pool.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. Continued use after an update means you
          accept the revised terms. Material changes will be reflected by the
          “Last updated” date on this page.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          For questions about these terms, use{" "}
          <Link
            href="/help"
            className="font-medium text-op-selected-fg underline underline-offset-4"
          >
            Help &amp; feedback
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
