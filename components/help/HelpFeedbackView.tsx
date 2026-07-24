"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  HELP_RESPONSE_EXPECTATION,
  SUPPORT_CATEGORIES,
} from "@/lib/help";
import type { Guide } from "@/lib/guides";

const textareaClassName =
  "flex min-h-24 w-full rounded-lg border border-op-border bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

const selectClassName =
  "h-8 w-full rounded-lg border border-op-border bg-transparent px-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

export type HelpLane = "support" | "feedback";

export type SupportAcceptance = {
  reference: string;
  category: string;
  acceptedAtMs: number;
};

export type HelpFieldErrors = Record<string, string>;

export type HelpFeedbackViewProps = {
  source: string | null;
  suggestedGuides: readonly Guide[];
  signedInEmail: string | null;
  activeLane: HelpLane;
  onLaneChange: (lane: HelpLane) => void;
  onGuideSelect?: (slug: string) => void;
  category: string;
  replyEmail: string;
  message: string;
  honeypot: string;
  onCategoryChange: (value: string) => void;
  onReplyEmailChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onHoneypotChange: (value: string) => void;
  fieldErrors: HelpFieldErrors;
  formError: string | null;
  feedbackNotice: string | null;
  submitting: boolean;
  onSupportSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onFeedbackSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  acceptance: SupportAcceptance | null;
};

