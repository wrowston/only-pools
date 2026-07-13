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
A Pool whose rules have reached a terminal outcome and whose required results have been verified and scored; competition is closed while historical viewing and authorized result repair remain available, but corrected results can return it to Active.
_Avoid_: Finished Pool, ended Pool

**Archived Pool**:
A Pool placed in a reversible, read-only administrative status that preserves its history and does not pause its underlying Active or Completed lifecycle while moving it from participants' normal views into their archived history.
_Avoid_: Deleted Pool, closed Pool

**Survivor Pool**:
A Pool in which each participant chooses one team for a week and remains alive by satisfying the Pool's survivor rules.
_Avoid_: Elimination pool, suicide pool

**Confidence Pool**:
A Pool in which each participant predicts the winners of a week's required games and assigns a unique confidence value to each prediction.
_Avoid_: Pick'em, confidence league

**Pool Owner**:
The participant who created a Pool and holds its ultimate ownership authority.
_Avoid_: Creator, commissioner

**Pool Admin**:
A participant delegated some Pool-management authority by the Pool Owner.
_Avoid_: Moderator

**Pool Member**:
A participant who belongs to a Pool without ownership or delegated administration authority.
_Avoid_: User, player

**Participant**:
Any person competing in a Pool, regardless of whether they are also its Pool Owner or a Pool Admin.
_Avoid_: User, player

**Pool Invite**:
A revocable, expirable invitation that permits an authenticated person to become a participant in a specific Pool.
_Avoid_: Join link, invitation code

**Returning Participant Invite**:
A Pool Invite created from a Pool Template for a prior participant, optionally proposing their former role without enrolling them automatically.
_Avoid_: Copied membership, renewed membership

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
A participant's selected NFL team for one week of a Survivor Pool.
_Avoid_: Selection, choice

**Provisional Survivor Pick**:
A Survivor Pick for a future Pool Week that takes effect only if the participant remains eligible through every earlier week; elimination invalidates it without consuming its team.
_Avoid_: Future pick, queued pick

**Confidence Pick Set**:
A participant's collection of game-winner predictions and confidence values for one week of a Confidence Pool.
_Avoid_: Picks, ballot

**Pick Lock**:
The point after which a Survivor Pick or part or all of a Confidence Pick Set can no longer be submitted or changed.
_Avoid_: Deadline, freeze

**Strike**:
A recorded survivor-rule failure that counts toward a participant's allowed failures before elimination.
_Avoid_: Loss, life

**Weekly Standing**:
A participant's result and rank within one Pool week.
_Avoid_: Weekly score

**Season Standing**:
A participant's cumulative result and rank within one Pool season.
_Avoid_: Overall standing, leaderboard position
