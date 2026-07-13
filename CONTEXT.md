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
The outcome-affecting rules shared by every participant in a Pool; it becomes immutable when the Pool accepts its first pick.
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
A Survivor Pick for a future Pool Week, or a later Pool Week played while an earlier Survivor outcome is Pending, that takes effect only if the participant advances through every earlier week. It reserves its selected team under the one-use-per-participant rule while valid; earlier elimination invalidates the pick without consuming the team.
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
A participant's collection of game-winner predictions and confidence values for one week of a Confidence Pool.
_Avoid_: Picks, ballot

**Pick Lock**:
The point after which a Survivor Pick or part or all of a Confidence Pick Set can no longer be submitted or changed.
_Avoid_: Deadline, freeze

**Weekly Standing**:
A participant's result and rank within one Pool week.
_Avoid_: Weekly score

**Season Standing**:
A participant's cumulative result and rank within one Pool season.
_Avoid_: Overall standing, leaderboard position
