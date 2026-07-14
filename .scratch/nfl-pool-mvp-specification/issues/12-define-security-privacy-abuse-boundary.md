Type: grilling
Status: resolved
Blocked by: 02, 05

# Define the security, privacy, and abuse boundary

## Question

What MVP policy should govern identity lifecycle, least-privilege authorization, invite-token handling, participant profile exposure, hidden-pick confidentiality, removal and archival data access, admin-action accountability, rate limiting, and abuse prevention for a free private-pool service?

## Answer

### Identity and eligibility

- Clerk remains the authentication authority. Every person must confirm they are at least 18 and must have both a verified email address and verified phone number at signup and each new sign-in.
- If either contact field becomes missing or unverified during an already-valid session, ordinary access continues for that session; both fields must be verified again at the next sign-in.
- Deleting an authentication identity immediately revokes access and removes its email, phone, display name, avatar, and other profile data from the app. Accepted picks, results, standings, and audit attribution remain under an anonymized `Former Participant` identity. A later signup is a distinct Participant and cannot reclaim that identity.
- A Pool Owner cannot complete the normal account-deletion flow while they own a Pool; ownership must be transferred first. If the identity disappears unexpectedly, competition continues but all administrative actions lock. Support performs a fully audited Ownership Recovery to a verified current Pool Admin, or may select any current Pool Member after verifying that person's required email and phone when no Admin exists. There is no automatic promotion.

### Profile privacy and membership access

- Every current participant can see other current participants' display names and avatars. Only the Pool Owner and Pool Admins can additionally see verified email addresses and phone numbers.
- This administrative contact visibility remains in Active, Completed, and Archived Pools. Invite acceptance must explicitly disclose it, and there is no per-Pool opt-out.
- Voluntary departure or removal revokes all Pool access and administrator visibility of the departed person's contact fields immediately. Their display name, accepted picks, results, status, and standings remain visible to current participants as competitive history. Valid reactivation restores normal historical access but never restores expired picking opportunities or former administrative authority.

### Authorization and elevated actions

- Every server query and mutation is deny-by-default. It derives the caller from Clerk, checks current Pool Membership and role, and returns only fields permitted to that role. Client-provided roles or participant identifiers are never trusted; UI guards are not an authorization boundary.
- Recent step-up verification with a second verified factor is required before ownership transfer, role changes, archive or restore, Pool Invite credential retrieval or rotation, and account deletion.
- Hidden Picks are visible through normal Pool access only to their author until their Pick Lock. Other participants, Owners, and Admins cannot reveal them; administrators may see completion state only. Authorized production operators may access underlying values solely through an audited incident-response process.

### Pool Invite credentials

- A Pool has at most one active ordinary Pool Invite. It is a reusable, shareable bearer link that is not addressed or bound to an email address or phone number; the accepting person must nevertheless authenticate and satisfy both verification requirements.
- The raw credential is encrypted at rest so an Owner or Admin can retrieve and copy it after step-up verification. It is excluded from logs, analytics, error reports, and Pool Audit Events.
- Rotation invalidates the prior credential immediately. Existing 30-day expiry, renewal, revocation, Pool-state, and membership-cutoff rules continue to apply.
- Invalid, expired, or probing attempts return generic errors and progressively throttle the account and network source. High-volume abuse may alert support, but it never auto-rotates or revokes the valid Pool Invite.

### Audit, telemetry, and operational access

- Sanitized Pool Audit Events cover role and membership changes, invite rotation, archival and restoration, and other Pool-facing administrative actions. Every current participant may view them. Provider synchronization and scoring repair are not Pool administrative actions; participants receive incident status while sensitive Production Operator records remain access-restricted. Raw credentials and contact fields never appear.
- Pool Audit Events remain for the Pool's lifetime, including while Archived. Sensitive security details and production-operator access records are restricted to the Pool Owner and support and retained for one year.
- Logs, analytics, and error reports use opaque internal identifiers and sanitized event categories. They exclude email addresses, phone numbers, raw invite credentials, Hidden Pick values, session tokens, authentication secrets, and full sensitive request payloads.

### Rate limits, quotas, and abuse response

- Application actions use separate per-account rate-limit classes for pick autosaves, invite operations, membership and administrative actions, and recovery requests, backed by network-level abuse controls. Rejections are explicit and include retry guidance; writes are never silently dropped, and Pick Locks are never extended because a client was throttled.
- One identity may own at most 10 Pools per Pool Season and hold at most 50 Pool Memberships per Pool Season. A Pool may contain at most 100 participants. Archived Pools continue to count for their Pool Season.
- Any participant may submit a private Abuse Report about a Pool or participant with a reason and optional description. It references relevant identities, Pools, and audit events without copying Hidden Picks or raw invite credentials, imposes no automatic penalty, and does not replace ordinary role-based removal.
- After human review, support may suspend an identity service-wide, revoke its sessions, and block sign-in, invite acceptance, and every Pool action while preserving memberships, roles, picks, standings, and history. Suspending a sole Owner begins Ownership Recovery.
- A Suspended Participant receives a private notice stating the enforcement category, effective time, review status or duration, and appeal path. Reporter identity, report text, internal evidence, and security signals remain confidential.

### Money boundary

- The platform provides no fields, workflows, messaging, or operational support for buy-ins, entry fees, prizes, payouts, or wagering.
- Product copy and terms remain neutral and silent about off-platform monetary arrangements: they neither grant permission nor impose an explicit platform prohibition.
