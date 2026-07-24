"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  FEEDBACK_SENTIMENT_LABELS,
  FEEDBACK_SENTIMENTS,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  HELP_RESPONSE_EXPECTATION,
  SUPPORT_CATEGORIES,
  type FeedbackSentiment,
  type FeedbackType,
} from "@/lib/helpConstants";
import type { Guide } from "@/lib/guides";
import type { HelpContextDisclosure } from "@/lib/helpDiagnostics";
import { HELP_RETENTION_DAYS } from "@/lib/helpConstants";
import { HelpContextDisclosurePanel } from "@/components/help/HelpContextDisclosure";

const textareaClassName =
  "flex min-h-24 w-full rounded-lg border border-op-border bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

const selectClassName =
  "h-8 w-full rounded-lg border border-op-border bg-transparent px-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

export type HelpLane = "support" | "feedback";

export type SupportAcceptance = {
  kind: "support";
  reference: string;
  category: string;
  acceptedAtMs: number;
};

export type FeedbackAcceptance = {
  kind: "feedback";
  reference: string;
  feedbackType: FeedbackType;
  sentiment: FeedbackSentiment;
  contactable: boolean;
  acceptedAtMs: number;
};

export type HelpAcceptance = SupportAcceptance | FeedbackAcceptance;

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
  feedbackSentiment: FeedbackSentiment | "";
  feedbackType: FeedbackType | "";
  feedbackMessage: string;
  feedbackReplyEmail: string;
  feedbackAnonymous: boolean;
  onFeedbackSentimentChange: (value: FeedbackSentiment) => void;
  onFeedbackTypeChange: (value: FeedbackType) => void;
  onFeedbackMessageChange: (value: string) => void;
  onFeedbackReplyEmailChange: (value: string) => void;
  onFeedbackAnonymousChange: (value: boolean) => void;
  includeDiagnostics: boolean;
  onIncludeDiagnosticsChange: (value: boolean) => void;
  contextDisclosure: HelpContextDisclosure;
  fieldErrors: HelpFieldErrors;
  formError: string | null;
  submitting: boolean;
  onSupportSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onFeedbackSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  acceptance: HelpAcceptance | null;
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
  feedbackSentiment,
  feedbackType,
  feedbackMessage,
  feedbackReplyEmail,
  feedbackAnonymous,
  onFeedbackSentimentChange,
  onFeedbackTypeChange,
  onFeedbackMessageChange,
  onFeedbackReplyEmailChange,
  onFeedbackAnonymousChange,
  includeDiagnostics,
  onIncludeDiagnosticsChange,
  contextDisclosure,
  fieldErrors,
  formError,
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
  const sentimentGroupId = useId();
  const sentimentErrorId = useId();
  const feedbackTypeId = useId();
  const feedbackTypeErrorId = useId();
  const feedbackMessageId = useId();
  const feedbackMessageErrorId = useId();
  const feedbackReplyEmailId = useId();
  const feedbackReplyEmailErrorId = useId();
  const anonymousId = useId();

  useEffect(() => {
    if (acceptance) {
      receiptHeadingRef.current?.focus();
    }
  }, [acceptance]);

  if (acceptance?.kind === "support") {
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

  if (acceptance?.kind === "feedback") {
    return (
      <div className="px-5 py-10 sm:px-8 sm:py-14">
        <div className="mx-auto max-w-3xl">
          <p className="op-eyebrow text-op-heat">Help & feedback</p>
          <h1
            ref={receiptHeadingRef}
            tabIndex={-1}
            className="mt-3 text-3xl font-medium tracking-tight text-op-text sm:text-4xl"
          >
            Feedback received
          </h1>
          {acceptance.contactable ? (
            <p className="mt-4 text-[15px] leading-7 text-op-secondary">
              Thanks for sharing. We read feedback privately. Providing an email
              does not guarantee a personal reply.
            </p>
          ) : (
            <p className="mt-4 text-[15px] leading-7 text-op-secondary">
              Thanks for sharing. Your feedback was recorded anonymously and we
              read all feedback privately.
            </p>
          )}
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
                Type
              </dt>
              <dd className="mt-1 text-sm text-op-text">
                {FEEDBACK_TYPE_LABELS[acceptance.feedbackType]}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-[0.08em] text-op-muted">
                Sentiment
              </dt>
              <dd className="mt-1 text-sm text-op-text">
                {FEEDBACK_SENTIMENT_LABELS[acceptance.sentiment]}
              </dd>
            </div>
          </dl>
          <p className="mt-6 text-sm leading-6 text-op-secondary">
            Feedback is private by default. We do not publish it as a
            testimonial or share roadmap status.
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
          for a reply. Submissions are stored temporarily (up to{" "}
          {HELP_RETENTION_DAYS} days) and delivered to our support mailbox.
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

              <HelpContextDisclosurePanel
                disclosure={contextDisclosure}
                includeDiagnostics={includeDiagnostics}
                onIncludeDiagnosticsChange={onIncludeDiagnosticsChange}
                lane="support"
              />

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
              Feedback is private by default. We do not publish it as a
              testimonial or share roadmap status.
            </p>

            <form
              className="mt-6 flex flex-col gap-4"
              onSubmit={onFeedbackSubmit}
              noValidate
            >
              <div className="absolute -left-[9999px]" aria-hidden>
                <label htmlFor="feedback_company_website">Company website</label>
                <input
                  id="feedback_company_website"
                  name="company_website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(event) => onHoneypotChange(event.target.value)}
                />
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-op-text">
                  How do you feel?{" "}
                  <span className="text-op-muted">(required)</span>
                </legend>
                <div
                  id={sentimentGroupId}
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-invalid={Boolean(fieldErrors.sentiment)}
                  aria-describedby={
                    fieldErrors.sentiment ? sentimentErrorId : undefined
                  }
                >
                  {FEEDBACK_SENTIMENTS.map((value) => (
                    <label
                      key={value}
                      className={`op-btn h-8 cursor-pointer px-3 text-[13px] ${
                        feedbackSentiment === value
                          ? "op-btn-secondary"
                          : "op-btn-ghost"
                      }`}
                    >
                      <input
                        type="radio"
                        name="sentiment"
                        value={value}
                        checked={feedbackSentiment === value}
                        onChange={() => onFeedbackSentimentChange(value)}
                        className="sr-only"
                      />
                      {FEEDBACK_SENTIMENT_LABELS[value]}
                    </label>
                  ))}
                </div>
                {fieldErrors.sentiment ? (
                  <span
                    id={sentimentErrorId}
                    className="text-xs text-destructive"
                  >
                    {fieldErrors.sentiment}
                  </span>
                ) : null}
              </fieldset>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-op-text">
                  Type <span className="text-op-muted">(required)</span>
                </span>
                <select
                  id={feedbackTypeId}
                  name="feedbackType"
                  required
                  value={feedbackType}
                  onChange={(event) =>
                    onFeedbackTypeChange(event.target.value as FeedbackType)
                  }
                  aria-invalid={Boolean(fieldErrors.feedbackType)}
                  aria-describedby={
                    fieldErrors.feedbackType ? feedbackTypeErrorId : undefined
                  }
                  className={selectClassName}
                >
                  <option value="">Select a type</option>
                  {FEEDBACK_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {FEEDBACK_TYPE_LABELS[value]}
                    </option>
                  ))}
                </select>
                {fieldErrors.feedbackType ? (
                  <span
                    id={feedbackTypeErrorId}
                    className="text-xs text-destructive"
                  >
                    {fieldErrors.feedbackType}
                  </span>
                ) : null}
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-op-text">
                  Details <span className="text-op-muted">(optional)</span>
                </span>
                <textarea
                  id={feedbackMessageId}
                  name="feedbackMessage"
                  rows={4}
                  value={feedbackMessage}
                  onChange={(event) =>
                    onFeedbackMessageChange(event.target.value)
                  }
                  aria-invalid={Boolean(fieldErrors.message)}
                  aria-describedby={
                    fieldErrors.message ? feedbackMessageErrorId : undefined
                  }
                  className={textareaClassName}
                  placeholder="Add context if helpful."
                />
                {fieldErrors.message ? (
                  <span
                    id={feedbackMessageErrorId}
                    className="text-xs text-destructive"
                  >
                    {fieldErrors.message}
                  </span>
                ) : null}
              </label>

              {!feedbackAnonymous ? (
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium text-op-text">
                    Follow-up email{" "}
                    <span className="text-op-muted">(optional)</span>
                  </span>
                  <Input
                    id={feedbackReplyEmailId}
                    name="feedbackReplyEmail"
                    type="email"
                    autoComplete="email"
                    value={feedbackReplyEmail}
                    onChange={(event) =>
                      onFeedbackReplyEmailChange(event.target.value)
                    }
                    aria-invalid={Boolean(fieldErrors.replyEmail)}
                    aria-describedby={
                      fieldErrors.replyEmail
                        ? feedbackReplyEmailErrorId
                        : undefined
                    }
                    placeholder={
                      signedInEmail ? undefined : "you@example.com"
                    }
                  />
                  <span className="text-xs text-op-muted">
                    Optional. Does not guarantee a personal reply.
                  </span>
                  {fieldErrors.replyEmail ? (
                    <span
                      id={feedbackReplyEmailErrorId}
                      className="text-xs text-destructive"
                    >
                      {fieldErrors.replyEmail}
                    </span>
                  ) : null}
                </label>
              ) : null}

              {signedInEmail ? (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    id={anonymousId}
                    name="anonymous"
                    type="checkbox"
                    checked={feedbackAnonymous}
                    onChange={(event) =>
                      onFeedbackAnonymousChange(event.target.checked)
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-op-text">
                      Submit anonymously
                    </span>
                    <span className="mt-0.5 block text-xs text-op-muted">
                      We will not store your account, email, or Pool linkage.
                    </span>
                  </span>
                </label>
              ) : null}

              <HelpContextDisclosurePanel
                disclosure={contextDisclosure}
                includeDiagnostics={includeDiagnostics}
                onIncludeDiagnosticsChange={onIncludeDiagnosticsChange}
                lane="feedback"
              />

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
                {submitting ? "Sending…" : "Submit feedback"}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
