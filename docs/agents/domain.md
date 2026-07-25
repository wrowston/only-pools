# Domain docs

How engineering skills should consume this repository's domain documentation.

## Before exploring

- Read the root `CONTEXT.md` glossary.
- Read relevant ADRs under `docs/adr/` when that directory exists.
- Proceed silently when a referenced domain document or ADR directory does not exist.

## Layout

This is a single-context repository. Its shared glossary lives at the repository root, and system-wide architectural decisions belong under `docs/adr/`.

## Vocabulary

Use the canonical terms defined in `CONTEXT.md` in specifications, issues, test names, and implementation notes. Do not substitute synonyms that the glossary explicitly marks as avoided.

If a needed concept is absent, reconsider whether existing vocabulary already covers it. When it represents a genuine domain gap, note it for later domain modeling rather than silently inventing competing language.

## ADR conflicts

Surface any conflict with an existing ADR explicitly instead of silently overriding the recorded decision.
