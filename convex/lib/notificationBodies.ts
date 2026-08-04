import {
  notificationSettingsUrl,
  poolStandingsUrl,
  poolUrl,
} from "./notificationConfig";

export function formatPoolUpdateEmail(args: {
  poolName: string;
  poolId: string;
  field: "description" | "banner";
  latestText: string;
  env?: Record<string, string | undefined>;
}): { subject: string; bodyText: string } {
  const fieldLabel =
    args.field === "description" ? "description" : "banner";
  const subject = `${args.poolName}: ${fieldLabel} updated`;
  const content =
    args.latestText.trim().length > 0
      ? args.latestText
      : `(${fieldLabel} cleared)`;
  const bodyText = [
    `${args.poolName} ${fieldLabel} was updated.`,
    "",
    content,
    "",
    `Open pool: ${poolUrl(args.poolId, args.env)}`,
    "",
    `Manage email notifications: ${notificationSettingsUrl(args.env)}`,
  ].join("\n");
  return { subject, bodyText };
}

export function formatPickReminderEmail(args: {
  poolName: string;
  poolId: string;
  week: number;
  incompleteEntryNumbers: number[];
  firstKickoffMs: number;
  env?: Record<string, string | undefined>;
}): { subject: string; bodyText: string } {
  const entries =
    args.incompleteEntryNumbers.length === 1
      ? `entry ${args.incompleteEntryNumbers[0]}`
      : `entries ${args.incompleteEntryNumbers.join(", ")}`;
  const kickoff = new Date(args.firstKickoffMs).toUTCString();
  const subject = `${args.poolName}: Week ${args.week} picks due soon`;
  const bodyText = [
    `Reminder: Week ${args.week} in ${args.poolName} still needs picks on ${entries}.`,
    "",
    `First game kickoff (UTC): ${kickoff}`,
    "",
    `Make picks: ${poolUrl(args.poolId, args.env)}`,
    "",
    `Manage email notifications: ${notificationSettingsUrl(args.env)}`,
  ].join("\n");
  return { subject, bodyText };
}

export type WeeklyPoolSection = {
  poolName: string;
  poolId: string;
  poolType: "survivor" | "confidence";
  lines: string[];
};

export function formatWeeklySummaryEmail(args: {
  week: number;
  sections: WeeklyPoolSection[];
  env?: Record<string, string | undefined>;
}): { subject: string; bodyText: string } {
  const subject = `Only Pools weekly summary — Week ${args.week}`;
  const parts: string[] = [
    `Your Week ${args.week} summary across ${args.sections.length} pool${
      args.sections.length === 1 ? "" : "s"
    }.`,
    "",
  ];
  for (const section of args.sections) {
    parts.push(`— ${section.poolName} (${section.poolType})`);
    for (const line of section.lines) {
      parts.push(`  ${line}`);
    }
    parts.push(`  Standings: ${poolStandingsUrl(section.poolId, args.env)}`);
    parts.push("");
  }
  parts.push(
    `Manage email notifications: ${notificationSettingsUrl(args.env)}`,
  );
  return { subject, bodyText: parts.join("\n") };
}
