import type { Doc } from "../_generated/dataModel";

/** Absent / undefined means on (grilled default). Explicit false means off. */
export function prefersEmailPickReminders(
  participant: Pick<Doc<"participants">, "emailPickReminders">,
): boolean {
  return participant.emailPickReminders !== false;
}

export function prefersEmailPoolUpdates(
  participant: Pick<Doc<"participants">, "emailPoolUpdates">,
): boolean {
  return participant.emailPoolUpdates !== false;
}

export function prefersEmailWeeklySummary(
  participant: Pick<Doc<"participants">, "emailWeeklySummary">,
): boolean {
  return participant.emailWeeklySummary !== false;
}

export function resolveNotificationPreferences(
  participant: Pick<
    Doc<"participants">,
    "emailPickReminders" | "emailPoolUpdates" | "emailWeeklySummary"
  >,
): {
  emailPickReminders: boolean;
  emailPoolUpdates: boolean;
  emailWeeklySummary: boolean;
} {
  return {
    emailPickReminders: prefersEmailPickReminders(participant),
    emailPoolUpdates: prefersEmailPoolUpdates(participant),
    emailWeeklySummary: prefersEmailWeeklySummary(participant),
  };
}

export function hasVerifiedEmail(
  participant: Pick<Doc<"participants">, "email" | "emailVerified">,
): participant is {
  email: string;
  emailVerified: boolean;
} {
  return (
    Boolean(participant.email?.trim()) && participant.emailVerified === true
  );
}