export function HelpFeedbackView({
  source,
  suggestedGuides,
  signedInEmail,
  activeLane,
  onLaneChange,
  onGuideSelect,
  category,
  replyEmail,
  message,
  honeypot,
  onCategoryChange,
  onReplyEmailChange,
  onMessageChange,
  onHoneypotChange,
  fieldErrors,
  formError,
  feedbackNotice,
  submitting,
  onSupportSubmit,
  onFeedbackSubmit,
  acceptance,
}: HelpFeedbackViewProps) {
  const receiptHeadingRef = useRef<HTMLHeadingElement>(null);
  const categoryId = useId();
  const replyEmailId = useId();
  const messageId = useId();
  const categoryErrorId = useId();
  const replyEmailErrorId = useId();
  const messageErrorId = useId();

  useEffect(() => {
    if (acceptance) {
      receiptHeadingRef.current?.focus();
    }
  }, [acceptance]);

  if (acceptance) {
    return (
      <div className="px-5 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto max-w-3xl">
          <p className="op-eyebrow text-op-heat">Help & feedback</p>
          <h1
            ref={receiptHeadingRef}
            tabIndex={-1}
            className="mt-3 text-3xl font-medium tracking-tight text-op-text sm:text-4xl"
          >
            Support request received
          </h1>
          <p className="mt-4 text-[15px] leading-7 text-op-secondary">
            We received your message and will reply to the email you provided.
          </p>
          <dl className="mt-8 space-y-4 rounded-[14px] border border-op-border bg-op-surface p-5">
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.08em] text-op-muted">
                Reference
              </dt>
              <dd className="mt-1 font-mono text-sm text-op-text">
                {acceptance.reference}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.08em] text-op-muted">
                Category
              </dt>
              <dd className="mt-1 text-sm text-op-text">{acceptance.category}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.08em] text-op-muted">
                Response time
              </dt>
              <dd className="mt-1 text-sm text-op-text">
                {HELP_RESPONSE_EXPECTATION}
              </dd>
            </div>
          </dl>
          <p className="mt-6 text-sm leading-6 text-op-secondary">
            Keep your reference handy if you follow up. Support does not pause
            or reopen Pick Locks, guarantee a pre-kickoff response, or mediate
            ordinary private Pool disputes.
          </p>
          <Link
            href="/guides"
            className="op-btn op-btn-secondary mt-8 inline-flex h-8 items-center px-3 text-[13px]"
          >
            Browse guides
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <p className="op-eyebrow text-op-heat">Help & feedback</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-op-text sm:text-4xl">
          How can we help?
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-op-secondary">
          Choose a lane below. Guides may answer your question without waiting
          for a reply.
        </p>

        {suggestedGuides.length > 0 ? (
          <section aria-labelledby="suggested-guides-heading" className="mt-8">
            <h2
              id="suggested-guides-heading"
              className="text-sm font-medium text-op-text"
            >
              Suggested guides
              {source ? (
                <span className="sr-only">{` for ${source}`}</span>
              ) : null}
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {suggestedGuides.map((guide) => (
                <li key={guide.slug}>
                  <Link
                    href={`/guides/${guide.slug}`}
                    onClick={() => onGuideSelect?.(guide.slug)}
                    className="block rounded-[10px] border border-op-border bg-op-surface px-4 py-3 text-sm font-medium text-op-text transition-colors hover:border-op-heat-20 hover:bg-op-heat-4"
                  >
                    {guide.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div
          className="mt-10 flex flex-wrap gap-2"
          role="group"
          aria-label="Contact lane"
        >
          <button
            type="button"
            className={`op-btn h-8 px-3 text-[13px] ${
              activeLane === "support"
                ? "op-btn-secondary"
                : "op-btn-ghost"
            }`}
            aria-pressed={activeLane === "support"}
            onClick={() => onLaneChange("support")}
          >
            Get support
          </button>
          <button
            type="button"
            className={`op-btn h-8 px-3 text-[13px] ${
              activeLane === "feedback"
                ? "op-btn-secondary"
                : "op-btn-ghost"
            }`}
            aria-pressed={activeLane === "feedback"}
            onClick={() => onLaneChange("feedback")}
          >
            Share feedback
          </button>
        </div>

        {activeLane === "support" ? (
          <section aria-labelledby="support-form-heading" className="mt-8">
            <h2
              id="support-form-heading"
              className="text-lg font-medium text-op-text"
            >
              Get support
            </h2>
            <p className="mt-2 text-sm leading-6 text-op-secondary">
              {HELP_RESPONSE_EXPECTATION} Support does not pause or reopen Pick
              Locks, guarantee a pre-kickoff response, or mediate ordinary
              private Pool disputes.
            </p>
            <p className="mt-3 text-sm leading-6 text-op-secondary">
              For Pool conduct or safety concerns, see the{" "}
              <Link
                href="/guides/archive-audit-and-reports#abuse-report"
                className="font-medium text-op-selected-fg underline"
              >
                Abuse Report
              </Link>{" "}
              section in our guides, or use the in-app Abuse Report form in your
              Pool panel.
            </p>

            <form
              className="mt-6 flex flex-col gap-4"
              onSubmit={onSupportSubmit}
              noValidate
            >
              <div className="absolute -left-[9999px]" aria-hidden>
                <label htmlFor="company_website">Company website</label>
                <input
                  id="company_website"
                  name="company_website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(event) => onHoneypotChange(event.target.value)}
                />
              </div>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-op-text">
                  Category <span className="text-op-muted">(required)</span>
                </span>
                <select
                  id={categoryId}
                  name="category"
                  required
                  value={category}
                  onChange={(event) => onCategoryChange(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.category)}
                  aria-describedby={
                    fieldErrors.category ? categoryErrorId : undefined
                  }
                  className={selectClassName}
                >
                  <option value="">Select a category</option>
                  {SUPPORT_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                {fieldErrors.category ? (
                  <span
                    id={categoryErrorId}
                    className="text-xs text-destructive"
                  >
                    {fieldErrors.category}
                  </span>
                ) : null}
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-op-text">
                  Reply email <span className="text-op-muted">(required)</span>
                </span>
                <Input
                  id={replyEmailId}
                  name="replyEmail"
                  type="email"
                  required
                  autoComplete="email"
                  value={replyEmail}
                  onChange={(event) => onReplyEmailChange(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.replyEmail)}
                  aria-describedby={
                    fieldErrors.replyEmail ? replyEmailErrorId : undefined
                  }
                  placeholder={
                    signedInEmail ? undefined : "you@example.com"
                  }
                />
                {fieldErrors.replyEmail ? (
                  <span
                    id={replyEmailErrorId}
                    className="text-xs text-destructive"
                  >
                    {fieldErrors.replyEmail}
                  </span>
                ) : null}
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-op-text">
                  Message <span className="text-op-muted">(required)</span>
                </span>
                <textarea
                  id={messageId}
                  name="message"
                  required
                  rows={5}
                  value={message}
                  onChange={(event) => onMessageChange(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.message)}
                  aria-describedby={
                    fieldErrors.message ? messageErrorId : undefined
                  }
                  className={textareaClassName}
                  placeholder="Describe what happened and what you tried."
                />
                {fieldErrors.message ? (
                  <span
                    id={messageErrorId}
                    className="text-xs text-destructive"
                  >
                    {fieldErrors.message}
                  </span>
                ) : null}
              </label>

              {formError ? (
                <p className="text-sm text-destructive" role="alert">
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="op-btn op-btn-secondary h-8 self-start px-4 text-[13px]"
              >
                {submitting ? "Sending…" : "Send support request"}
              </button>
            </form>
          </section>
        ) : (
          <section aria-labelledby="feedback-form-heading" className="mt-8">
            <h2
              id="feedback-form-heading"
              className="text-lg font-medium text-op-text"
            >
              Share feedback
            </h2>
            <p className="mt-2 text-sm leading-6 text-op-secondary">
              Feedback intake is next — use Get support for product help now.
            </p>

            <form
              className="mt-6 flex flex-col gap-4 opacity-70"
              onSubmit={onFeedbackSubmit}
            >
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-op-text">Topic</span>
                <Input disabled placeholder="Coming soon" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-op-text">Your feedback</span>
                <textarea
                  disabled
                  rows={4}
                  className={textareaClassName}
                  placeholder="Product feedback form opens next."
                />
              </label>
              {feedbackNotice ? (
                <p className="text-sm text-op-secondary" role="status">
                  {feedbackNotice}
                </p>
              ) : null}
              <button
                type="submit"
                disabled
                className="op-btn op-btn-ghost h-8 self-start px-4 text-[13px]"
              >
                Submit feedback
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
