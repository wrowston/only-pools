# NFL Pool

This context describes private NFL prediction competitions and the language shared by participants and commissioners.

## Pools and people

**Pool**:
A private NFL competition with one unchanging pool type, one Pool Season, a ruleset, and a membership.
_Avoid_: League, group

**Pool Season**:
The current NFL regular season selected when a Pool is created and within which all of that Pool's competitive weeks occur; it never changes for that Pool and excludes the postseason.
_Avoid_: League year, year

**Pool Ruleset**:
A Pool's outcome-affecting rules, including its Pick Lock mode, shared by every participant. It becomes immutable at the earlier of the first server-accepted competitive edit or the first included game reaching a Pick Lock.
_Avoid_: Settings, configuration

**Pool Template**:
Reusable setup from a prior-season Pool that can prefill its name, Pool Type, Pool Ruleset, locking mode, valid Start Week preference, and proposed invite roles without carrying competitive identity or history.
_Avoid_: Pool clone, rollover, renewal

**Active Pool**:
A Pool that has been created and whose final included week has not been resolved.
_Avoid_: Live Pool, open Pool

**Completed Pool**:
A Pool whose rules have reached a terminal outcome and whose required results have been verified and scored; competition is closed while historical viewing, ownership transfer, administrative role changes among existing participants, and authorized result repair remain available, but corrected results can return it to Active.
_Avoid_: Finished Pool, ended Pool

**Archived Pool**:
A Pool placed in a reversible, read-only administrative status that preserves its history and does not pause its underlying Active or Completed lifecycle while moving it from participants' normal views into their archived history; ownership transfer remains available, but other role changes require restoration.
_Avoid_: Deleted Pool, closed Pool

**Survivor Pool**:
A Pool in which each participant chooses one team for a week and remains alive by satisfying the Pool's survivor rules.
_Avoid_: Elimination pool, suicide pool

**Confidence Pool**:
A Pool in which each participant predicts the winners of a week's required games and assigns a unique confidence value to each prediction.
_Avoid_: Pick'em, confidence league

**Pool Owner**:
The single participant who holds a Pool's ultimate authority, including ownership transfer, role administration, archival, restoration, and pre-freeze Pool Ruleset changes; they remain Owner until a current Pool Admin explicitly accepts an offered transfer, at which point the former Owner becomes a Pool Admin.
_Avoid_: Creator, commissioner

**Pool Admin**:
A participant delegated limited Pool-management authority by the Pool Owner; a Pool Admin may manage ordinary Pool Invites, remove Pool Members, and request recalculation, but cannot alter administrative roles or act on the Pool Owner or another Pool Admin.
_Avoid_: Moderator

**Pool Member**:
A participant who belongs to a Pool without ownership or delegated administration authority.
_Avoid_: User, player

**Participant**:
Any person competing in a Pool, regardless of whether they are also its Pool Owner or a Pool Admin.
_Avoid_: User, player

**Pool Membership**:
A person's participation relationship with one Pool; the participant may leave voluntarily only until every required Start Week game has a Verified Result and that Pool Week has been successfully scored. Administrative removal ends access and future picking but preserves accepted picks, results, and standings under a visible Removed status. Voluntary departure may be reactivated through a valid Pool Invite, while removal requires explicit, audited reinstatement by the Pool Owner; neither path restores expired opportunities or former administrative authority.
_Avoid_: Enrollment, subscription

**Pool Invite**:
A reusable, shareable, revocable invitation that permits an authenticated person to explicitly join one Active Pool as a Pool Member; it expires after 30 days by default, can be renewed, and cannot be accepted at or after the scheduled kickoff of the earliest Start Week game or while the Pool is Completed or Archived. A later reschedule never reopens admission after that cutoff has passed.
_Avoid_: Join link, invitation code

**Returning Participant Invite**:
A person-specific, single-use Pool Invite created from a Pool Template for a prior participant without enrolling them automatically; only the Pool Owner may use one to propose the Pool Admin role.
_Avoid_: Copied membership, renewed membership

