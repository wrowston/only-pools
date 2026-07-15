# 05 — Submit and lock Survivor picks

**What to build:** An Alive Survivor Participant autosaves one team pick per included week (including Thursday games and provisional advance weeks), with one-use reservations that release on unlocked changes. Game Kickoff Lock rejects mutations at authoritative kickoff or provider start with no grace period. Unlocked picks stay Hidden from opponents, Owner, and Admins; lock reveals provenance. SaveTrust shows quiet inline save state on the Week Board.

**Blocked by:** 03 — Create an Active Pool and open the Week Board

**Status:** done

- [x] Autosave mutations persist without a Save button; failed units are explained
- [x] One-use team reservation applies to accepted and provisional picks; unlocked change releases and re-reserves
- [x] Game Kickoff Lock is server-authoritative; client clock is irrelevant; no grace period
- [x] Hidden Picks non-leak to other participants, Owner/Admin, logs, and analytics before lock
- [x] Lock reveals authored vs omission provenance as settled
- [x] Automated tests cover Pick Lock rejection and Hidden Picks non-leak (acceptance scenarios 19–20, 22, 37; Survivor pick families toward 12–14)
