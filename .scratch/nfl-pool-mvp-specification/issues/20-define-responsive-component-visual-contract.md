Type: grilling
Status: resolved
Blocked by: 10

# Define the responsive component and visual interaction contract

## Question

What production UI contract must the React implementation preserve for the selected mobile-first Week Board across participant and Pool Owner flows, including component boundaries, breakpoint and navigation behavior, touch and keyboard affordances, focus and accessibility semantics, visual tokens, game and pick state presentation, feedback, and loading, empty, stale, incident, and recovery states?

## Answer

### Shell and breakpoint

- One hard shell switch at **900px**. Below 900px use the phone shell only; at 900px and above use the desktop shell.
- There is no third tablet-specific information architecture. Mid widths use the phone shell or collapse secondary chrome rather than inventing a separate layout.
- Desktop expands the same hierarchy as phone; it is not a separate workflow.
- Implement with **Tailwind CSS** and **shadcn/ui**. Map Only Pools tokens into the shadcn theme. Do not promote throwaway prototype markup; rebuild as accessible production components.

### Navigation and progressive disclosure

- **My Pools is app home** after sign-in: membership list with pool name, type, week status, and next action; create-pool and invite-join entry points live here.
- Opening a membership enters that pool on the **Week Board** — the primary in-pool surface for picks, lock/save trust, and live/result state.
- **Standings** and **Pool** are secondary destinations reached from clear text chips in the pool header (`Standings · Pool`), not equal-weight bottom-nav tabs.
- Full Standings is a first-class page (Option 1 wireframe): Weekly/Season toggles for Confidence; alive/eliminated (and week context) for Survivor; complete ranked lists, not a peek-only view.
- Switch pools by returning to My Pools. MVP has no header pool switcher.
- Account/sign-out lives in a single avatar menu on My Pools and inside a pool — never a primary game-day destination.
- Desktop (≥900px) uses a grouped sidebar with **Board / Standings / Pool** plus bottom account controls, a sticky utility header, framed game table, and a narrow context rail. Phone has no rail and no persistent bottom tab bar for in-pool destinations; a back control returns to My Pools from the Week Board and to the Board from Standings or Pool.

### Desktop context rail (Week Board only)

- **Confidence:** top 5 weekly standings for the selected week, plus the current user's row if outside the top 5, plus a **Full standings** link.
- **Survivor:** alive count, short alive list capped at 8 with “+N more” when needed, plus a **Full standings** link.
- Compact selected-week lock/status line only — not a second incident channel.
- Never show Hidden Picks, provider diagnostics, Production Operator controls, or a duplicate game list in the rail.

### Production component inventory

Named reusable shadcn-composed components (closed list):

| Component | Responsibility |
| --- | --- |
| `AppShell` | Phone vs ≥900px desktop switch; back to My Pools; incident banner slot |
| `MyPoolsList` | Membership rows, next-action status, create/join entry |
| `PoolHeader` | Pool name/type, week + lock/save trust, Standings·Pool chips, avatar menu |
| `WeekSelector` | Sticky segmented week control |
| `GameCard` / `GameTableRow` | Same pick semantics; stacked card &lt;900px, framed row ≥900px |
| `TeamPickControl` | Large team target; selected/locked/live/won/lost presentation |
| `ConfidenceValueControl` | Unique value assignment while unlocked |
| `SaveTrust` | Server-save confirmation / pending / failed |
| `StandingsTable` | Full weekly/season or Survivor alive list; also powers desktop peek |
| `PoolPanel` | Membership readiness, invites, roles, rules summary |
| `StatusBanner` | Single top incident/repair banner only |
| `EmptyState` / `LoadingBlock` | Shared empty and loading patterns |

No separate Rules or Notifications components. Owner-only controls are variants inside `PoolPanel`, not parallel shells.

### Touch, keyboard, and accessibility

- Touch targets for team picks and primary actions ≥ **44×44px**; week chips and Standings·Pool links ≥ **44px** tall; no hover-only affordances.
- Full Board, Standings, and Pool flows operable by Tab / Shift+Tab / Enter / Space. Arrow keys move across team targets within a game and across confidence values where reordering applies. Escape closes menus and sheets.
- Visible focus ring using ink plum. Focus is not trapped except in modal/sheet. After a successful save, focus remains on the control just changed.
- Accessible names for pick controls include team and state (`selected`, `locked`, `Pick won`, `Pick lost`). Polite `aria-live` is used only for save-trust and the incident banner — not every live score tick.
- Respect `prefers-reduced-motion`; no required animation to understand state.

### Visual tokens and pick-state presentation

Inherit the settled Week Board palette into the shadcn theme:

- Canvas `#F9F9F9`; white elevated surfaces and inputs; controls `#EFEFEF`; borders `#E4E4E4` / `#DBDBDB`; text `#262626` / `#616161` / `#A5A5A5`.
- Primary ink plum `#363449` (hover `#2E2C40`, pressed `#252334`); selected/pending pale pink `#F8EAF4` with deep plum `#5A3652` text/icons; accent pink `#F2A6D7` sparingly; mint `#29E7A5` for small live/healthy marks only.
- No decorative grid background; structure via borders and whitespace.
- Pick/game progression: open → saved/pending (pale pink) → locked → live → settled won (pale green `#EEF9F2` + “Pick won” + check) → settled lost (pale red `#FFF2F2` + “Pick lost” + cross). Color never carries meaning alone.
- Projected results stay clearly provisional; official outcomes follow Verified Results only.
- Successful save is quiet inline confirmation via `SaveTrust` (no toast). Failed save is inline error + retry. Primary buttons use ink plum.

### Loading, empty, and failure presentation

| Situation | Presentation |
| --- | --- |
| Initial load | Skeleton blocks matching Board / Standings / Pool layout |
| Empty My Pools | One empty state with Create pool / Have an invite? actions |
| Empty standings week | “No standings yet” — not an error |
| In-flight pick save | Inline pending on `SaveTrust` / the control; prior value remains visible |
| Save failed | Inline error + retry on that control — not the top incident banner |
| Stale / Provider Exception / scoring delayed / repair | Single top `StatusBanner` with generic copy; board keeps last consistent official state |
| Late (not Stale) | No banner and no scattered last-updated chrome |
| Correction notice | Inline until viewed, per prior policy — not the sync banner |

No full-page blocking overlays for sync or scoring. No toast spam for routine saves. Participant failure communication follows [Define the production trust and recovery standard](./11-define-production-trust-recovery-standard.md).

### Role chrome

- One shell for every role. Members, Pool Admins, and Pool Owners share My Pools → Week Board → full Standings.
- Members: `PoolPanel` is read-only (roster, rules summary, own role).
- Owners/Admins: `PoolPanel` adds invite link, role changes, remove member, and pick-completion readiness; Board may show readiness cues (for example, “3 of 12 picked”).
- No role may see Hidden Pick contents, provider diagnostics, or Production Operator recovery controls in this product surface. There is no separate Owner app and no in-product operator UI here.

### Relationship to the prototype

- [Prototype participant and Pool Owner game-day flows](./10-prototype-game-day-flows.md) remains decision evidence for IA and visual language.
- Production must implement this contract afresh with real application state; do not ship the throwaway `/prototype/game-day-flows` markup.
