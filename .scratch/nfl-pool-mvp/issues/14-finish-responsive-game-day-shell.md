# 14 — Finish the responsive game-day shell

**What to build:** The production UI meets the settled shell contract: hard switch at 900px, My Pools → Week Board primary with Standings/Pool secondary chips, desktop sidebar and context rail, closed component inventory rebuilt from the prototype (not promoted markup), keyboard/touch affordances, focus and reduced-motion behavior, SaveTrust and banner live regions only, and scoped loads so ordinary views stay interactive under live updates.

**Blocked by:** 03 — Create an Active Pool and open the Week Board; 08 — Score Survivor weeks and declare winners; 09 — Score Confidence weeks and standings; 13 — Surface Operator Incidents and recovery

**Status:** ready-for-agent

- [ ] Navigation contract: My Pools home → Week Board primary; Standings/Pool chips; desktop ≥900px expands same hierarchy
- [ ] Keyboard-complete Board/Standings/Pool; pick targets ≥44px; visible focus; reduced motion; won/lost not color-only
- [ ] Quiet inline SaveTrust; polite aria-live only for save-trust and incident banner
- [ ] Ordinary My Pools / Week Board / standings views do not require loading entire-season picks; board stays interactive under live updates
- [ ] Closed component inventory and Only Pools tokens applied via shadcn theme
- [ ] Acceptance scenarios 45–48 demonstrated via scripted smoke and selective automation
