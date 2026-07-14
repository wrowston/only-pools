Type: grilling
Status: resolved
Blocked by: 03, 04, 05, 07, 08

# Define scoring, standings, and recalculation guarantees

## Question

What source-of-truth, materialization, versioning, idempotency, ordering, and audit guarantees should govern scoring, Weekly Standings, Season Standings, possible-points updates, automatic recomputation, and Production Operator-controlled repair without exposing inconsistent results to participants?

## Comments

- Official Weekly Standings update progressively as each Verified Result is successfully scored. Projected weekly points and ranks may update from live or provisionally final data but remain visibly non-official. The official Season Standing includes only fully resolved Pool Weeks and advances atomically after every Required Confidence Game in the week is resolved and the week's scoring succeeds; a postponed or Pending game can therefore delay that advance without suppressing verified weekly progress.
- Applying one Verified Result is atomic within each affected Pool Week: every affected pick outcome, Weekly Standing row and rank, Possible Remaining Points value, and Survivor eligibility or outcome change publishes together. Different Pools may complete independently. A failed Pool update retains its prior internally consistent official state and surfaces scoring as pending rather than exposing partially updated participant rows.
- Scoring and recalculation are deterministic replays from authoritative competitive inputs: the frozen Pool Ruleset and Pick Sheet, valid accepted or automatically created picks and locked omissions, applicable membership history, and the current Verified or Corrected Results. Pick outcomes, standings, Survivor eligibility, used-team history, and winner designations are rebuildable projections and never become inputs to later scoring. Neither automatic nor Production Operator-controlled repair can alter authoritative inputs.
- Every successfully published official Pool-Week update creates an immutable Scoring Revision that records its authoritative input versions, cause, publication time, and resulting projection version. The Pool Week identifies its current revision; an identical authoritative input fingerprint is an idempotent no-op, while superseded revisions remain auditable for the Pool's lifetime.
- Each scoring attempt reads and replays the latest complete authoritative input set instead of applying its trigger as an isolated delta. Concurrent triggers may coalesce and a newer attempt may subsume an older one; revision guards prevent a stale attempt from overwriting a newer Scoring Revision. NFL Games may verify in any order within a week, while Survivor eligibility and downstream outcomes always replay in Pool Week order.
- Official Possible Remaining Points are derived only from Pick Locks and Verified or Corrected Results and publish with the Pool Week's Scoring Revision. An unresolved valid prediction remains possible regardless of its live score. Separate, clearly provisional projections may reflect live or provisionally final outcomes but cannot replace or alter the official value.
- Pool Owners and Pool Admins cannot trigger provider resynchronization, standings recalculation, or scoring repair. The system owns automatic recovery; when that is insufficient, only the Production Operator may initiate an audited resynchronization or deterministic replay. The operator may identify an earliest suspect Pool Week, but the system expands the replay to the complete safe dependency scope and never permits authoritative competitive inputs to be edited. Pool participants see clear incident and repair status without receiving operational controls.
- Scoring or repair work never creates a Pool-wide maintenance lock. Participants continue normal valid picking against the last consistent official state; later Survivor picks remain provisional under the settled eligibility rules. Affected views retain their prior official revision and show a clear scoring-delayed or repair-in-progress status until a replacement revision publishes successfully.
- Participants, Pool Owners, and Pool Admins see current official values plus understandable correction or repair notices when an outcome changes; they do not see internal retries, input fingerprints, or every routine Scoring Revision. The Production Operator receives the full revision lineage, causes, attempts, failures, and replay diagnostics under the restricted operational audit boundary.
- A Corrected Result for an earlier completed Pool Week immediately rebuilds the Season Standing through the latest fully completed week; any currently active or Pending later week remains excluded until it completes. Such corrections are expected to be rare and use the same ordinary deterministic replay path rather than a separate product workflow.

## Answer

### Authoritative inputs and derived projections

- The source of truth is the frozen Pool Ruleset and Pick Sheet, applicable membership history, valid accepted or automatically created picks and locked omissions, and current Verified or Corrected Results.
- Pick outcomes, Weekly Standings, Season Standings, Possible Remaining Points, Survivor eligibility, used-team history, and winner designations are materialized projections. They are always rebuildable from authoritative inputs and never seed later scoring.
- Scoring and repair use one deterministic replay path. Neither automatic recovery nor Production Operator action may edit authoritative NFL facts or competitive inputs.

### Progressive weekly scoring and completed-week season standings

- Official Weekly Standings update progressively after each Verified Result is successfully scored. Live and provisionally final data may update clearly labeled projections but cannot affect official points, ranks, eligibility, or winners.
- Each Verified Result publishes atomically within an affected Pool Week: every affected pick outcome, Weekly Standing row and rank, official Possible Remaining Points value, and Survivor eligibility or outcome change moves together. Different Pools may complete independently.
- Official Possible Remaining Points use only Pick Locks and Verified or Corrected Results. An unresolved valid prediction remains possible regardless of its current live score.
- The official Season Standing contains only fully resolved Pool Weeks and advances atomically when the entire week's required scoring succeeds. A postponed or Pending game may delay this advance without suppressing verified weekly progress.
- A later correction to an earlier completed week immediately rebuilds the Season Standing through the latest fully completed week; the active week remains excluded until complete.

### Scoring Revisions, ordering, and idempotency

- Every successfully published official Pool-Week state is an immutable Scoring Revision containing its authoritative input versions, cause, publication time, and resulting projection version. Superseded revisions remain for the Pool's lifetime.
- An identical authoritative input fingerprint is an idempotent no-op. Concurrent triggers may coalesce, a newer attempt may subsume an older one, and revision guards prevent stale work from overwriting a newer official state.
- Every attempt reads the latest complete authoritative input set rather than applying its trigger as an isolated delta. NFL Games may verify in any order within a week; Survivor eligibility and all downstream outcomes replay strictly in Pool Week order.
- A failed update leaves the prior internally consistent Scoring Revision official and marks scoring as delayed. No participant row or related derived value publishes partially.

### Recovery authority and continued operation

- Automatic recovery belongs to the system. If it is insufficient, only the Production Operator may initiate audited provider resynchronization or deterministic replay; Pool Owners and Pool Admins receive status but no operational controls.
- The Production Operator may identify the earliest suspect Pool Week, but the system expands to the complete safe dependency scope. Confidence repair covers the affected week and applicable Season Standing; Survivor repair covers the affected week and every later included week.
- Scoring or repair never creates a Pool-wide maintenance lock. Valid picking continues against the last consistent official state, with later Survivor picks remaining provisional under the settled rules.

### Audit and participant communication

- Participants and Pool roles see the current official values, scoring-delayed or repair-in-progress status, and understandable correction or repair notices when an outcome changes.
- Internal retries, fingerprints, and routine Scoring Revision lineage remain hidden from Pool participants. The Production Operator receives detailed revision causes, attempts, failures, and replay diagnostics under the restricted operational audit boundary.
- Exact retry timing, alert thresholds, and operational response objectives belong to the later production trust and synchronization scheduling decisions.
