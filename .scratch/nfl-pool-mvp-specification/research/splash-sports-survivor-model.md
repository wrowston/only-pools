# Splash Sports NFL Survivor model

Research date: 2026-07-13

## Scope and source policy

This audit uses first-party Splash Sports legal rules, knowledge-base articles, and product pages only. The NFL-specific legal rules are treated as the strongest authority. Marketing and knowledge-base pages are used to identify product defaults and commissioner options; where they are incomplete or differ in wording from the legal rules, that limitation is called out rather than filled with assumptions.

## Recommended Only Pools MVP rule

Model Splash's simple Survivor core:

- One entry/participant makes one straight-up winning-team pick per included NFL week.
- A team may be used only once by that participant for the contest.
- A win advances the participant. A loss, tie, or missing required pick eliminates them immediately. There are no strikes.
- Thursday and other early games are eligible. An early-game pick locks at that game's scheduled kickoff; otherwise the weekly deadline is Sunday at 1:00 p.m. Eastern.
- Picks stay hidden from opponents until the selected early game starts or the Sunday deadline arrives.
- The last eligible participant wins. If every remaining participant is eliminated in the same week, complete the pool with that entering-week cohort as joint winners. If multiple participants remain after the final included week, they are joint winners.

Do not import Splash's paid-contest shell or advanced variants into the free private-pool MVP: multiple entries per person, buybacks/entry revivals, additional lives, whole-contest revivals, double-pick weeks, auto-picks, Pick Losers, entry fees, prize splits, geographic eligibility, or public/discoverable contest controls.

## Findings

