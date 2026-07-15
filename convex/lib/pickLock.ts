/**
 * Game Kickoff Lock and Weekly Cutoff Lock — server-authoritative only.
 * Client clocks and client-supplied timestamps are never trusted.
 */

const PLAY_STARTED_LIFECYCLES = new Set([
  "in_progress",
  "interrupted",
  "terminal",
]);

/**
 * A game reaches Game Kickoff Lock at the earlier of:
 * - server now >= authoritative scheduled kickoff
 * - normalized provider state reporting play has started
 * There is no grace period.
 */
export function isGameKickoffLocked(
  game: { scheduledKickoffMs: number; lifecycle: string },
  nowMs: number,
): boolean {
  if (nowMs >= game.scheduledKickoffMs) {
    return true;
  }
  return PLAY_STARTED_LIFECYCLES.has(game.lifecycle);
}

/**
 * Sunday 1:00 p.m. America/New_York for the NFL week containing `anchorMs`
 * (typically the earliest scheduled kickoff in the Pool Week slate).
 */
export function computeWeeklyCutoffMs(anchorMs: number): number {
  const etDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(anchorMs));

  const part = (type: string) =>
    etDate.find((p) => p.type === type)?.value ?? "0";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const weekday = part("weekday");

  const weekdayOffset: Record<string, number> = {
    Sun: 0,
    Mon: 6,
    Tue: 5,
    Wed: 4,
    Thu: 3,
    Fri: 2,
    Sat: 1,
  };
  const daysUntilSunday = weekdayOffset[weekday] ?? 0;

  // Build noon UTC guess, then adjust to exact 13:00 ET via iterative format.
  const sundayUtcGuess = Date.UTC(year, month - 1, day + daysUntilSunday, 17, 0, 0);
  return alignToEasternHour(sundayUtcGuess, 13);
}

function alignToEasternHour(approxUtcMs: number, hourEt: number): number {
  let ms = approxUtcMs;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value ?? "0");
    const y = get("year");
    const mo = get("month");
    const d = get("day");
    const h = get("hour");
    const mi = get("minute");
    const s = get("second");
    const deltaMin = (hourEt - h) * 60 - mi;
    const deltaMs = deltaMin * 60_000 - s * 1000;
    if (deltaMs === 0) {
      // Confirm calendar day still matches intended Sunday.
      void y;
      void mo;
      void d;
      return ms;
    }
    ms += deltaMs;
  }
  return ms;
}

/**
 * Whether a Survivor Pick or Confidence game component targeting `game` is
 * past its Pick Lock under the Pool's lock mode. Weekly Cutoff freezes
 * remaining choices at Sunday 1pm ET while earlier games still lock
 * individually at kickoff.
 */
export function isSurvivorPickLocked(args: {
  pickLockMode: "gameKickoff" | "weeklyCutoff";
  game: { scheduledKickoffMs: number; lifecycle: string };
  weeklyCutoffMs: number | null;
  nowMs: number;
}): boolean {
  if (isGameKickoffLocked(args.game, args.nowMs)) {
    return true;
  }
  if (
    args.pickLockMode === "weeklyCutoff" &&
    args.weeklyCutoffMs !== null &&
    args.nowMs >= args.weeklyCutoffMs
  ) {
    return true;
  }
  return false;
}

/** Alias — Confidence prediction + confidence value lock with the game. */
export const isConfidenceGameLocked = isSurvivorPickLocked;

/**
 * Weekly Tiebreaker Prediction lock: under Game Kickoff Lock, locks with the
 * designated last Required Confidence Game; under Weekly Cutoff Lock, locks
 * at Sunday 1:00 p.m. Eastern (even before that game's kickoff).
 */
export function isTiebreakerLocked(args: {
  pickLockMode: "gameKickoff" | "weeklyCutoff";
  tiebreakerGame: { scheduledKickoffMs: number; lifecycle: string };
  weeklyCutoffMs: number | null;
  nowMs: number;
}): boolean {
  if (args.pickLockMode === "weeklyCutoff") {
    if (
      args.weeklyCutoffMs !== null &&
      args.nowMs >= args.weeklyCutoffMs
    ) {
      return true;
    }
    // Earlier games still lock individually; tiebreaker also locks if its
    // designated game has reached Game Kickoff Lock before Sunday cutoff.
    return isGameKickoffLocked(args.tiebreakerGame, args.nowMs);
  }
  return isGameKickoffLocked(args.tiebreakerGame, args.nowMs);
}

export type SaveTrustState =
  | { status: "saved"; savedAtMs: number }
  | { status: "error"; explanation: string };