**Pool Audit Event**:
An immutable account of a Pool authority or membership change, identifying when it occurred, who acted, who was affected, the action, and the prior and resulting state without retaining a raw Pool Invite credential.
_Avoid_: Activity log, history entry

## Picks and results

**Pool Week**:
An NFL season week included in a Pool's competition.
_Avoid_: Game week

**Pick Sheet**:
The ordered list of a Pool Week's Required Confidence Games presented identically to every participant and frozen when that week's Pick Window opens. Its order determines the Default Confidence Ranking, including the relative order of games with the same scheduled kickoff.
_Avoid_: Slate order, personal game order

**Start Week**:
The first regular-season Pool Week included in a Pool; its first NFL game must not have kicked off when the Pool is created, and it becomes immutable when the Pool accepts its first pick.
_Avoid_: Opening week, beginning week

**Pickable Week**:
A Pool Week with a published slate whose Pick Window is open; a Survivor Pool may have several Pickable Weeks at once, while a Confidence Pool has at most one.
_Avoid_: Current week, active week

**Pending Week**:
An earlier Pool Week that still has at least one result required to settle its Pool outcome or standings.
_Avoid_: Current week, delayed week

**Verified Result**:
An NFL game outcome confirmed by the authoritative data source and successfully applied to the Pool's competitive results.
_Avoid_: Final score, provisional result

**Pick Window**:
The period in which a participant may submit or change picks for one included Pool week, subject to that Pool's Pick Locks.
_Avoid_: Picking period, submission window

**Survivor Pick**:
A participant's selected NFL team for one week of a Survivor Pool. Survivor Pools use a one-use-per-participant rule: the participant cannot hold valid Survivor Picks selecting the same team in multiple Pool Weeks. Every scheduled team in the Pool Week is eligible, including teams playing Thursday or another early game.
_Avoid_: Selection, choice

**Provisional Survivor Pick**:
A Survivor Pick for a future Pool Week, or a later Pool Week played while an earlier Survivor outcome is Pending, that takes effect only if the participant advances through every earlier week and locks under its own target week's rules. It reserves its selected team while valid; earlier elimination invalidates it without consuming the team or reopening a lock that already passed.
_Avoid_: Future pick, queued pick

**Alive Participant**:
A Survivor Pool participant who remains eligible to submit Survivor Picks; only a win by the selected team advances them, while a loss, tie, or missing required Survivor Pick eliminates them immediately.
_Avoid_: Active player, surviving user

**Eliminated Participant**:
A Survivor Pool participant who is no longer eligible to submit Survivor Picks because their selected team lost or tied, or because they failed to make a required Survivor Pick; elimination is immediate and does not use strikes.
_Avoid_: Struck-out player, dead player

**Survivor Winner**:
A terminal designation for the sole Alive Participant remaining after a settled Pool Week, which completes the Pool immediately. If one settled Pool Week eliminates every participant who entered it Alive, that entire entering-week cohort becomes joint Survivor Winners even though each participant's elimination reason remains in competitive history. If multiple participants remain Alive after the final included Pool Week, they become joint Survivor Winners.
_Avoid_: Champion, last man standing

**Confidence Pick Set**:
A participant's collection of game-winner predictions and confidence values for one week of a Confidence Pool, established from the server-published Pick Sheet and Default Confidence Ranking when its Pick Window opens. Every Required Confidence Game always has one unique value even while its prediction is blank; a locked blank in a participant-started set earns zero, while a completely untouched set becomes an Automatic Confidence Pick Set at the first lock.
_Avoid_: Picks, ballot

**Participant-Started Confidence Pick Set**:
A Confidence Pick Set for which the server has accepted at least one winner prediction, confidence-value reorder, or Weekly Tiebreaker Prediction; viewing or locally editing a Pick Sheet without an accepted change does not start it.
_Avoid_: Submitted picks, active ballot

**Required Confidence Game**:
Every NFL regular-season game in the synchronized slate for a Confidence Pool's Pool Week. All are included in every participant's Confidence Pick Set; Pool Owners cannot omit selected games.
_Avoid_: Optional game, commissioner-selected game

