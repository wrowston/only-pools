Type: grilling
Status: resolved
Blocked by: 03, 04

# Define pick submission, locking, and visibility

## Question

What server-authoritative initialization, submission, edit, Pick Lock, and opponent-visibility contract should apply to each pool type under Game Kickoff Lock and Weekly Cutoff Lock, including exact boundary-time rules, advance Provisional Survivor Picks, the Default Confidence Ranking, partial Confidence Pick Set behavior, the trigger and later editability of an Automatic Confidence Pick Set, and what participants see before and after each lock?

## Comments

- Game Kickoff Lock is genuinely per-game. A Survivor Pick locks with its selected game; each Confidence prediction and assigned value locks with its game, while unstarted games remain editable and may exchange their still-available values.
- Every game-based lock uses the earliest authoritative signal: the server reaching the game's current scheduled kickoff or the normalized provider state reporting that play has started. Acceptance is determined server-side at the mutation boundary.
- Weekly Cutoff Lock replaces the architecture brief's First Game of Week Lock for both pool types. Earlier games lock individually; Sunday at 1:00 p.m. Eastern freezes every remaining Survivor or Confidence choice, remaining confidence-value assignment, and Weekly Tiebreaker Prediction.
- Each choice becomes visible to every participant when—and only when—it locks. Participants always see their own choices. Pool Owners and Pool Admins may see whether a participant has submitted or completed the required picks, but receive no privileged access to Hidden Picks.
- Under Game Kickoff Lock, a Survivor participant without a saved pick remains eligible while any team in the week has an unlocked game; missing-pick elimination occurs when the last eligible game locks. Under Weekly Cutoff Lock, an unsubmitted participant is eliminated at the Sunday cutoff.
- A Provisional Survivor Pick locks under its own target week's normal rules even while an earlier week is Pending. A later earlier-week elimination invalidates the provisional pick without consuming its team, but never reopens a Pick Lock that already passed.
- A Confidence Pick Set becomes participant-started when the server accepts any winner prediction, confidence-value reorder, or Weekly Tiebreaker Prediction. Merely viewing the Pick Sheet or making unaccepted client-side changes does not start it; only a truly untouched set is eligible for automatic home-team predictions.
- Automatic creation locks only the components due at that instant. Under Game Kickoff Lock, later automatic home-team predictions and still-available confidence values remain editable until their own locks; under Weekly Cutoff Lock, the cutoff locks every remaining component. The set retains an automatic-origin marker after later edits.
- A multi-edit Confidence mutation applies every independently valid unlocked change and rejects invalid or newly locked changes. Its response must identify each accepted and rejected edit, explain every rejection, and return the resulting authoritative Pick Set; partial acceptance is never silent.
- Under Game Kickoff Lock, the Weekly Tiebreaker Prediction locks with its designated chronologically last scheduled Required Confidence Game. Under Weekly Cutoff Lock, it freezes at the Sunday cutoff with every other remaining component.
- The Pool's selected Pick Lock mode freezes at the earlier of the server accepting its first competitive pick/edit or any included game reaching a Pick Lock event. It cannot change by week or after that boundary, even when no participant submitted before play began.
- Only a participant may submit or edit their own picks. Pool Owners and Pool Admins cannot inspect Hidden Picks or submit, change, unlock, or backfill another participant's choices. The deterministic Automatic Confidence Pick Set process is the only non-participant author.
- When a Confidence Pick Window opens, the server publishes the frozen Pick Sheet and Default Confidence Ranking as the authoritative initial set for every eligible participant, regardless of whether they visit. Immediate versus lazy per-participant persistence remains an implementation decision so long as behavior is identical.
- When a choice locks and becomes visible, every participant also sees whether it was participant-authored, automatically created, or a locked omission. Survivor exposes "No pick" only after missing-pick elimination; no origin or omission status leaks to opponents before its lock.
- The pick interface autosaves without an explicit Save button. Each winner-prediction edit, Weekly Tiebreaker Prediction edit, and confidence-value reorder gesture invokes a server mutation immediately. A reorder is one atomic value permutation; it applies wholly or fails wholly, while other independently valid edits may still succeed and previously accepted edits remain saved.
- Confidence-value uniqueness is enforced twice. The client interaction prevents selecting or producing a duplicate value and represents reordering as a valid permutation; the server independently validates the complete resulting assignment and rejects any mutation that would violate uniqueness, regardless of client behavior.

## Answer

### Authoritative Pick Locks

