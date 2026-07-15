# 01 — Authenticate adults into My Pools

**What to build:** An adult can sign up and sign in with verified email and phone, confirm they are 18+, and land on a My Pools home that shows an empty membership list with Create Pool disabled. Unauthenticated or incompletely verified people cannot reach Pool surfaces. A Convex Participant is created and linked to Clerk; every query and mutation denies by default until a valid Participant is established.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Sign-in without verified email, verified phone, and age confirmation is refused
- [ ] Both email and phone are required again on the next sign-in if either lapses mid-session; an already-valid session is not interrupted
- [ ] Signed-in adults land on My Pools with empty state, create/join entry points visible, and Create Pool disabled until a later Available Season exists
- [ ] Convex Participant identity is deny-by-default; client-supplied roles or ids are never trusted
- [ ] Automated coverage exists for the dual-verification and deny-by-default auth edge (acceptance scenarios 1, 36 as applicable)
