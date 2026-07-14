Type: prototype
Status: claimed
Blocked by: 02, 03, 04, 05, 09

# Prototype participant and commissioner game-day flows

## Question

Which responsive information architecture and interaction flows make it simplest for participants to join, understand status, make valid picks, and trust live results while allowing commissioners to detect missing picks, manage membership, understand data freshness, and recover standings?

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
- Closely adopt the supplied Firecrawl references' visual language: near-white canvas, thin neutral grid lines, restrained sans-serif typography, soft-gray control fills, rounded rectangular inputs and segmented controls, sparse shadows, and simple outline icons.
- Replace Firecrawl orange with a distinct Only Pools primary color, still awaiting human selection. Preserve separate semantic colors for success, warning, incident, and live-game states.