- The MVP supports two Pool Ruleset modes: Game Kickoff Lock and Weekly Cutoff Lock. Game Kickoff Lock remains the default.
- A game reaches its Game Kickoff Lock at the earlier of the server reaching its current authoritative scheduled kickoff or the normalized provider state reporting that play has started. A server mutation evaluated at or after that instant is too late; there is no grace period, client-clock authority, or later acceptance because provider polling lagged.
- Under Game Kickoff Lock, a Survivor Pick locks with its selected game. Each Confidence prediction and its assigned confidence value lock with its game; still-unlocked games may exchange only their still-available values.
- Weekly Cutoff Lock replaces the architecture brief's First Game of Week Lock. Games before the cutoff still lock individually under Game Kickoff Lock. At Sunday 1:00 p.m. in `America/New_York`, every remaining Survivor choice, Confidence prediction, confidence-value assignment, and Weekly Tiebreaker Prediction locks together.
- The Pool's lock mode becomes immutable at the earlier of the first server-accepted competitive edit or the first Pick Lock event in an included game. It cannot vary by week or change retroactively when nobody submitted.
- Client lock indicators prevent obviously late edits, but every mutation rechecks authentication, Pool Membership, competitive eligibility, current authoritative time and game state, lock mode, and pool-type invariants on the server.

### Survivor submission and advance picks

- Only an Alive Participant may submit or replace their own Survivor Pick. A valid replacement atomically releases the former team's reservation and reserves the new team; a rejected replacement changes neither.
- Under Game Kickoff Lock, a participant without a saved pick may choose any team whose game remains unlocked. Missing-pick elimination occurs when the last eligible game locks. Under Weekly Cutoff Lock, an unsubmitted participant is eliminated at the Sunday cutoff.
- A Provisional Survivor Pick follows its target Pool Week's normal lock rules even while an earlier Pool Week is Pending. An earlier elimination invalidates it without consuming its team, but never reopens a lock that already passed.
- Pool Owners and Pool Admins cannot submit, change, unlock, or backfill another participant's Survivor Pick.

### Confidence initialization and autosave

- When a Confidence Pick Window opens, the server publishes one frozen Pick Sheet and its Default Confidence Ranking as the authoritative initial set for every eligible participant, whether or not they visit. Every game has one unique assigned confidence value and begins with a blank winner prediction.
- The interaction autosaves without a Save button. Each accepted winner prediction, Weekly Tiebreaker Prediction, or confidence-value reorder is persisted immediately and makes the set participant-started; viewing the page or making an unaccepted local change does not.
- A participant-started set may remain incomplete. When a blank prediction locks, it becomes a visible omission worth zero while valid predictions and later unlocked components continue normally.
- If the first Required Confidence Game locks while the set is still completely untouched, the server creates an Automatic Confidence Pick Set with home-team predictions and the Default Confidence Ranking. Only components due at that instant lock. Under Game Kickoff Lock, later automatic predictions and still-available values remain editable; under Weekly Cutoff Lock, the cutoff freezes every remaining component. Automatic origin remains recorded after later participant edits.
- Each prediction edit and the tiebreaker edit is an independent autosave unit. Each confidence-value reorder gesture is one atomic permutation: every value move in that gesture succeeds or the reorder fails without change.
- A request containing independent edit units applies each valid unlocked unit and rejects each invalid or newly locked unit. The response identifies every acceptance and rejection, explains failures, and returns the resulting authoritative set; partial success is never silent and never rolls back previously accepted autosaves.
- The client prevents selecting or producing duplicate confidence values. The server independently validates the complete resulting assignment and rejects any mutation that would violate uniqueness, range, or the locked-value boundary, regardless of client behavior.
- Under Game Kickoff Lock, the Weekly Tiebreaker Prediction locks with its designated chronologically last scheduled Required Confidence Game. Under Weekly Cutoff Lock, it locks at the Sunday cutoff.

### Authorship and visibility

- Participants always see their own current choices and the server-confirmed save or rejection state. Only a participant may author their picks; Pool authority never grants pick authority. The deterministic Automatic Confidence Pick Set process is the only non-participant author.
- Every opponent choice is a Hidden Pick until its own Pick Lock. Pool Owners and Pool Admins may see coarse submission-completion state for commissioner recovery, but cannot see Hidden Pick content.
- A locked Survivor Pick or Confidence prediction and value becomes visible to every current participant immediately; other unlocked choices remain hidden. A locked Weekly Tiebreaker Prediction follows the same rule.
- Revealed content identifies participant-authored predictions, automatically created predictions, and locked omissions distinctly. Survivor exposes `No pick` only after missing-pick elimination. No choice provenance or omission status leaks to opponents before the applicable lock.
