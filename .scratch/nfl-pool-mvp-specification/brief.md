# NFL Pool Web App Architecture Brief

## Product Goal

Build a free web app where users can create private NFL pools and invite friends.

The app should support two pool types:

1. **Survivor Pools**

   * Users pick one NFL team each week.
   * If their team wins, they survive.
   * If their team loses, they are eliminated or receive a strike depending on pool settings.
   * Teams are usually only usable once per season.

2. **Confidence Pools**

   * Users pick winners for each NFL game in a week.
   * Users assign confidence points to each pick.
   * Correct picks earn the assigned points.
   * Weekly and season-long standings are tracked.

The main product experience should be simple, social, and commissioner-friendly.

---

## Core Requirements

Users should be able to:

* Sign up and log in.
* Create a survivor pool.
* Create a confidence pool.
* Invite friends with a shareable link.
* Join pools from invite links.
* View their pools from a dashboard.
* Submit picks before games lock.
* View current week games.
* View weekly and season standings.
* See who is alive/eliminated in survivor pools.
* See confidence pool rankings. (weekly/yearly)
* Manage pools they created.
* Remove members if they are the pool owner/admin.
* Trigger standings recalculation if needed.

---

## Stack Decision

Use:

* **Next.js App Router** for the web app.
* **TypeScript** throughout the app.
* **Tailwind CSS** and **shadcn/ui** for UI.
* **Convex** for backend, database, server functions, scheduled jobs, and realtime updates.
* **Clerk** for authentication.
* **SportsDataIO** for NFL schedule, live game status, scores, and final results.
* Optional later: **The Odds API** if spreads, moneylines, or odds-based confidence features are needed.

Do not use Stripe.

The app should be free to use. Do not build billing, paid plans, buy-ins, prize payouts, wallets, or payment processing.

---

## Why Convex

Convex is a strong fit because this app has a lot of realtime-ish state:

* Picks lock when games start.
* Game statuses update throughout NFL Sundays.
* Scores become final.
* Survivor eliminations update.
* Confidence standings change.
* Users expect the app to feel live.

Convex can handle:

* Realtime queries.
* Backend mutations.
* Scheduled sync jobs.
* Server-side scoring logic.
* Materialized standings.
* A simpler full-stack TypeScript workflow.

The planning agent should design the app around Convex’s strengths instead of treating it like a generic SQL database.

---

## Authentication

Use **Clerk** for auth.

Clerk should handle:

* User sign up.
* User sign in.
* Session management.
* User identity.
* Verified phone-number and email identity and profile data; both are required.

Convex should store an internal user record linked to the Clerk user ID.

The app should use Clerk identity to determine:

* Which pools the user belongs to.
* Which pools the user owns.
* Whether the user can submit picks.
* Whether the user can manage a pool.

---

## Access Model

There should be three pool-level roles:

* **Owner**
* **Admin**
* **Member**

Owner:

* Created the pool.
* Can edit pool settings where allowed.
* Can invite users.
* Can remove users.
* Can archive the pool.
* Can trigger recalculation.

Admin:

* Can invite users.
* Can remove members if allowed.
* Can trigger recalculation.
* Can help manage the pool.

Member:

* Can submit picks.
* Can view allowed standings.
* Can leave the pool.

All access control should be enforced in Convex functions, not only in the frontend.

---

## NFL Data Provider

Use **SportsDataIO** as the primary data source.

The app needs:

* NFL teams.
* NFL schedule.
* Season/week structure.
* Kickoff times.
* Game status.
* Live scores.
* Final scores.
* Winner.
* Tie/postponement/cancellation status where available.

Do not call the provider directly from the frontend.

Provider data should flow like this:

```text
SportsDataIO
  → Convex scheduled sync job
  → Internal normalized game data
  → Scoring jobs
  → Standings snapshots
  → Realtime UI
```

The app should keep provider-specific details isolated so the provider can be swapped later if needed.

---

## Core Domain Entities

The planning agent should decide exact Convex schema details, but the app will need entities for:

* Users
* NFL teams
* NFL games
* Pools
* Pool members
* Pool invites
* Survivor picks
* Confidence picks
* Weekly standings
* Season standings
* Audit logs or admin actions
* Optional odds data later

The important modeling principle is to keep data scoped by:

* Pool
* Season
* Week
* User
* Game

Avoid broad queries that load an entire season or all historical picks when the user only needs one week.

---

## Pool Creation

When creating a pool, the user should choose:

* Pool name
* Pool type:

  * Survivor
  * Confidence
* NFL season
* Start week
* Locking mode
* Basic rules

Survivor settings may include:

* Teams can/cannot be reused.
* Number of strikes allowed.
* Tie behavior:

  * Tie counts as loss.
  * Tie counts as push.
  * Tie counts as survive.
* Whether playoffs are included.
* Whether Thursday games are allowed.

Confidence settings may include:

