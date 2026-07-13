Type: grilling
Status: resolved
Blocked by: none

# Define the pool and season lifecycle

## Question

What canonical states and transitions govern a Pool from creation through active play and archival, including season selection, start week, determination of the current week, regular-season and playoff boundaries, and which participant actions remain valid in each state?

## Answer

### Competitive lifecycle

- A Pool is **Active immediately upon creation**. There is no draft, upcoming, paused, or manual-activation state.
- The competitive lifecycle is **Active ↔ Completed**. A Pool becomes Completed automatically when its pool-type rules reach a terminal outcome and every game result required to establish that outcome is a Verified Result that has been successfully scored.
- A corrected provider result or authorized recalculation that invalidates the terminal outcome automatically returns a Completed Pool to Active. The transition must be audited and surfaced to participants.
- The precise terminal outcome for each pool type remains with [Settle survivor rules and participant state](./03-settle-survivor-rules-participant-state.md) and [Settle confidence rules and scoring semantics](./04-settle-confidence-rules-scoring.md).

### Archival

- Archived is a reversible administrative overlay, not a competitive lifecycle state. An Active or Completed Pool may be archived and later restored to its then-current underlying state.
- An Archived Pool is removed from normal dashboard views but remains available to existing participants through an Archived section and direct links.
- Archived Pools are read-only to users and administrators: joining, invitations, picks, rule changes, and recalculation require restoration first.
- Real-world time and backend processing do not pause. Pick Locks, provider synchronization, scoring, Pending Weeks, result corrections, and automatic completion continue while the Pool is archived. Restoration does not undo locks or missed opportunities.

### Pool Season and Start Week

- New Pools may use only SportsDataIO's current NFL regular season. Creation is unavailable until that season's schedule has synchronized and at least one valid Start Week remains.
- The Start Week may be any regular-season week whose first game has not kicked off when the Pool is created. Once a week's first game starts, the next regular-season week is the earliest valid Start Week.
- All MVP Pools exclude the postseason and have Week 18 as their latest scheduled week, although a Survivor Pool may reach its rule-defined terminal outcome earlier.
- Pools never roll over. A new NFL season requires a separately created Pool with fresh identity and competitive history.

### Mutability

- Pool Type and Pool Season are identity-defining and immutable from creation. Correcting either requires archiving the unused Pool and creating another.
- Start Week and every outcome-affecting Pool Ruleset value may be edited until the Pool accepts its first pick. The first accepted Survivor Pick or Confidence Pick Set freezes them permanently.

### Pickable and Pending weeks

- The product does not use a single ambiguous "current week." A **Pickable Week** has an open Pick Window; a **Pending Week** is an earlier week with an unresolved result that could still affect outcomes or standings. Pending Weeks never prevent later participation.
- In Survivor Pools, every included future regular-season week with a published synchronized slate is immediately Pickable. Slates available at Pool creation open immediately; later synchronized slates open when published.
- A Survivor Pick for a future week is a Provisional Survivor Pick. It takes effect only if the participant remains eligible through every earlier week. Elimination invalidates every later provisional pick without treating its selected team as used.
- Confidence Pools have at most one Pickable Week. The Start Week Pick Window opens immediately at Pool creation. Each later window opens when every prior-slate game is either finished or formally classified Pending because of disruption.

### Completed Pool actions

- Completed Pools accept no new joins, invitations, picks, or competitive-rule changes.
- Existing participants retain historical access to final standings and pick history.
- Authorized administrators may recalculate or repair results. Such work may change derived standings or reactivate the Pool, but never reopens an expired Pick Lock.

### Cross-season setup and invitations

- A new Pool may use an owner-selected prior-season Pool as a **Pool Template**.
- The owner may choose reusable setup to prefill: name, Pool Type, Pool Ruleset, locking mode, and the prior Start Week number if it remains valid for the current season.
- The template may create Returning Participant Invites for former participants and propose their former roles. Every recipient must accept before membership or a proposed role becomes effective; nobody is automatically enrolled.
- A template never copies Pool Season, lifecycle or archive status, existing memberships, prior invitation records, picks, standings, scoring state, audit history, or other competitive history.
