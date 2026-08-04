import {
  notificationSettingsUrl,
  poolStandingsUrl,
  poolUrl,
} from "./notificationConfig";
import {
  renderNotificationEmailHtml,
  type EmailBlock,
} from "./notificationEmailLayout";

export type FormattedNotificationEmail = {
  subject: string;
  bodyText: string;
  bodyHtml: string;
};

export function formatPoolUpdateEmail(args: {
  poolName: string;
  poolId: string;
  field: "description" | "banner";
  latestText: string;
  env?: Record<string, string | undefined>;
}): FormattedNotificationEmail {
  const fieldLabel =
    args.field === "description" ? "description" : "banner";
  const subject = `${args.poolName}: ${fieldLabel} updated`;
  const content =
    args.latestText.trim().length > 0
      ? args.latestText
      : `(${fieldLabel} cleared)`;
  const href = poolUrl(args.poolId, args.env);
  const settingsUrl = notificationSettingsUrl(args.env);

  const bodyText = [
    `${args.poolName} ${fieldLabel} was updated.`,
    "",
    content,
    "",
    `Open pool: ${href}`,
    "",
    `Manage email notifications: ${settingsUrl}`,
  ].join("\n");

  const blocks: EmailBlock[] = [
    {
      kind: "paragraph",
      text: `The ${fieldLabel} for ${args.poolName} was updated.`,
    },
    { kind: "quote", text: content },
  ];

  const bodyHtml = renderNotificationEmailHtml({
    preheader: `${args.poolName} ${fieldLabel} updated`,
    headline:
      fieldLabel === "banner" ? "Pool banner updated" : "Pool description updated",
    blocks,
    cta: { label: "Open pool", href },
    settingsUrl,
  });

  return { subject, bodyText, bodyHtml };
}

export function formatPickReminderEmail(args: {
  poolName: string;
  poolId: string;
  week: number;
  incompleteEntryNumbers: number[];
  firstKickoffMs: number;
  env?: Record<string, string | undefined>;
}): FormattedNotificationEmail {
  const entries =
    args.incompleteEntryNumbers.length === 1
      ? `entry ${args.incompleteEntryNumbers[0]}`
      : `entries ${args.incompleteEntryNumbers.join(", ")}`;
  const kickoff = new Date(args.firstKickoffMs).toUTCString();
  const subject = `${args.poolName}: Week ${args.week} picks due soon`;
  const href = poolUrl(args.poolId, args.env);
  const settingsUrl = notificationSettingsUrl(args.env);

  const bodyText = [
    `Reminder: Week ${args.week} in ${args.poolName} still needs picks on ${entries}.`,
    "",
    `First game kickoff (UTC): ${kickoff}`,
    "",
    `Make picks: ${href}`,
    "",
    `Manage email notifications: ${settingsUrl}`,
  ].join("\n");

  const bodyHtml = renderNotificationEmailHtml({
    preheader: `Week ${args.week} picks due soon in ${args.poolName}`,
    headline: "Picks due soon",
    blocks: [
      {
        kind: "paragraph",
        text: `Week ${args.week} in ${args.poolName} still needs picks on ${entries}. First game kickoff (UTC): ${kickoff}.`,
      },
    ],
    cta: { label: "Make picks", href },
    settingsUrl,
  });

  return { subject, bodyText, bodyHtml };
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
}): FormattedNotificationEmail {
  const subject = `Only Pools weekly summary — Week ${args.week}`;
  const settingsUrl = notificationSettingsUrl(args.env);
  const parts: string[] = [
    `Your Week ${args.week} summary across ${args.sections.length} pool${
      args.sections.length === 1 ? "" : "s"
    }.`,
    "",
  ];
  const blocks: EmailBlock[] = [
    {
      kind: "paragraph",
      text: `Here’s how Week ${args.week} went across your pools.`,
    },
  ];

  for (const section of args.sections) {
    parts.push(`— ${section.poolName} (${section.poolType})`);
    for (const line of section.lines) {
      parts.push(`  ${line}`);
    }
    const standings = poolStandingsUrl(section.poolId, args.env);
    parts.push(`  Standings: ${standings}`);
    parts.push("");
    blocks.push({
      kind: "section",
      title: `${section.poolName} · ${section.poolType}`,
      lines: section.lines,
      href: standings,
      hrefLabel: "View standings",
    });
  }
  parts.push(`Manage email notifications: ${settingsUrl}`);

  const bodyHtml = renderNotificationEmailHtml({
    preheader: `Week ${args.week} summary across ${args.sections.length} pools`,
    headline: `Week ${args.week} summary`,
    blocks,
    settingsUrl,
  });

  return { subject, bodyText: parts.join("\n"), bodyHtml };
}
