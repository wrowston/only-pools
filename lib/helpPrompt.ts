import type { FeedbackSentiment } from "@/lib/helpConstants";

export const HELP_FEEDBACK_PROMPT_FLAG =
  process.env.NEXT_PUBLIC_HELP_FEEDBACK_PROMPT_FLAG ?? "help-feedback-prompt";

export const HELP_PROMPT_DRAFT_STORAGE_KEY = "help-feedback-prompt-draft";

export type HelpPromptDraft = {
  sentiment: FeedbackSentiment;
  createdAtMs: number;
};

/** Calm pages where the proactive prompt may appear (never the week board). */
export function isCalmPageForHelpPrompt(pathname: string): boolean {
  if (pathname === "/my-pools") return true;
  if (/^\/pools\/[^/]+\/standings\/?$/.test(pathname)) return true;
  if (/^\/pools\/[^/]+\/pool\/?$/.test(pathname)) return true;
  return false;
}

export function readHelpPromptDraft(): HelpPromptDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HELP_PROMPT_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HelpPromptDraft;
    if (
      parsed &&
      typeof parsed.sentiment === "string" &&
      typeof parsed.createdAtMs === "number"
    ) {
      return parsed;
    }
  } catch {
    // Ignore malformed draft payloads.
  }
  return null;
}

export function writeHelpPromptDraft(draft: HelpPromptDraft): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(HELP_PROMPT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function clearHelpPromptDraft(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(HELP_PROMPT_DRAFT_STORAGE_KEY);
}

export function buildHelpPromptFeedbackHref(
  sentiment: FeedbackSentiment,
): string {
  const params = new URLSearchParams({
    source: "prompt",
    lane: "feedback",
    sentiment,
  });
  return `/help?${params.toString()}`;
}
