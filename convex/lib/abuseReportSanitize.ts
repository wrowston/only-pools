/**
 * Reject Abuse Report payloads that appear to contain Hidden Pick values or
 * raw invite credentials. Conservative string checks — never copy those
 * values into storage.
 */
const INVITE_SECRET_PATTERN =
  /\/join\/[A-Za-z0-9_-]{16,}|invite[_-]?token|credentialSecret/i;
const HIDDEN_PICK_PATTERN =
  /\b(nflTeamId|pickedTeamId|confidenceValue|tiebreakerPrediction)\b/i;

export function assertAbuseReportPayloadSafe(args: {
  reason: string;
  description?: string;
}): void {
  const blob = `${args.reason}\n${args.description ?? ""}`;
  if (INVITE_SECRET_PATTERN.test(blob)) {
    throw new Error(
      "Abuse Report must not include raw Pool Invite credentials",
    );
  }
  if (HIDDEN_PICK_PATTERN.test(blob)) {
    throw new Error("Abuse Report must not include Hidden Pick values");
  }
}