**Incomplete Confidence Pick Set**:
A participant-started Confidence Pick Set missing a valid prediction for one or more required games when those games lock. Each missing prediction earns zero, while the participant's other valid locked predictions score normally and the participant remains included in the Weekly Standing.
_Avoid_: Invalid ballot, disqualified week

**Automatic Confidence Pick Set**:
The fallback Confidence Pick Set created when the first Required Confidence Game locks and the participant's set is still untouched. It predicts every home team and begins with the Default Confidence Ranking; components then lock normally while later unlocked predictions and still-available values remain editable, with automatic origin retained for explanation and audit.
_Avoid_: Missed week, default picks

**Confidence Scale**:
The season-wide confidence-value range ending at the maximum possible number of NFL games in one regular-season week. For a Pool Week with fewer required games, the lowest values are unavailable so every required game still receives one unique value; with a maximum of 16, a 14-game week uses 3 through 16.
_Avoid_: Weekly confidence range, point scale

**Default Confidence Ranking**:
The initial assignment of a Pool Week's Confidence Scale values to every participant's Required Confidence Games, descending from the maximum value through the Pick Sheet's game order. A participant may reorder these values before their applicable Pick Locks.
_Avoid_: Automatic picks, missed-pick ranking

**Possible Remaining Points**:
The confidence points a participant can still legally earn in an unresolved Pool Week. It includes values still achievable through valid submissions for unlocked Required Confidence Games and unresolved valid predictions, but excludes games that locked without a valid prediction and predictions already known to be incorrect.
_Avoid_: Projected points, expected points

**Pick Lock**:
The point after which a Survivor Pick or part or all of a Confidence Pick Set can no longer be submitted or changed.
_Avoid_: Deadline, freeze

**Game Kickoff Lock**:
A Pick Lock mode in which a Survivor Pick locks at the earlier of its selected game's current scheduled kickoff or an authoritative started-game signal, while each Confidence prediction and its assigned confidence value lock independently by the same rule; unstarted games remain editable and may exchange their still-available confidence values.
_Avoid_: Rolling lock, per-game deadline

**Weekly Cutoff Lock**:
A Pick Lock mode in which earlier games lock individually under the Game Kickoff Lock rule, then every remaining Survivor or Confidence choice, confidence-value assignment, and Weekly Tiebreaker Prediction locks Sunday at 1:00 p.m. Eastern.
_Avoid_: First-game-of-week lock, Sunday lock

**Hidden Pick**:
An accepted Survivor Pick or Confidence prediction that remains visible to its author but not to other participants, the Pool Owner, or Pool Admins until its Pick Lock; administrators may see submission-completion status without seeing the choice.
_Avoid_: Private pick, secret pick

**Weekly Standing**:
A participant's result and rank within one Pool week. Confidence Pool participants rank first by weekly points, then by Weekly Tiebreaker Prediction accuracy; among otherwise tied participants, any valid tiebreaker prediction ranks ahead of an omitted prediction, and equal or jointly omitted predictions share a competition rank such as 1, 2, 2, 4.
_Avoid_: Weekly score

**Season Standing**:
A participant's cumulative result and rank within one Pool season, calculated as the sum of every Weekly Standing point total from the Pool's Start Week through Week 18. Weeks are neither dropped nor normalized; an untouched week contributes the points earned by its Automatic Confidence Pick Set. Equal season point totals share a competition rank such as 1, 2, 2, 4; Weekly Tiebreaker Predictions add no points and do not break a Season Standing tie.
_Avoid_: Overall standing, leaderboard position

**Confidence Winner**:
Each participant tied for the highest final Season Standing point total after every Week 18 Required Confidence Game has a Verified Result and Week 18 has been successfully scored. A Confidence Pool may therefore have one winner or joint winners.
_Avoid_: Champion, tiebreaker winner

**Weekly Tiebreaker Prediction**:
A Confidence Pool participant's whole-number prediction, from 0 through 200 inclusive, of the two teams' combined final points in the chronologically last scheduled Required Confidence Game of a Pool Week. It locks with that designated game's Game Kickoff Lock or at the Weekly Cutoff Lock; smaller absolute error ranks ahead, with the lower prediction winning equal-distance comparisons.
_Avoid_: Monday-night score, final-game winner
