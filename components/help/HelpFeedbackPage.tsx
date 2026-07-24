"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  HelpFeedbackView,
  type HelpFieldErrors,
  type HelpLane,
  type SupportAcceptance,
} from "@/components/help/HelpFeedbackView";
import { convexSiteUrl } from "@/lib/convexSiteUrl";
import { suggestGuidesForHelpContext } from "@/lib/help";

export function HelpFeedbackPage() {
  const searchParams = useSearchParams();
  const source = searchParams.get("source");
  const suggestedGuides = suggestGuidesForHelpContext(source);
  const { isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  const [activeLane, setActiveLane] = useState<HelpLane>("support");
  const [category, setCategory] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [fieldErrors, setFieldErrors] = useState<HelpFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acceptance, setAcceptance] = useState<SupportAcceptance | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);
  const startedAtMsRef = useRef<number | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    posthog.capture("help_opened", { source: source ?? undefined });
  }, [source]);

  useEffect(() => {
    const primary = user?.primaryEmailAddress?.emailAddress;
    if (primary && replyEmail.trim().length === 0) {
      setReplyEmail(primary);
    }
  }, [user?.primaryEmailAddress?.emailAddress, replyEmail]);

  useEffect(() => {
    if (activeLane === "support" && startedAtMsRef.current === null) {
      startedAtMsRef.current = Date.now();
    }
  }, [activeLane]);

  const getIdempotencyKey = useCallback(() => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    return idempotencyKeyRef.current;
  }, []);

  const handleLaneChange = useCallback((lane: HelpLane) => {
    setActiveLane(lane);
    setFeedbackNotice(null);
    posthog.capture("help_lane_selected", { lane });
  }, []);

  const handleGuideSelect = useCallback((slug: string) => {
    posthog.capture("help_guide_selected", { slug });
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
            idempotencyKey: getIdempotencyKey(),
            replyEmail: trimmedEmail,
            category: trimmedCategory,
            message: trimmedMessage,
            honeypot,
            includeDiagnostics: false,
            context: {
              pagePath:
                typeof window !== "undefined"
                  ? `${window.location.pathname}${window.location.search}`
                  : "/help",
              source: source ?? undefined,
              startedAtMs: startedAtMsRef.current ?? undefined,
            },
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
          setAcceptance({
            reference: json.reference,
            category: trimmedCategory,
            acceptedAtMs: json.acceptedAtMs ?? Date.now(),
          });
          idempotencyKeyRef.current = null;
          startedAtMsRef.current = null;
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
      getIdempotencyKey,
      getToken,
      honeypot,
      isSignedIn,
      message,
      replyEmail,
      source,
    ],
  );

  const submitFeedback = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFeedbackNotice(null);

      try {
        const response = await fetch(`${convexSiteUrl()}/help/intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lane: "feedback",
            idempotencyKey: crypto.randomUUID(),
            message: "placeholder",
            honeypot: "",
          }),
        });

        if (response.status === 501) {
          setFeedbackNotice("Feedback intake is finishing setup.");
          return;
        }

        setFeedbackNotice(
          "Feedback intake is finishing setup. Use Get support for product help now.",
        );
      } catch {
        setFeedbackNotice(
          "Feedback intake is finishing setup. Use Get support for product help now.",
        );
      }
    },
    [],
  );

  return (
    <HelpFeedbackView
      source={source}
      suggestedGuides={suggestedGuides}
      signedInEmail={user?.primaryEmailAddress?.emailAddress ?? null}
      activeLane={activeLane}
      onLaneChange={handleLaneChange}
      onGuideSelect={handleGuideSelect}
      category={category}
      replyEmail={replyEmail}
      message={message}
      honeypot={honeypot}
      onCategoryChange={setCategory}
      onReplyEmailChange={setReplyEmail}
      onMessageChange={setMessage}
      onHoneypotChange={setHoneypot}
      fieldErrors={fieldErrors}
      formError={formError}
      feedbackNotice={feedbackNotice}
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
