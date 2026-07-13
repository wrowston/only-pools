# NFL Survivor tie-rule research

Research date: 2026-07-13

## Recommendation

For the Only Pools MVP, treat an NFL game ending in a tie as an **incorrect Survivor pick that immediately eliminates the entry**. Do not model it as a strike and do not make the rule configurable in the MVP.

Suggested product rule:

> A Survivor entry advances only when every required team it selected wins. A loss, tie, or missing required selection eliminates the entry.

This is the clearest interpretation of “pick a winner,” matches the default or single-elimination behavior of Yahoo, Sleeper, and Splash, and avoids adding a pool-level option for an uncommon edge case. ESPN and DraftKings show that “tie advances” is a legitimate alternative, so configurability can be revisited later if commissioners ask for it.

## Platform comparison

| Platform | A tied NFL pick does what? | Configurable? | Notes |
| --- | --- | --- | --- |
| Yahoo Survival Football | Produces a strike. In a public group, one strike eliminates the entry; private commissioners can allow up to two strikes. | Strike limit is configurable in private groups; the tie itself is still scored as a strike. | Yahoo groups missed picks, losses, and ties into the same failure result. [Yahoo Help: How to play Yahoo Survival Football](https://help.yahoo.com/kb/survival-football/SLN6746.html) |
| Sleeper NFL Survivor | Immediately eliminates the entry. | No tie-specific option is documented. The commissioner can choose Straight or Spread scoring before the season. | Sleeper explicitly says picking either team in a tied NFL game eliminates the entry. [Sleeper Support: NFL Survivor](https://support.sleeper.com/en/articles/9689521-nfl-survivor) |
| Splash Sports | Immediately eliminates the entry. | No tie-specific option is shown for the cited contest. | Splash's 2026 NFL Survivor rules group losing, tying, and missing the deadline as elimination outcomes. [Splash Sports: 2026 NFL Survivor](https://splashsports.com/nflsurvivor) |
| ESPN Eliminator Challenge | Advances the entry. | No tie-specific option is shown. | ESPN's official 2025 How to Play page says an entry advances if its team “wins (or ties).” [ESPN Eliminator Challenge: How to Play](https://fantasy.espn.com/games/nfl-eliminator-challenge-2025/howtoplay) |
| DraftKings free-to-play Survivor | Advances the entry; DraftKings explicitly treats an NFL tie as a win. | No tie-specific option is documented on the general Pools help page. | This is a clear counterexample to loss-on-tie. [DraftKings Support: What is a free to play Pool?](https://support.draftkings.com/dk/en-us/what-is-a-free-to-play-pool?id=kb_article_view&sysparm_article=KB0010555) |
| OfficePoolStop | Counts as a win or a loss according to league settings. | Yes. | Its rules also support lives, second-place brackets, and other non-MVP variants, demonstrating that tie handling can be commissioner-configurable in more elaborate products. [OfficePoolStop: Survivor Pool Rules](https://officepoolstop.com/rules/survivor) |

## Patterns and implications

### 1. Elimination on a tie is a common default, but not a universal standard

Yahoo's public-game behavior, Sleeper, and Splash all make a tie fatal in a single-elimination pool. ESPN and DraftKings instead let the entry advance. The market therefore supplies precedent for both interpretations; Only Pools should state the rule explicitly rather than assume players will infer it.

### 2. Products usually align ties with an existing success/failure primitive

- Sleeper and Splash require a win, so a tie is an elimination.
- Yahoo turns every non-win condition—missed pick, loss, or tie—into a strike.
- ESPN and DraftKings explicitly grade a tie as sufficient to advance.
- OfficePoolStop exposes the result as a league setting because its broader rules engine already supports lives and other variants.

For Only Pools, whose proposed Survivor MVP has no strike system, introducing a strike solely for ties would create a special state with no broader purpose.

### 3. Tie configuration is possible, but it is not necessary for the MVP

OfficePoolStop proves a commissioner-selectable win/loss treatment is workable. It also carries the complexity expected from a mature rules engine: lives, auto-picks, multi-pick weeks, buybacks, and no-survivor resolution. A single fixed MVP rule keeps grading deterministic and the commissioner setup smaller.

## MVP acceptance consequences

- `final = home win` or `final = away win`: entries selecting the winner remain alive; entries selecting the loser are eliminated.
- `final = tie`: entries selecting either team are eliminated.
- Tie elimination is recorded as a direct elimination reason such as `picked_team_tied`, not as a strike.
- The selected team is still part of the immutable pick history. Whether used-team history matters after elimination is irrelevant to current eligibility.
- What happens if a tie eliminates every remaining entry in the same Pool Week is a separate “no survivors / winner resolution” decision and should not change how the individual pick is graded.

## Source scope

Only platform-owned rules, How to Play, and help pages were used. Secondary survivor guides, community pools, Reddit posts, and general sports articles were excluded from the comparison.
