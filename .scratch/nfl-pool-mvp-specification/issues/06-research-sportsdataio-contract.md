Type: research
Status: resolved
Blocked by: none

# Research the SportsDataIO NFL data contract

## Question

What do the current SportsDataIO NFL API and service terms actually provide or constrain for the MVP's teams, schedules, season/week structure, kickoff changes, live states, scores, finalization, ties, postponements, cancellations, corrections, identifiers, rate limits, costs, and permitted storage or display, and which assumptions in the source brief require a product or architecture decision?

## Answer

The [full research findings](../research/sportsdataio-nfl-contract.md) establish that SportsDataIO provides the required NFL schedule, identity, live-state, exceptional-state, score, finalization, and reschedule data. The provider's current lifecycle includes `Forfeit`, provisional `Final`, verified `IsClosed`, same-ID and new-ID reschedules, and rare later corrections that the product policies and normalized model must handle.

Live production access is the unresolved constraint: the free trial is scrambled and cannot be displayed, Discovery Lab is next-day delayed, and real-time access requires a commercial agreement with unpublished price and app-specific license terms. [Obtain SportsDataIO production proposals](./14-obtain-sportsdataio-production-proposals.md) and [Choose the SportsDataIO production contract](./15-choose-sportsdataio-production-contract.md) capture the newly required work and decision.
