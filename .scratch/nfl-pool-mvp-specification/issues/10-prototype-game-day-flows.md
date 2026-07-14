Type: prototype
Status: resolved
Blocked by: 02, 03, 04, 05, 09

# Prototype participant and Pool Owner game-day flows

## Question

Which responsive information architecture and interaction flows make it simplest for participants to join, understand status, make valid picks, and trust live results while allowing Pool Owners to detect missing picks, manage membership, understand data freshness, and recover standings?

## Comments

### Throwaway prototype ready for review

- Run `npm run dev`, then open `/prototype/game-day-flows?variant=A`.
- The prototype lives in [`app/prototype/game-day-flows`](../../../app/prototype/game-day-flows) and intentionally remains outside production routes.
- Use the fixed bottom switcher or the left/right arrow keys to compare `A — Action first`, `B — Week board`, and `C — Trust timeline`.
- Use the top controls to compare Participant and Pool Owner views, Confidence and Survivor Pools, and before-lock, live-Sunday, and scoring-repair moments.
- The prototype uses Pool Owner and Pool Admin language rather than the avoided `commissioner` term. Pool roles see pick-completion status without Hidden Pick content, and they see provider/scoring status without Production Operator controls.
- `npm run build` passes under Next.js 16.2.10. Browser checks passed at 1440×1000 and 390×844, including URL-stable variant switching, scenario switching, Survivor pick interaction, repair-state continuity, and a clean browser error log.
- Awaiting human selection or synthesis before recording the answer, archiving the prototype on a throwaway branch, and resolving this ticket.

### Direction selected for refinement

- Use `B — Week board` as the structural baseline.
- Optimize the information hierarchy and controls for mobile first because most participants will use phones; the desktop sidebar must become purpose-built mobile navigation rather than a compressed rail.
- Closely adopt the supplied Firecrawl references' visual language: near-white canvas, thin neutral borders, restrained sans-serif typography, soft-gray control fills, rounded rectangular inputs and segmented controls, sparse shadows, and simple outline icons.
- Replace Firecrawl orange with the distinct Only Pools primary color confirmed below. Preserve separate semantic colors for success, warning, incident, and live-game states.

### Visual system confirmed

- Retain the sampled Firecrawl neutral system: `#F9F9F9` canvas, white elevated surfaces and inputs, `#EFEFEF` controls, `#E4E4E4` standard borders, `#DBDBDB` stronger borders, `#262626` primary text, `#616161` secondary text, and `#A5A5A5` muted labels.
- Replace Firecrawl's orange action color with Greptile-inspired ink plum `#363449`; use `#2E2C40` for hover and `#252334` for pressed controls.
- Replace Firecrawl's pale-orange selected background with pale pink `#F8EAF4`; use deep plum `#5A3652` for selected text and icons.
- Use accent pink `#F2A6D7` only for compact expressive details. Reserve bright mint `#29E7A5` for small live, healthy, and celebratory highlights rather than large surfaces.
- Distinguish selection from outcome: pending saved picks remain pale pink, settled successful picks use pale green `#EEF9F2` with `#B9E1C6` borders and `#356C49` text, and settled unsuccessful picks use pale red `#FFF2F2` with `#EDC6C8` borders and `#8A484C` text. Pair color with explicit `Pick won`/`Pick lost` copy and check/cross icons.
- Keep the application canvas plain and quiet. Do not use a decorative grid background; rely on section borders and whitespace for structure.
- Match the supplied Firecrawl dashboard references closely at the component level: a wide grouped sidebar with bottom account controls, a neutral sticky top bar with rounded team and utility controls, a prominent primary action, large restrained page heading, segmented filter row, thin one-pixel borders, dense framed table content, and simple outline icons. Only Pools colors and NFL-specific information architecture remain intentionally different.
- Use `/prototype/game-day-flows?variant=B&preview=1` for a clean visual review that hides only the throwaway scenario and variant controls. The default prototype URL retains those controls for comparing scenarios and variants.
- The refined Variant B still passes the production build and exposes the result labels in the accessible button names at the 390×844 mobile breakpoint.

## Answer

Use `B — Mobile week board` as the MVP game-day information architecture for both participants and Pool Owners. It puts the active Pool, week, lock state, required action, game slate, save confirmation, and official-result state into one scannable surface, with standings and Pool readiness as secondary context rather than competing destinations.

The production direction is mobile first. On phones, use a compact Pool header, prominent week and status context, a sticky segmented week selector, stacked game cards with large team targets, and persistent bottom navigation. On desktop, expand the same hierarchy into a wide grouped sidebar, sticky utility header, framed game table, and narrow context rail. Desktop is an expansion of the phone experience, not a separate workflow.

The visual language should closely follow the supplied Firecrawl dashboard references except for the Only Pools palette and NFL-specific content: near-white canvas, white surfaces, soft-gray controls, thin one-pixel borders, rounded rectangular controls, restrained shadows, simple outline icons, and generous whitespace. Do not use a decorative grid background.

Use ink plum `#363449` for primary controls, pale pink `#F8EAF4` for selected or pending choices, accent pink `#F2A6D7` sparingly, and mint `#29E7A5` for small healthy/live indicators. Settled successful picks use pale green `#EEF9F2`; settled unsuccessful picks use pale red `#FFF2F2`. Result colors must be paired with explicit text and check/cross icons rather than carrying meaning alone.

Participants must be able to distinguish open, saved, locked, live, settled-success, settled-failure, stale, and repair states without leaving the game board. Pool Owners use the same shell with readiness and membership controls, but see completion state only—not Hidden Pick contents—and never receive Production Operator recovery controls.

Variant A's action-first framing and Variant C's trust timeline remain useful supporting ideas, but neither should become the primary navigation model. Pull their strongest concepts into the selected Week Board where useful: an explicit next action, server-save confirmation, official-data freshness, revision continuity, and visible incident or repair messaging.

The prototype at [`app/prototype/game-day-flows`](../../../app/prototype/game-day-flows) is decision evidence only. Review the selected direction at `/prototype/game-day-flows?variant=B&preview=1`. Do not promote the throwaway markup directly; implement the approved direction afresh as accessible, reusable production React components with real application state and responsive behavior.