* Straight-up picks.
* Optional spread-based picks later.
* Require all games picked.
* Hide every other participant's choice until that choice locks; do not add an MVP visibility toggle.
* Drop lowest week later.
* Monday night tiebreaker later.

The MVP should start with simple defaults and avoid too many advanced settings.

---

## Pick Locking

Support two lock modes:

1. **Game kickoff lock**

   * Each pick locks when that specific game starts.
   * Recommended default.

2. **Weekly cutoff lock**

   * Earlier-game choices lock at their own kickoff.
   * Every remaining choice locks Sunday at 1:00 p.m. Eastern.
   * Applies consistently to Survivor and Confidence Pools.

Locking must be enforced server-side in Convex mutations.

Do not rely only on frontend disabled states.

The pick interface should autosave each participant gesture without an explicit Save button. Confidence-value reorders must remain valid unique permutations in the client and be independently validated by the server.

When a user submits or edits picks, the server must verify:

* User is authenticated.
* User belongs to the pool.
* Pool is active.
* User is allowed to pick.
* Pick has not locked.
* Game has not started.
* Pick follows pool rules.

---

## Survivor Pool Logic

A survivor pick should include:

* Pool
* User
* Season
* Week
* Game
* Picked team
* Status/result

Rules:

* A user can submit one pick per week.
* A user cannot reuse a team unless the pool allows it.
* A user cannot change a pick after it locks.
* If the picked team wins, the user survives.
* If the picked team loses, the user is eliminated or receives a strike.
* Tie behavior depends on pool settings.
* Missing pick should count as a loss by default unless the app later supports custom behavior.

The app should track:

* Alive users.
* Eliminated users.
* Week eliminated.
* Strikes used.
* Pick history.
* Used teams.

---

## Confidence Pool Logic

A confidence pool pick set should include:

* Pool
* User
* Season
* Week
* One pick per game
* Picked team per game
* Confidence value per game
* Result per pick
* Points earned

Rules:

* User must pick a winner for each required game.
* Confidence values must be unique for the week.
* If there are 16 games, values are usually 1 through 16.
* Correct picks earn the assigned confidence points.
* Incorrect picks earn 0.
* Picks lock by game kickoff by default.
* Other participants' choices remain hidden until each choice locks; there is no MVP visibility setting.

The app should track:

* Weekly points.
* Season points.
* Weekly rank.
* Season rank.
* Correct pick count.
* Possible remaining points.

---

## Standings Strategy

Do not calculate standings from all raw picks every time the user loads a page.

Use materialized standings/snapshots.

The planning agent should design:

* Weekly standings snapshots.
* Season standings snapshots.
* Recalculation jobs.
* Admin-triggered recalculation.
* Idempotent scoring logic.

Raw picks should be the source of truth.

Standings should be derived data optimized for display.

This is especially important for confidence pools, where each user may have many picks per week.

---

## Realtime Query Strategy

Convex realtime queries should be scoped carefully.

Avoid broad queries like:

```text
Get all games.
Get all picks for a pool.
Get every historical standing.
Calculate everything in one query.
```

Prefer focused queries like:

```text
Get current pool summary.
Get current week games.
Get my picks for this week.
Get visible picks for this week.
Get weekly standings.
Get season standings.
Get pool members.
```

Most views should be scoped by:

```text
poolId + season + week
```

This keeps the app fast and prevents unnecessary realtime updates.

---

## Scheduled Jobs

The app needs backend jobs for NFL data and scoring.

Recommended jobs:

### Team Sync

* Pull NFL teams from provider.
* Run manually or occasionally.

### Schedule Sync

* Pull season schedule.
* Run before the season and periodically during the season.

### Current Week Sync

* Pull current week games.
* Update kickoff times, status, scores, and final results.

### Live Game Sync

* Run more frequently while games are live.
* Only poll games that are live, starting soon, or recently finished.

### Lock Picks Job

* Finds games that have started.
* Marks related picks as locked where needed.
* Server mutations should still independently enforce locking.

### Final Score Job

* Detects games that became final.
* Updates winners.
* Triggers survivor and confidence scoring.

### Scoring Job

* Scores affected picks.
* Updates weekly standings.
* Updates season standings.
* Should be safe to run more than once.

### Repair/Recalculate Job

* Allows admin to recalculate a week or season if provider sync or scoring had an issue.

---

## Provider Polling Strategy

Do not poll heavily all the time.

Suggested approach:

* Offseason: minimal/manual syncing.
* Before season: sync full schedule.
* Non-game days: sync current week occasionally.
* Game days: poll live games every 30–60 seconds.
* After games are final: reduce polling.
* Finalize scores and trigger scoring jobs.

The planning agent should account for provider rate limits and API costs.

---

## Admin Tools

Pool owners/admins should have tools for:

* Inviting users.
* Removing users.
* Viewing members.
* Viewing missing picks.
* Triggering standings recalculation.
* Archiving a pool.
* Optional manual result override later.

