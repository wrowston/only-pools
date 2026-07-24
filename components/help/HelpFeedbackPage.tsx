"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import posthog from "posthog-js";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HelpFeedbackView,
  type FeedbackAcceptance,
  type HelpAcceptance,
  type HelpFieldErrors,
  type HelpLane,
  type SupportAcceptance,
} from "@/components/help/HelpFeedbackView";
import { api } from "@/convex/_generated/api";
import { convexSiteUrl } from "@/lib/convexSiteUrl";
import type { FeedbackSentiment, FeedbackType } from "@/lib/helpConstants";
import { suggestGuidesForHelpContext } from "@/lib/help";
import {
  buildHelpClientContextPayload,
  buildHelpContextDisclosure,
} from "@/lib/helpDiagnostics";

export function HelpFeedbackPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname() ?? "/help";
  const source = searchParams.get("source");
  const suggestedGuides = suggestGuidesForHelpContext(source);
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const helpIdentity = useQuery(
    api.participants.myHelpIdentity,
    isSignedIn ? {} : "skip",
  );

  const [activeLane, setActiveLane] = useState<HelpLane>("support");
  const [category, setCategory] = useState("");
  const clerkEmail = user?.primaryEmailAddress?.emailAddress ?? "";
  const [replyEmailOverride, setReplyEmailOverride] = useState<string | null>(
    null,
  );
  const replyEmail = replyEmailOverride ?? clerkEmail;
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [feedbackSentiment, setFeedbackSentiment] = useState<
    FeedbackSentiment | ""
  >("");
  const [feedbackType, setFeedbackType] = useState<FeedbackType | "">("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackReplyEmailOverride, setFeedbackReplyEmailOverride] = useState<
    string | null
  >(null);
  const feedbackReplyEmail = feedbackReplyEmailOverride ?? clerkEmail;
  const [feedbackAnonymous, setFeedbackAnonymous] = useState(false);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<HelpFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acceptance, setAcceptance] = useState<HelpAcceptance | null>(null);

  const supportIdempotencyKeyRef = useRef<string | null>(null);
  const feedbackIdempotencyKeyRef = useRef<string | null>(null);
  const openedRef = useRef(false);

  const signedInEmail =
    helpIdentity?.email ?? user?.primaryEmailAddress?.emailAddress ?? null;
  const signedInAccountId = helpIdentity?.participantId ?? null;

  const contextInput = useMemo(
    () => ({
      lane: activeLane,
      pathname,
      search: typeof window !== "undefined" ? window.location.search : "",
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : "Unknown",
      includeDiagnostics,
      signedIn: Boolean(isSignedIn && signedInAccountId),
      signedInEmail,
      signedInAccountId,
      anonymousFeedback: activeLane === "feedback" && feedbackAnonymous,
    }),
    [
      activeLane,
      pathname,
      includeDiagnostics,
      isSignedIn,
      signedInAccountId,
      signedInEmail,
      feedbackAnonymous,
    ],
  );

  const contextDisclosure = useMemo(
    () => buildHelpContextDisclosure(contextInput),
    [contextInput],
  );

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    posthog.capture("help_opened", { source: source ?? undefined });
  }, [source]);

  const getSupportIdempotencyKey = useCallback(() => {
    if (!supportIdempotencyKeyRef.current) {
      supportIdempotencyKeyRef.current = crypto.randomUUID();
    }
    return supportIdempotencyKeyRef.current;
  }, []);

  const getFeedbackIdempotencyKey = useCallback(() => {
    if (!feedbackIdempotencyKeyRef.current) {
      feedbackIdempotencyKeyRef.current = crypto.randomUUID();
    }
    return feedbackIdempotencyKeyRef.current;
  }, []);

  const handleLaneChange = useCallback((lane: HelpLane) => {
    setActiveLane(lane);
    setFormError(null);
    setFieldErrors({});
    posthog.capture("help_lane_selected", { lane });
  }, []);

  const handleGuideSelect = useCallback((slug: string) => {
    posthog.capture("help_guide_selected", { slug });
  }, []);

  const handleFeedbackAnonymousChange = useCallback((value: boolean) => {
    setFeedbackAnonymous(value);
    if (value) {
      setFeedbackReplyEmailOverride(null);
    }
  }, []);

  const submitSupport = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      setFieldErrors({});
      setFormError(null);

      const trimmedCategory = category.trim();
      const trimmedEmail = replyEmail.trim();
      const trimmedMessage = message.trim();

      const contextPayload = buildHelpClientContextPayload({
        ...contextInput,
        lane: "support",
      });

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (isSignedIn) {
          const token = await getToken({ template: "convex" });
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }

        const response = await fetch(`${convexSiteUrl()}/help/intake`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            lane: "support",
            idempotencyKey: getSupportIdempotencyKey(),
            replyEmail: trimmedEmail,
            category: trimmedCategory,
            message: trimmedMessage,
            honeypot,
            includeDiagnostics: contextPayload.includeDiagnostics,
            context: contextPayload.context,
            poolIdHint: contextPayload.poolIdHint,
          }),
        });

        const json = (await response.json()) as {
          ok?: boolean;
          reference?: string;
          acceptedAtMs?: number;
          errors?: HelpFieldErrors;
          error?: string;
        };

        if (response.ok && json.ok && json.reference) {
          posthog.capture("help_support_submitted", {
            outcome: "success",
            category: trimmedCategory,
          });
          const nextAcceptance: SupportAcceptance = {
            kind: "support",
            reference: json.reference,
            category: trimmedCategory,
            acceptedAtMs: json.acceptedAtMs ?? Date.now(),
          };
          setAcceptance(nextAcceptance);
          supportIdempotencyKeyRef.current = null;
          return;
        }

        posthog.capture("help_support_submitted", {
          outcome: "failure",
          category: trimmedCategory || undefined,
        });

        if (json.errors) {
          setFieldErrors(json.errors);
          if (json.errors.lane) {
            setFormError(json.errors.lane);
          }
        } else {
          setFormError(json.error ?? "Something went wrong. Please try again.");
        }
      } catch {
        posthog.capture("help_support_submitted", {
          outcome: "failure",
          category: trimmedCategory || undefined,
        });
        setFormError("Network error. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      category,
      contextInput,
      getSupportIdempotencyKey,
      getToken,
      honeypot,
      isSignedIn,
      message,
      replyEmail,
    ],
  );

  const submitFeedback = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      setFieldErrors({});
      setFormError(null);

      const sentiment = feedbackSentiment;
      const type = feedbackType;
      const trimmedMessage = feedbackMessage.trim();
      const trimmedEmail = feedbackAnonymous ? "" : feedbackReplyEmail.trim();

      const contextPayload = buildHelpClientContextPayload({
        ...contextInput,
        lane: "feedback",
        anonymousFeedback: feedbackAnonymous,
      });

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (isSignedIn) {
          const token = await getToken({ template: "convex" });
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }
        }

        const response = await fetch(`${convexSiteUrl()}/help/intake`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            lane: "feedback",
            idempotencyKey: getFeedbackIdempotencyKey(),
            sentiment,
            feedbackType: type,
            message: trimmedMessage,
            replyEmail: trimmedEmail.length > 0 ? trimmedEmail : undefined,
            anonymous: feedbackAnonymous,
            honeypot,
            includeDiagnostics: contextPayload.includeDiagnostics,
            context: contextPayload.context,
            poolIdHint: contextPayload.poolIdHint,
          }),
        });

        const json = (await response.json()) as {
          ok?: boolean;
          reference?: string;
          acceptedAtMs?: number;
          contactable?: boolean;
          errors?: HelpFieldErrors;
          error?: string;
        };

        if (response.ok && json.ok && json.reference && sentiment && type) {
          posthog.capture("help_feedback_submitted", {
            outcome: "success",
            feedback_type: type,
            sentiment,
            lane: "feedback",
          });
          const nextAcceptance: FeedbackAcceptance = {
            kind: "feedback",
            reference: json.reference,
            feedbackType: type,
            sentiment,
            contactable: json.contactable ?? trimmedEmail.length > 0,
            acceptedAtMs: json.acceptedAtMs ?? Date.now(),
          };
          setAcceptance(nextAcceptance);
          feedbackIdempotencyKeyRef.current = null;
          return;
        }

        posthog.capture("help_feedback_submitted", {
          outcome: "failure",
          feedback_type: type || undefined,
          sentiment: sentiment || undefined,
          lane: "feedback",
        });

        if (json.errors) {
          setFieldErrors(json.errors);
          if (json.errors.lane) {
            setFormError(json.errors.lane);
          }
        } else {
          setFormError(json.error ?? "Something went wrong. Please try again.");
        }
      } catch {
        posthog.capture("help_feedback_submitted", {
          outcome: "failure",
          feedback_type: type || undefined,
          sentiment: sentiment || undefined,
          lane: "feedback",
        });
        setFormError("Network error. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      contextInput,
      feedbackAnonymous,
      feedbackMessage,
      feedbackReplyEmail,
      feedbackSentiment,
      feedbackType,
      getFeedbackIdempotencyKey,
      getToken,
      honeypot,
      isSignedIn,
    ],
  );

  return (
    <HelpFeedbackView
      source={source}
      suggestedGuides={suggestedGuides}
      signedInEmail={signedInEmail}
      activeLane={activeLane}
      onLaneChange={handleLaneChange}
      onGuideSelect={handleGuideSelect}
      category={category}
      replyEmail={replyEmail}
      message={message}
      honeypot={honeypot}
      onCategoryChange={setCategory}
      onReplyEmailChange={setReplyEmailOverride}
      onMessageChange={setMessage}
      onHoneypotChange={setHoneypot}
      feedbackSentiment={feedbackSentiment}
      feedbackType={feedbackType}
      feedbackMessage={feedbackMessage}
      feedbackReplyEmail={feedbackReplyEmail}
      feedbackAnonymous={feedbackAnonymous}
      onFeedbackSentimentChange={setFeedbackSentiment}
      onFeedbackTypeChange={setFeedbackType}
      onFeedbackMessageChange={setFeedbackMessage}
      onFeedbackReplyEmailChange={setFeedbackReplyEmailOverride}
      onFeedbackAnonymousChange={handleFeedbackAnonymousChange}
      includeDiagnostics={includeDiagnostics}
      onIncludeDiagnosticsChange={setIncludeDiagnostics}
      contextDisclosure={contextDisclosure}
      fieldErrors={fieldErrors}
      formError={formError}
      submitting={submitting}
      onSupportSubmit={(event) => {
        void submitSupport(event);
      }}
      onFeedbackSubmit={(event) => {
        void submitFeedback(event);
      }}
      acceptance={acceptance}
    />
  );
}
