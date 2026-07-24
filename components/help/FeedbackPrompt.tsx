"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import posthog from "posthog-js";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FeedbackPromptDialog } from "@/components/help/FeedbackPromptDialog";
import { api } from "@/convex/_generated/api";
import type { FeedbackSentiment } from "@/lib/helpConstants";
import {
  buildHelpPromptFeedbackHref,
  HELP_FEEDBACK_PROMPT_FLAG,
  isCalmPageForHelpPrompt,
  writeHelpPromptDraft,
} from "@/lib/helpPrompt";

function isPromptFeatureEnabled(): boolean {
  try {
    if (!posthog.__loaded) return false;
    return posthog.isFeatureEnabled(HELP_FEEDBACK_PROMPT_FLAG) === true;
  } catch {
    return false;
  }
}

export function FeedbackPrompt() {
  const { isSignedIn } = useAuth();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [featureEnabled, setFeatureEnabled] = useState(() =>
    isPromptFeatureEnabled(),
  );
  const [open, setOpen] = useState(false);
  const shownRef = useRef(false);
  const recordingRef = useRef(false);

  const recordShown = useMutation(api.helpPrompt.recordPromptShown);
  const snoozePrompt = useMutation(api.helpPrompt.snoozePrompt);
  const retirePrompt = useMutation(api.helpPrompt.retirePrompt);

  const promptState = useQuery(
    api.helpPrompt.getPromptState,
    isSignedIn ? { nowMs } : "skip",
  );

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [pathname]);

  useEffect(() => {
    const syncFlag = () => {
      setFeatureEnabled(isPromptFeatureEnabled());
    };
    syncFlag();
    return posthog.onFeatureFlags(syncFlag);
  }, []);

  const calmPage = isCalmPageForHelpPrompt(pathname);
  const canShow =
    featureEnabled &&
    isSignedIn &&
    calmPage &&
    promptState?.canShow === true;

  useEffect(() => {
    if (!canShow || shownRef.current || recordingRef.current) return;

    recordingRef.current = true;
    shownRef.current = true;

    const frame = window.requestAnimationFrame(() => {
      setOpen(true);
    });

    void recordShown({ nowMs: Date.now() })
      .catch(() => {
        shownRef.current = false;
        setOpen(false);
      })
      .finally(() => {
        recordingRef.current = false;
      });

    posthog.capture("help_prompt_shown");
    return () => window.cancelAnimationFrame(frame);
  }, [canShow, recordShown]);

  const handleSentiment = useCallback(
    (sentiment: FeedbackSentiment) => {
      writeHelpPromptDraft({ sentiment, createdAtMs: Date.now() });
      posthog.capture("help_prompt_draft_started");
      setOpen(false);
      router.push(buildHelpPromptFeedbackHref(sentiment));
    },
    [router],
  );

  const handleSnooze = useCallback(() => {
    void snoozePrompt({ nowMs: Date.now() });
    posthog.capture("help_prompt_snoozed");
    setOpen(false);
  }, [snoozePrompt]);

  const handleRetire = useCallback(() => {
    void retirePrompt({ nowMs: Date.now() });
    posthog.capture("help_prompt_retired");
    setOpen(false);
  }, [retirePrompt]);

  if (!featureEnabled || !isSignedIn || !calmPage) {
    return null;
  }

  return (
    <FeedbackPromptDialog
      open={open}
      onOpenChange={setOpen}
      onSentiment={handleSentiment}
      onSnooze={handleSnooze}
      onRetire={handleRetire}
    />
  );
}