Manual result override is not required for the first version, but the architecture should leave room for it.

---

## Invite Flow

The app should support invite links.

Flow:

```text
Owner creates pool
  → Owner copies invite link
  → Friend opens invite link
  → Friend signs in/signs up with Clerk
  → App accepts invite
  → Friend becomes pool member
  → Friend lands on pool page
```

The app should handle:

* Expired invite.
* Revoked invite.
* User already in pool.
* Pool archived.
* Invalid invite code.

---

## Main App Pages

### Marketing / Public

* Landing page
* Sign in
* Sign up
* Join invite page

### Authenticated

* Dashboard
* Create pool
* Pool home
* Make picks
* Standings
* Pool members
* Pool settings/admin

---

## Dashboard Requirements

Dashboard should show:

* Pools the user belongs to.
* Pool type.
* Current week.
* Whether the user has submitted picks.
* Whether picks are locked.
* Survivor status if applicable.
* Confidence rank if applicable.
* Quick link to make picks.

---

## Pool Home Requirements

Pool home should show:

* Pool name.
* Pool type.
* Current week.
* Current week game status.
* User pick status.
* Standings summary.
* Member count.
* Admin actions if user has permission.

For survivor pools, show:

* Alive count.
* Eliminated count.
* User’s pick.
* Used teams.

For confidence pools, show:

* User’s submitted picks.
* Weekly points.
* Season rank.
* Possible points remaining.

---

## Picks Page Requirements

### Survivor Picks Page

Should show:

* Current week games.
* Teams available to pick.
* Already-used teams disabled.
* Locked games disabled.
* Kickoff times.
* Pick confirmation.
* Pick status after submission.

### Confidence Picks Page

Should show:

* All current week games.
* Winner selection for each game.
* Confidence value assignment.
* Validation for duplicate confidence values.
* Missing pick warnings.
* Submit button.
* Lock status.

---

## Standings Page Requirements

### Survivor Standings

Show:

* Alive users first.
* Eliminated users below.
* Pick history.
* Week eliminated.
* Strikes used if enabled.
* Current week picks once visible.

### Confidence Standings

Show:

* Season rank.
* Total points.
* Weekly points.
* Correct picks.
* Possible remaining points.
* Weekly breakdown.

---

## Error Handling

The app should handle:

* Provider API failure.
* Duplicate provider data.
* Missing game results.
* Delayed game finalization.
* Postponed games.
* Canceled games.
* Ties.
* Late pick attempts.
* Duplicate confidence values.
* Used survivor teams.
* User not authorized.
* Invite link errors.

All critical server-side actions should be logged enough to debug issues.

---

## Important Product Decisions

Use Convex for backend/database/realtime.

Use Clerk for auth.

Use SportsDataIO for NFL schedule, game status, scores, and final results.

Keep the app free.

Do not add Stripe, billing, subscriptions, buy-ins, payouts, wallets, or prize handling.

Use materialized standings instead of recalculating from raw picks on every page load.

Use game-level locking by default.

Keep MVP rules simple.

Optimize for trust on NFL Sundays:

* Accurate lock timing.
* Accurate scores.
* Clear pick status.
* Clear standings.
* Admin recovery tools.

---

## MVP Scope

Build this first:

1. Clerk auth.
2. Convex user sync.
3. Create pool.
4. Join pool by invite link.
5. Pool dashboard.
6. NFL team and schedule sync.
7. Current week game display.
8. Survivor pick submission.
9. Confidence pick submission.
10. Server-side lock enforcement.
11. Final score sync.
12. Survivor scoring.
13. Confidence scoring.
14. Weekly standings.
15. Season standings.
16. Admin recalculation.
17. Basic responsive UI.

Do not build in MVP:

* Stripe.
* Paid plans.
* Prize pools.
* Wagers.
* Mobile app.
* Pool chat.
* Push notifications.
* Complex tiebreakers.
* Advanced odds features.
* Custom branding.
* Public leaderboards.

---

## Phase 2 Ideas

After the MVP works:

* Email reminders.
* Pick deadline notifications.
* Weekly recap emails.
* Pool chat.
* Commissioner notes.
* Playoff pools.
* Spread-based confidence pools.
* Tiebreakers.
* Public leaderboard.
* CSV export.
* Historical league archive.
* Expo mobile app.
* Odds integration.
* Manual result override.
* More advanced admin tools.

---

## Success Criteria

The MVP is successful when:

1. A user can sign up with Clerk.
2. A user can create a survivor pool.
3. A user can create a confidence pool.
4. Friends can join from an invite link.
5. Users can submit picks before lock.
6. Late picks are blocked server-side.
7. NFL games sync from the provider.
8. Final scores are detected.
9. Survivor eliminations are calculated correctly.
10. Confidence points are calculated correctly.
11. Standings update reliably.
12. Admins can recalculate standings if needed.
13. The app feels trustworthy and easy to use during NFL game days.
