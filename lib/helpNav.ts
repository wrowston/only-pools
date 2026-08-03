export const HELP_FEEDBACK_LABEL = "Help & feedback";

export function helpFeedbackHref(
  section: "board" | "standings" | "pool",
): string {
  return `/help?source=${section}`;
}