| Topic | Splash core/default behavior | Commissioner option or variant | Documentation limits and MVP implication |
| --- | --- | --- | --- |
| Team reuse | The NFL legal rule is one team per contest unless specific contest rules say otherwise. Splash's general Survivor explainer presents one-use as the normal rule. [NFL Survivor rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules) · [How to play Survivor](https://splashsports.com/knowledge/how-to-play-survivor) | The phrase “unless the contest rules state otherwise” proves exceptions can exist, but the reviewed NFL sources do not publish an NFL commissioner control or its possible values. | Use a fixed one-use-per-participant rule in the MVP. Do not add a reuse setting merely because Splash can publish contest-specific exceptions. |
| Loss, tie, missed pick | Picks are straight up. A winning pick advances; an incorrect pick eliminates. Splash's current general explainer expressly groups losses, ties, and missed picks as elimination. The NFL legal rules expressly make a missed Sunday deadline a loss and elimination. [NFL Survivor rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules) · [How to play Survivor](https://splashsports.com/knowledge/how-to-play-survivor) | NFL legal rules mention separately defined “Pick Losers” contests. | Use direct elimination, not strikes. Exclude Pick Losers. |
| Eligibility state | After a win, an entry advances and is eligible to pick the following week. After an incorrect or missing pick, it is eliminated. Players keep picking only while alive. [NFL Survivor rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules) | Additional lives and entry revivals can defer or reverse elimination in specially configured contests; see below. | The core state machine needs `eligible/alive`, `eliminated`, elimination week and reason, and terminal winner/joint-winner status. No strike counter is needed. |
| Start week and duration | Splash supports season-long and shortened Survivor schedules. An official setup guide says a commissioner can select the contest schedule and “pick any week,” while a current product overview says commissioners can set contest duration. [NFL Survivor setup guide](https://splashsports.com/blog/nfl-how-to-play-survivor-on-splash) · [Supported sports and game modes](https://splashsports.com/knowledge/supported-sports-game-modes) | Survivor Sprint is a shortened variant with a documented four-week minimum; contests shorter than eight weeks require multiple weekly picks. [Survivor Sprint guide](https://splashsports.com/knowledge/a-guide-to-survivor-sprint-building-playing-and-winning) | The precise current NFL start/end-week UI constraints are not documented. Keep Only Pools' already-defined future, not-yet-started regular-season Start Week rule; do not import Sprint constraints or multi-pick requirements. |
| Thursday and early games | An NFL week begins at Thursday Night Football kickoff. Therefore Thursday games are part of Survivor. The weekly pick deadline is Sunday at 1:00 p.m. ET, but a pick on any earlier game is due at that game's scheduled kickoff. The house rules additionally say entries may remain open until Sunday when Thursday is in the slate but is not required. [NFL Survivor rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules) · [House rules](https://legal.splashsports.com/legal/splash-sports-house-rules) | No reviewed first-party NFL source documents a commissioner setting that disables Thursday teams. | Allow Thursday teams. A participant need not choose Thursday; they can wait and choose a later game by Sunday. Do not add a “Thursday allowed” toggle in the MVP. |
| Pick locking and visibility | Earlier-game picks are due by their game's kickoff; all remaining selections close Sunday at 1:00 p.m. ET. Picks are hidden until the early selected game begins or, for later games, until the weekly deadline. [NFL Survivor rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules) | No NFL-specific source reviewed exposes a commissioner-selectable first-game-of-week lock mode. | Splash's model is a hybrid game-kickoff/weekly cutoff, not a Thursday-wide lock. If Only Pools retains the locked brief's two lock modes, describe first-game-of-week locking as an Only Pools option, not Splash parity. |
| Advance picks | None of the reviewed NFL-specific legal, setup, or how-to sources clearly documents placing Survivor picks for future weeks. A 2025 generic FAQ says users may make an entire season's picks, but its example is Pick X and it does not state how future Survivor picks interact with elimination or used-team inventory. [2025 Survivor product page](https://splashsports.com/games/survivor-copy) | Not established for NFL Survivor. | Keep Only Pools' already-defined Provisional Survivor Picks as its own feature. Do not claim this behavior was copied from Splash. |
| Last participant and final week | The last alive participant wins. If two or more remain after Week 18—or after the configured last week of a shorter contest—they are winners and split prizes under Splash's tie rules. [NFL Survivor rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules) | A separate paid-contest prize-split process exists, but it is not needed to determine Survivor eligibility. | Complete an Only Pools pool as soon as one participant is the sole remaining eligible participant after required results are verified. At the final included week, mark all remaining eligible participants joint winners. |
| Everyone remaining is eliminated | The NFL legal rule rolls the result back to “the latest NFL week in which at least one player remained alive.” Splash's 2025 NFL product page describes the standard setting equivalently from the entrants' perspective: if all remaining entrants are eliminated in one week, they split the prize. In either phrasing, the cohort alive entering the fatal week supplies the winners. [NFL Survivor rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules) · [2025 Survivor product page](https://splashsports.com/games/survivor-copy) | “Revivals” can instead restore that whole cohort and continue into the next week. [2025 Survivor product page](https://splashsports.com/games/survivor-copy) | Use the standard terminal result: complete the pool and record the entering-week surviving cohort as joint winners. Exclude whole-contest revival. This must be explicit because the legal and marketing pages describe the same winner cohort using different mechanics (“latest alive week” versus “same-week eliminated entrants”). |
| Multiple entries | Splash allows commissioners to choose one or multiple entries per user. Its house rules impose paid-contest maximums based on total field size, and each entry has its own picks and survival. [How to play Survivor](https://splashsports.com/knowledge/how-to-play-survivor) · [House rules](https://legal.splashsports.com/legal/splash-sports-house-rules) | One versus multiple entries is configurable, subject to Splash limits. | Exclude from the MVP. Model one Survivor participant record per pool member. Multi-entry changes identity, standings, invitations, and used-team ownership and is beyond the locked free private-pool brief. |
| Entry revivals / buybacks | Not part of core single-elimination behavior. When enabled, an eliminated entry can pay to revive after its losing slate ends and before the next slate/deadline. It retains its pick history and previously used teams. [Buyback rules](https://legal.splashsports.com/legal/buyback-rules) | Commissioner sets fee multiplier (1x, 1.5x, 2x, or 3x), maximum revivals (1–8), and a revival deadline (documented slate/round choices 2–10). Each entry is separately eligible. | Exclude. It requires money, post-elimination transactions, deadlines, and reactivation transitions absent from the MVP. |
| Additional lives | A first-party NFL product page documents Additional Lives as a commissioner feature that gives an entry another chance after a losing pick. [2025 Survivor product page](https://splashsports.com/games/survivor-copy) | Commissioner determines the number before the contest starts. | The NFL legal rules reviewed do not define the exact available counts or NFL grading semantics. Exclude; it is Splash's analogue to strikes and conflicts with the accepted no-strike MVP rule. |
| Whole-contest revivals | Not part of the default. If enabled and all remaining entrants lose in the same week, the remaining cohort revives and continues. [2025 Survivor product page](https://splashsports.com/games/survivor-copy) | Commissioner on/off feature. | Exclude. Use the standard joint-winner terminal outcome. |
| Double-pick weeks | The NFL rules allow two or more required picks in certain contests; Splash markets commissioner-selected Double Pick Weeks. [NFL Survivor rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules) · [2025 Survivor product page](https://splashsports.com/games/survivor-copy) | Commissioners may designate double-pick weeks. | Exclude. The locked MVP says one Survivor pick per participant per week. |
| Auto-picks | The reviewed NFL-specific rules say a missed pick eliminates. They do not document an NFL auto-pick option. Splash documents auto-picks in NCAA and player-Survivor rules, which is evidence of a broader platform feature but not sufficient to assert it for NFL team Survivor. [NCAA Survivor rules](https://legal.splashsports.com/legal/survivor-house-rules) | Not established for NFL team Survivor by the reviewed sources. | Exclude and grade a missing required pick as elimination. |

## Thursday decision in implementation terms

Splash does **not** treat Thursday kickoff as the deadline for the entire week. Its NFL-specific contract is:

1. The week includes Thursday through Monday.
2. A participant selecting a Thursday or other pre-Sunday-1:00-p.m. game must save that pick before that game's kickoff.
3. A participant who does not select an early game may continue choosing among later games until Sunday at 1:00 p.m. ET.
4. An early pick becomes visible when its game begins; other picks become visible at the Sunday deadline.
5. A participant with no saved pick at the Sunday deadline is eliminated.

For Only Pools, this supports allowing Thursday selections without a separate pool-level eligibility toggle. Exact boundary handling should remain server-authoritative: a request received at or after the authoritative kickoff/deadline instant is too late.

## End-state decision in implementation terms

Use these terminal outcomes:

- **One survivor after a settled week:** that participant is the winner and the pool completes.
- **Zero survivors after a settled week:** every participant who was eligible entering that week is a joint winner and the pool completes. Preserve their losing/tied/missing elimination reasons in history; winner status is a terminal pool result, not a claim that their picks won.
- **Two or more survivors after the final included regular-season week:** all are joint winners and the pool completes.
- **Unverified or pending result:** do not complete until the results required for the terminal outcome are verified under Only Pools' lifecycle rules.

This matches the practical result of Splash's standard rules while avoiding paid-prize language and excluding its optional revival feature.

## Sources

- [Splash Sports NFL Survivor & Pick'Em Contest Rules](https://legal.splashsports.com/legal/splash-sports-nfl-survivor-pickem-contest-rules)
- [Splash Sports Game Rules (House Rules)](https://legal.splashsports.com/legal/splash-sports-house-rules)
- [Splash Survivor: How to Play](https://splashsports.com/knowledge/how-to-play-survivor)
- [NFL Survivor setup guide](https://splashsports.com/blog/nfl-how-to-play-survivor-on-splash)
- [Supported Sports & Game Modes](https://splashsports.com/knowledge/supported-sports-game-modes)
- [Survivor Sprint guide](https://splashsports.com/knowledge/a-guide-to-survivor-sprint-building-playing-and-winning)
- [Splash Sports Buyback Rules](https://legal.splashsports.com/legal/buyback-rules)
- [2025 NFL Survivor product page](https://splashsports.com/games/survivor-copy)
- [Splash Sports NCAA Survivor rules](https://legal.splashsports.com/legal/survivor-house-rules) (used only to avoid incorrectly projecting its documented auto-pick option onto NFL Survivor)
