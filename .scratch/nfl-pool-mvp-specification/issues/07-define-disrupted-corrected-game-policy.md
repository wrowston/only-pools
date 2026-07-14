Type: grilling
Status: resolved
Blocked by: 03, 04, 06

# Define disrupted and corrected game policy

## Question

How should Survivor and Confidence Pools behave when NFL games are tied, forfeited, postponed, rescheduled, suspended, canceled, delayed in finalization, or corrected after scoring, including the effect on Pick Locks, results, standings, participant communication, and commissioner recovery?

## Answer

### Authority, finality, and projections

- A first TheSportsDB `FT` or `AOT` observation is provisional. It may drive clearly labeled Projected Results, but it cannot establish elimination, official points or ranks, winner designations, or Pool completion.
- Because TheSportsDB has no provider-issued closed state, a game affects official competition only after the selected-provider contract in [Select the production NFL data provider](./16-select-production-nfl-data-provider.md) confirms the same terminal status and score through repeated observations and the outcome becomes a Verified Result. Delayed or contradictory confirmation leaves the affected Pool Week Pending; it never causes the app to assume a winner or final score.
- Participants may see live scores, projected Confidence points and ranks, and projected Survivor advancement or elimination after the applicable picks become visible. Official standings and eligibility remain on the last successfully applied Verified Results.
- A later Confidence Pick Window may open under the settled lifecycle while an earlier disrupted Pool Week remains formally Pending.

### Disrupted game identity and Pool Week membership

- Once a Confidence Pick Sheet freezes, every Required Confidence Game remains attached to that original Pool Week through a delay, suspension, postponement, or reschedule, including a move into a later NFL week.
- Once a Survivor Pick locks, its selected game likewise remains attached to that pick's original Pool Week until it yields a Verified Result or authoritative cancellation.
- A moved game that remains attached to an earlier frozen Pool Week must not also count as a new competitive game in a later Pool Week. Provider replacement records and cross-week reschedule links represent one logical competitive game; [Design the provider normalization and synchronization contract](./08-design-provider-normalization-sync-contract.md) must preserve that invariant.
- Before either boundary, authoritative schedule membership may still change. A Survivor Pick whose game leaves its target Pool Week before locking is invalidated, releases its team reservation, and may be replaced within the remaining Pick Window.
- Delayed, suspended, postponed, or rescheduled games remain unresolved rather than receiving a synthetic result. A suspension that resumes keeps the same competitive game; if it ultimately becomes canceled, the cancellation rules apply.

### Pick Locks under schedule disruption

- An authoritative kickoff change moves an unreached Game Kickoff Lock earlier or later. If a game is marked Postponed before locking and its kickoff is withdrawn without a replacement, its Game Kickoff Lock waits for a new authoritative kickoff.
- Weekly Cutoff Lock remains Sunday at 1:00 p.m. Eastern even when a remaining game is postponed without a replacement time.
- A `Delayed` status alone does not extend a lock. Its authoritative kickoff must change; otherwise the existing scheduled kickoff remains the lock boundary.
- Every reached Pick Lock is irreversible. A postponement, suspension, reschedule, or later kickoff never reopens it.
- If stale schedule data causes the server to accept an edit at or after the actual authoritative lock, reconciliation retracts the late edit and restores the last valid pre-lock state. If no such state exists, the normal missing-pick, locked-omission, or untouched Automatic Confidence Pick Set rule applies. The mistaken acceptance and repair remain audited and are surfaced to the affected participant.

### Ties, forfeits, and cancellations

- A Verified Result that is tied eliminates a Survivor participant, as already settled. In Confidence, neither team prediction is correct, so the game awards zero points and confidence values are not redistributed. A tied game's verified combined score remains usable for its Weekly Tiebreaker Prediction.
- A closed forfeit with an authoritative declared winner is scored as a win and loss for Survivor and Confidence; it is not a cancellation or No-Contest Advance.
- If a Survivor game's cancellation is authoritative before its pick locks, the pick is invalidated, its team reservation is released, and the participant must replace it before the week's remaining lock window closes. Failure to replace it follows the ordinary missing-pick rule.
- If cancellation becomes authoritative only after the Survivor Pick locked, the participant receives a No-Contest Advance. They remain Alive without a win, and the selected team remains consumed in used-team history.
- A Confidence game canceled before its Pick Sheet freezes is excluded from that sheet. If canceled after the sheet freezes, its slot and assigned confidence value remain in the historical set, every prediction for it earns zero, and values are neither renumbered nor redistributed.
- The Weekly Tiebreaker Prediction's designated matchup freezes with the Pick Sheet. A reschedule never switches it to another matchup. If that game is canceled, or a forfeit closes without a usable official combined score, the tiebreaker is unavailable and participants still tied on weekly points share rank. Predictions are never applied to another game or a synthetic score.

### Corrected Results and deterministic replay

- An authoritative correction automatically supersedes the prior Verified Result. Commissioner approval is neither required nor permitted.
- The correction recalculates affected Confidence game points, possible points, Weekly Standings, Weekly Tiebreaker results, Season Standings, Survivor elimination, used-team history, later Provisional Survivor Picks, and winner designations in Pool Week order.
- If a correction restores earlier Survivor eligibility, every later Provisional Survivor Pick that was validly accepted before its own lock is reinstated and resolved in order. Reinstatement is not a late submission. A locked later week for which no pick was previously accepted still produces the normal missing-pick elimination.
- If a correction moves elimination earlier, later picks become invalid without consuming their teams, consistent with the settled Survivor replay rules.
- A correction may remove a terminal result and automatically return a Completed Pool to Active. Archived Pools continue processing corrections beneath the archive overlay.
- Known authoritative corrections have no arbitrary age cutoff. The production operating decision may set how long old games are proactively polled, but whenever a correction is learned through synchronization or authorized recalculation, it must be applied.
- Every repair preserves the previous result, replacement result, affected derived outcomes, transition time, and cause in audit history.

### Participant communication and recovery authority

- Wherever an affected game or standing appears, the UI identifies its current state: delayed, suspended, postponed, provisional final, canceled, verified, or corrected. It shows the current kickoff or resumption time when known, the last successful data refresh, a stale-data warning when applicable, whether picks are locked, and why a Pool Week remains Pending.
- Projected Results are visually distinct from official results. A correction shows the prior and corrected outcomes, affected standings or eligibility, and repair time. A prominent pool-level correction notice remains until viewed.
- MVP communication is in-product. Email, push, reminders, and recap notifications remain outside this effort's scope.
- Pool Owners and Pool Admins may request provider resynchronization and deterministic recalculation. They cannot declare a winner or cancellation, enter or edit an NFL score, accept a provisional final, reopen a Pick Lock, suppress a Corrected Result, or otherwise override authoritative NFL data.
- If synchronization or provider truth remains unavailable, the Pool Week stays visibly Pending until operator recovery obtains an authoritative result. Manual result overrides remain outside the MVP.
