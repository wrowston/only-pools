# SportsDataIO NFL contract research

Researched on 2026-07-13 against SportsDataIO's first-party developer documentation, data dictionary, FAQ, public terms, and NFL OpenAPI schema.

## Conclusion

SportsDataIO exposes the teams, schedules, NFL timeframes, live game state, final scores, stable identifiers, reschedule links, and exceptional statuses needed by the MVP. Its data model is capable of supporting the source brief.

The access assumption is not yet viable, however. SportsDataIO's free trial contains scrambled data that cannot be used for display; Discovery Lab is next-day delayed and explicitly unsuitable for live applications; and current real-time production data requires a commercial agreement. SportsDataIO does not publish production pricing, the app-specific license rights for storing and displaying provider data, or the exact SLA on its public developer pages. A production proposal must therefore be obtained before the SportsDataIO product/feed and operating envelope can be decided.

"Free to use" for participants does not imply a free provider, but a production-ready specification cannot leave the operator's provider cost and license rights unknown.

## Relevant API surface

The [official NFL OpenAPI 3.1 schema](https://cdn.sportsdata.io/openapi/NFL-openapi-3.1.json) identifies a small surface sufficient for this product:

- `TeamsBasic` or the season-scoped team endpoints for NFL team identity and display metadata.
- `SchedulesBasic/{season}` or `Schedules/{season}` for the season schedule and kickoff changes.
- `ScoresBasic/{season}/{week}` for a lightweight live-and-final weekly score feed; the full weekly score feed adds game-state and game-day detail the MVP may not need.
- `ScoresBasicFinal/{season}/{week}` for final-only weekly results.
- `Timeframes/{type}`, `CurrentSeason`, `CurrentWeek`, `UpcomingWeek`, and related helpers for provider context. These are signals, not a substitute for the Pool's own season/week lifecycle decision.

All endpoints are HTTP `GET`. The [NFL API documentation](https://sportsdata.io/developers/api-documentation/nfl) permits the API key as a query parameter or, preferably for secret handling, in the `Ocp-Apim-Subscription-Key` request header.

The `ScoreBasic` model includes the fields this app needs: `GameID`, `GlobalGameID`, season and season type, week, status, cancellation flag, Eastern and UTC kickoff timestamps, home/away team IDs, scores, `LastUpdated`, `IsClosed`, and the `RescheduledFromGameID`/`RescheduledGameID` relationship.

## Time and season semantics

- NFL seasons span two calendar years and are named for the year in which they begin. Season types include regular, preseason, postseason, and all-star. The app should not infer a season from the current calendar year. [SportsDataIO FAQ](https://sportsdata.io/help/faq#which-season-type-parameters-will-i-need-to-use)
- The provider observes Eastern time, including daylight-saving changes, and also supplies UTC timestamps. Pick locking should be based on normalized instants rather than display-time strings. [SportsDataIO FAQ](https://sportsdata.io/help/faq#which-time-zone-is-used-in-your-api-endpoints)
- SportsDataIO describes the NFL week as changing around Tuesday night or Wednesday midnight Eastern, while its richer timeframe helper may advance an upcoming week as soon as the previous week's games complete. That provider notion cannot by itself define the Pool's current week. [SportsDataIO NFL workflow guide](https://sportsdata.io/developers/workflow-guide/nfl), [SportsDataIO FAQ](https://sportsdata.io/help/faq#where-can-i-find-nfl-timeframes)
- Playoff game records are created only when teams are known, and the next playoff round is not created until the prior round completes. The app must tolerate a valid Pool week whose complete slate is not yet known. [SportsDataIO NFL workflow guide](https://sportsdata.io/developers/workflow-guide/nfl)

The public OpenAPI description for one weekly endpoint still says regular-season weeks are 1–17, while the current data dictionary describes weeks 1–18. This documentation inconsistency is evidence that week ranges should come from synced schedule data and validated provider responses rather than hard-coded constants.

## Game identity and exceptional states

SportsDataIO uses these NFL states: `Scheduled`, `InProgress`, `Final`, `F/OT`, `Suspended`, `Postponed`, `Delayed`, `Canceled`, and `Forfeit`. The source brief does not explicitly address forfeits. [SportsDataIO NFL workflow guide](https://sportsdata.io/developers/workflow-guide/nfl)

- A same-week NFL reschedule normally retains the same `GameID` and updates the kickoff time.
- A reschedule into a different NFL week marks the original record postponed and creates a new record with a new `GameID`.
- Rescheduled records are associated through `RescheduledGameID` and `RescheduledFromGameID`.
- A suspended game retains its identity and may return to `InProgress`; suspension resume fields can indicate the planned resumption.
- A canceled game will not be played.

These are provider facts, not product policy. [SportsDataIO postponed-game FAQ](https://sportsdata.io/help/faq#how-do-you-handle-postponed-suspended-and-canceled-games), [SportsDataIO NFL workflow guide](https://sportsdata.io/developers/workflow-guide/nfl)

The provider also warns that a game may rarely be removed and recreated to preserve data stability across upstream changes, with clients notified when this occurs. An internal provider mapping therefore needs to tolerate replacement rather than assuming `GameID` is an eternal domain identity. [SportsDataIO FAQ](https://sportsdata.io/help/faq#how-are-neutral-venue-games-handled)

## Freshness, finalization, and correction

- Live game-state coverage begins when status changes to `InProgress` and is described as roughly 15–20 seconds behind the broadcast.
- Final-only scores are described as available roughly 5–10 minutes after a game concludes.
- A game may first be `Final`; `IsClosed` flips later, after SportsDataIO verifies the result, normally about 5–10 minutes after the game ends.
- SportsDataIO says final-score changes after finalization are extremely rare but possible. Stat corrections can happen later; the pool app mostly cares about score/winner corrections rather than player-stat changes.

The scoring decision must therefore distinguish provisional final, verified closed, and later corrected data rather than treating the first `Final` observation as forever immutable. [SportsDataIO NFL workflow guide](https://sportsdata.io/developers/workflow-guide/nfl), [SportsDataIO FAQ](https://sportsdata.io/help/faq#once-a-game-is-final-can-changes-to-the-score-or-stats-still-happen)

## Access, rate limits, price, and rights

SportsDataIO's [current developer access guide](https://sportsdata.io/developers) distinguishes these relevant modes:

| Access mode | Data | Limits and suitability |
| --- | --- | --- |
| Free Trial | Scrambled, structurally representative | Small daily limit, no SLA, and the data cannot be used for analysis or display. Suitable only for integration development. |
| Replay | Historical games replayed on a live schedule | Useful for off-season workflow testing, not current games. Availability depends on sport. |
| Dev Key | Scrambled data | No daily call limit, but requires sales approval and a credible path to a commercial agreement. Not suitable for final QA. |
| Discovery Lab | Real, next-day-delayed data | 100–1,000 calls/day by tier, no SLA, unsuitable for live apps, and not licensed for commercial redistribution. The free tier exposes last season only. |
| Leagues API | Real-time league-specific data | Commercial agreement, production SLA/support, unlimited calls, and use-case-based unpublished pricing. |
| Global Sports API | Real-time top-line schedules and scores | Commercial agreement with unpublished pricing; a potentially smaller conceptual fit than the deep Leagues API, but NFL coverage and commercial terms must be confirmed in a proposal. |

The [public Terms of Service](https://sportsdata.io/terms-of-service) grant only a limited, non-transferable, non-sublicensable license in accordance with the applicable terms and prohibit copying or distributing content except as expressly permitted. They are not enough to establish this app's right to persist normalized schedules/results and display them to users. The signed commercial agreement must explicitly cover those uses, retention after termination, attribution if any, and whether a free-to-users private-pool application is an allowed distribution model.

## Decisions and work surfaced

1. Obtain written SportsDataIO proposals for the minimal live NFL schedule/score use case, covering both a suitable Leagues API feed and the Global Sports API if NFL coverage is available.
2. Confirm price, SLA, call-volume expectations, credential/environment structure, allowed server-side storage, derived standings, user-facing display, attribution, historical retention, termination behavior, and whether a free private-pool web app is licensed.
3. Choose the SportsDataIO product/feed and establish an operator-funded budget and capacity envelope. This is compatible with the locked decision that participants are never billed.
4. Treat provider `CurrentWeek` as input, not the product's Pool-week authority.
5. Use UTC instants for enforcement; use provider Eastern timestamps only as input and display context.
6. Preserve provider IDs and reschedule relationships behind an internal game identity/mapping layer.
7. Model provisional final, verified closed, and later corrected results distinctly enough for idempotent rescoring and visible recovery.
8. Add forfeit behavior to the disrupted-game product policy.

## Primary sources

- [SportsDataIO developer access guide](https://sportsdata.io/developers)
- [SportsDataIO NFL workflow guide](https://sportsdata.io/developers/workflow-guide/nfl)
- [SportsDataIO NFL API documentation](https://sportsdata.io/developers/api-documentation/nfl)
- [SportsDataIO NFL data dictionary](https://sportsdata.io/developers/data-dictionary/nfl)
- [SportsDataIO NFL OpenAPI schema](https://cdn.sportsdata.io/openapi/NFL-openapi-3.1.json)
- [SportsDataIO FAQ](https://sportsdata.io/help/faq)
- [SportsDataIO Terms of Service](https://sportsdata.io/terms-of-service)
