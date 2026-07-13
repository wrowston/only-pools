Type: grilling
Status: resolved
Blocked by: none

# Settle membership, roles, and invitations

## Question

What complete membership and authority contract should govern Pool Owners, Pool Admins, and Pool Members, including invitation creation and acceptance, Returning Participant Invites and proposed roles from Pool Templates, role changes, removal, voluntary leaving, ownership continuity, archived Pools, and the audit trail for administrative actions?

## Answer

### Membership identity and admission

- An authenticated person has at most one Pool Membership in a Pool. Repeated acceptance attempts for an existing active membership are idempotent rather than creating duplicates.
- Accepting an invitation requires authentication and explicit confirmation. Merely opening its URL never enrolls a person.
- New membership closes permanently at the scheduled kickoff instant of the earliest NFL game in the Pool's Start Week, regardless of the Pool's Pick Lock mode. A reschedule may move that cutoff only while the original cutoff has not passed; admission never reopens afterward.
- Completed and Archived Pools accept no invitations. An Archived Pool must be restored before membership can change.

### Pool Invites

- A Pool has at most one active ordinary Pool Invite link. It is reusable and grants Pool Member authority.
- Pool Owners and Pool Admins may create, renew, revoke, or rotate the ordinary Pool Invite before the membership cutoff. A new invitation expires after 30 days by default and may be renewed before admission closes.
- A Returning Participant Invite is person-specific and single-use. It reuses no membership automatically and takes effect only after the intended authenticated recipient explicitly accepts it.
- Only the Pool Owner may create a Returning Participant Invite that proposes Pool Admin authority. Pool Admins may invite only at Pool Member authority.
- Raw invitation credentials never appear in audit history.

### Authority

- A Pool always has exactly one Pool Owner.
- Only the Pool Owner may transfer ownership, promote or demote Pool Admins, remove Pool Admins, archive or restore the Pool, edit the Pool Ruleset before it freezes, or create a Returning Participant Invite proposing Pool Admin.
- Pool Owners and Pool Admins may manage ordinary Pool Invites, remove Pool Members, and trigger standings recalculation.
- A Pool Admin cannot alter another Pool Admin, affect the Pool Owner, or grant administrative authority.
- A Pool Member has competitive participation and permitted viewing authority but no administrative authority.
- Role changes never alter the participant's picks, results, or standings.

### Ownership continuity

- A Pool Owner cannot leave or be removed until ownership has transferred.
- Ownership may be offered only to a current Pool Admin. The recipient must explicitly accept; until acceptance, the current Pool Owner retains full authority and may cancel the offer.
- Acceptance changes both roles atomically: the recipient becomes Pool Owner and the former Pool Owner becomes Pool Admin.
- Ownership transfer remains available in Active, Completed, and Archived Pools so stewardship cannot become stranded.

### Leaving, removal, and return

- A participant may leave voluntarily until every required Start Week game has a Verified Result and that Pool Week has been successfully scored. A disruption that keeps the Start Week Pending also keeps voluntary departure available.
- Once the Start Week is successfully scored, voluntary leaving is permanently closed.
- If a participant leaves before the membership cutoff, they may accept a valid Pool Invite to reactivate the same Pool Membership. After the cutoff, voluntary departure cannot be reversed.
- Pool Owners and Pool Admins may remove Pool Members throughout the Active lifecycle; only the Pool Owner may remove a Pool Admin. Removal is immediate.
- Departure or removal blocks normal Pool access and all future picking. Every already-accepted pick, result, and standing remains intact and visibly attributed under a Departed or Removed status; departure never rewrites competitive history.
- A removed person cannot accept an ordinary or Returning Participant Invite for that Pool. Only the Pool Owner may explicitly reinstate the existing membership, at Pool Member authority, through an audited action.
- Reactivation or reinstatement never reopens a Pick Lock, restores a missed opportunity, or automatically restores former Pool Admin authority.
- Completed Pools permit neither voluntary departure nor removal. They do permit the Pool Owner to promote or demote existing participants so stewardship and authorized repair can continue.
- Archived Pools permit only ownership transfer. Other role or membership changes require restoration first.

### Accountability

- The system records an immutable Pool Audit Event for invitation creation, renewal, revocation, rotation, and acceptance; voluntary departure; removal and reinstatement; promotion and demotion; and ownership offer, cancellation, and acceptance.
- Each event identifies its timestamp, Pool, actor, affected participant, action, and prior and resulting state.
- Removal and reinstatement require a short reason; other actions may include one.
- Pool Owners and Pool Admins may view the Pool's membership audit history. An affected person may view events about their own membership, including a removal reason.
- Broader retention, personal-data exposure, token construction, and abuse controls remain with [Define the security, privacy, and abuse boundary](./12-define-security-privacy-abuse-boundary.md).
