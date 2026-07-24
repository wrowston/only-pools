import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildHelpPromptFeedbackHref,
  isCalmPageForHelpPrompt,
  readHelpPromptDraft,
  writeHelpPromptDraft,
  clearHelpPromptDraft,
  HELP_PROMPT_DRAFT_STORAGE_KEY,
} from "@/lib/helpPrompt";

describe("helpPrompt utilities", () => {
  it("identifies calm pages for delayed prompt display", () => {
    expect(isCalmPageForHelpPrompt("/my-pools")).toBe(true);
    expect(isCalmPageForHelpPrompt("/pools/pool123/standings")).toBe(true);
    expect(isCalmPageForHelpPrompt("/pools/pool123/pool/")).toBe(true);
    expect(isCalmPageForHelpPrompt("/pools/pool123")).toBe(false);
  });

  it("builds feedback help links from prompt sentiment choices", () => {
    expect(buildHelpPromptFeedbackHref("negative")).toContain("source=prompt");
    expect(buildHelpPromptFeedbackHref("negative")).toContain("lane=feedback");
    expect(buildHelpPromptFeedbackHref("negative")).toContain("sentiment=negative");
  });
});

describe("help prompt draft storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
      removeItem(key: string) {
        store.delete(key);
      },
      clear() {
        store.clear();
      },
    });
  });

  it("writes and reads an unsent draft without submitting feedback", () => {
    writeHelpPromptDraft({ sentiment: "positive", createdAtMs: 1_700_000_000_000 });
    expect(readHelpPromptDraft()).toEqual({
      sentiment: "positive",
      createdAtMs: 1_700_000_000_000,
    });
    clearHelpPromptDraft();
    expect(sessionStorage.getItem(HELP_PROMPT_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("builds a help URL that opens the feedback lane from the prompt", () => {
    expect(buildHelpPromptFeedbackHref("neutral")).toBe(
      "/help?source=prompt&lane=feedback&sentiment=neutral",
    );
  });
});
