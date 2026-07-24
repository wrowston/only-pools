/**
 * Reject Abuse Report payloads that appear to contain Hidden Pick values or
 * raw invite credentials. Conservative string checks — never copy those
 * values into storage.
 */
import { assertTextSafeForHelp } from "./helpSanitize";

export function assertAbuseReportPayloadSafe(args: {
  reason: string;
  description?: string;
}): void {
  const blob = `${args.reason}\n${args.description ?? ""}`;
  assertTextSafeForHelp(blob, "Abuse Report");
}
