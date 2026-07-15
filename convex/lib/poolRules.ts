/**
 * Pool Ruleset freeze: Start Week and Pick Lock mode stay editable until the
 * earlier of the first accepted competitive edit or the first Pick Lock.
 */

export function assertRulesEditable(rulesFrozen: boolean): void {
  if (rulesFrozen) {
    throw new Error(
      "Pool Ruleset is frozen after the first accepted competitive edit or Pick Lock",
    );
  }
}

export function assertValidStartWeekSlate(args: {
  games: Array<{ scheduledKickoffMs: number }>;
  nowMs: number;
}): void {
  if (args.games.length === 0) {
    throw new Error("Start Week has no published slate");
  }
  const earliestKickoff = Math.min(
    ...args.games.map((g) => g.scheduledKickoffMs),
  );
  if (earliestKickoff <= args.nowMs) {
    throw new Error("Start Week first game has already kicked off");
  }
}
