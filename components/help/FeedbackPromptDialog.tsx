"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  FEEDBACK_SENTIMENT_LABELS,
  type FeedbackSentiment,
} from "@/lib/helpConstants";

const SENTIMENTS: FeedbackSentiment[] = ["negative", "neutral", "positive"];

export function FeedbackPromptPanel({
  onSentiment,
  onSnooze,
  onRetire,
}: {
  onSentiment: (sentiment: FeedbackSentiment) => void;
  onSnooze: () => void;
  onRetire: () => void;
}) {
  return (
    <>
      <h2 className="text-lg font-semibold">How is Only Pools going?</h2>
      <p
        id="help-feedback-prompt-description"
        className="text-sm text-muted-foreground"
      >
        Your feedback helps us improve. Choose how things feel so far — you can
        review and edit before anything is sent.
      </p>

      <div
        role="group"
        aria-label="How is Only Pools going?"
        className="flex flex-col gap-2"
      >
        {SENTIMENTS.map((sentiment) => (
          <Button
            key={sentiment}
            type="button"
            variant="outline"
            className="w-full justify-start"
            onClick={() => onSentiment(sentiment)}
          >
            {FEEDBACK_SENTIMENT_LABELS[sentiment]}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onSnooze}>
          Not now
        </Button>
        <Button type="button" variant="ghost" onClick={onRetire}>
          Don&apos;t ask again
        </Button>
      </div>
    </>
  );
}

export function FeedbackPromptDialog({
  open,
  onSentiment,
  onSnooze,
  onRetire,
  onOpenChange,
}: {
  open: boolean;
  onSentiment: (sentiment: FeedbackSentiment) => void;
  onSnooze: () => void;
  onRetire: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="help-feedback-prompt-description"
        className="max-w-md"
      >
        <FeedbackPromptPanel
          onSentiment={onSentiment}
          onSnooze={onSnooze}
          onRetire={onRetire}
        />
      </DialogContent>
    </Dialog>
  );
}
