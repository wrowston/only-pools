Type: grilling
Status: resolved
Blocked by: 01

# Settle survivor rules and participant state

## Question

What exact MVP rulebook and state machine should govern Survivor Picks and participant survival, including team reuse across effective and Provisional Survivor Picks, strikes, ties, missing picks, Thursday eligibility, start-week behavior, future-pick invalidation after elimination, and any end-of-season outcome?

## Comments

- The MVP has no Strike system. A participant advances only when their selected team wins; a loss, tie, or missing required Survivor Pick eliminates them immediately. The market comparison supporting explicit tie treatment is recorded in [NFL Survivor tie-rule research](../research/survivor-tie-rules.md).
- Survivor uses a fixed one-use-per-participant rule. Every valid accepted Survivor Pick, including a Provisional Survivor Pick, reserves its selected team so the same participant cannot select that team in another Pool Week. Changing an unlocked pick releases its former team; elimination invalidates later provisional picks.
- Every scheduled team in a Pool Week is eligible for a Survivor Pick, including a team playing Thursday or another early game. There is no commissioner eligibility toggle. Exact Pick Lock timing and visibility remain with [Define pick submission, locking, and visibility](./05-define-pick-submission-locking-visibility.md). The adopted core and Splash comparison are documented in [Splash Sports NFL Survivor model](../research/splash-sports-survivor-model.md).
- If a settled Pool Week eliminates every participant who entered it Alive, the Pool completes and that entering-week cohort becomes joint Survivor Winners. Each participant's actual elimination reason remains in history; the Pool does not revive or replay them.
- After a settled Pool Week, a sole remaining Alive Participant becomes the Survivor Winner and the Pool completes immediately. If multiple participants remain Alive after the final included Pool Week, they become joint Survivor Winners and the Pool completes.

## Answer

### Fixed MVP rulebook

- Survivor is single-elimination. There is no Strike, life, revival, buyback, auto-pick, or commissioner override.
- Each Alive Participant must make exactly one Survivor Pick for every included Pool Week beginning with the Pool's Start Week.
- The participant advances only if the selected team wins. A verified loss, verified tie, or missing required Survivor Pick eliminates the participant.
- Every scheduled team in the Pool Week is eligible, including a team playing Thursday or another early game. There is no Thursday-eligibility setting.
- Picks are straight-up NFL game-winner selections. Spreads, multiple-pick weeks, Pick Losers, and playoff rounds are outside the MVP.

### One-use-per-participant

- A participant may select each NFL team in at most one valid Survivor Pick during the Pool Season.
- Every accepted pick reserves its team immediately, including a Provisional Survivor Pick, so the participant cannot hold the same team in two Pool Weeks.
- Changing an unlocked pick releases its former team and reserves the replacement. Exact edit and Pick Lock boundaries belong to [Define pick submission, locking, and visibility](./05-define-pick-submission-locking-visibility.md).
- When a pick becomes effective, its team is part of immutable used-team history regardless of whether the team wins, loses, or ties.
- If an earlier elimination invalidates later Provisional Survivor Picks, those later teams are not consumed. Their invalidated selections remain in audit history but never become used teams.

### Participant and weekly outcome state

- A participating Pool Membership begins the Start Week as Alive. Alive and Eliminated are the only competitive eligibility states; winner status is a separate terminal Pool outcome.
- An Alive Participant may submit picks for every published Pickable Week. A later pick is Provisional until the participant has advanced through every earlier included week.
- A participant with an unresolved earlier result remains eligible to make later Provisional Survivor Picks. Pending Weeks never block later participation.
- Weekly eligibility resolves strictly in Pool Week order. A later game's result may be known, but it does not affect eligibility until all earlier Survivor outcomes for that participant have resolved.
- If the earlier outcome advances the participant, the next known result applies immediately. If it eliminates them, every later Provisional Survivor Pick is invalidated without consuming its team.
- A missing pick eliminates the participant when that week's final applicable Pick Lock passes without an accepted Survivor Pick. Loss and tie eliminations require a Verified Result. Each elimination records its Pool Week and reason: missing pick, selected-team loss, or selected-team tie.
- Elimination is permanent for the Pool Season. The participant cannot make further picks, but retains read-only access to their pick and result history subject to the Pool's membership and archive rules.

### Terminal outcomes

- After the relevant results are verified and the Pool Week is successfully applied, a sole remaining Alive Participant becomes the Survivor Winner and the Pool completes immediately.
- If a settled Pool Week eliminates every participant who entered it Alive, that entire entering-week cohort becomes joint Survivor Winners and the Pool completes. Their individual loss, tie, or missing-pick elimination reasons remain intact; the winner designation does not rewrite their weekly results.
- If two or more participants remain Alive after the final included regular-season Pool Week, all become joint Survivor Winners and the Pool completes.
- A Pending Week or unverified result cannot establish a terminal outcome. A later correction may change elimination and winner designations and return a Completed Pool to Active under [Define the pool and season lifecycle](./01-define-pool-season-lifecycle.md).

The adopted core follows the researched Splash Sports model while excluding its paid and advanced variants. Supporting comparisons are in [Splash Sports NFL Survivor model](../research/splash-sports-survivor-model.md) and [NFL Survivor tie-rule research](../research/survivor-tie-rules.md).
