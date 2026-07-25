@AGENTS.md

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `wrowston/only-pools`. See `docs/agents/issue-tracker.md`.

### Triage labels

The project uses the five canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using the root `CONTEXT.md` glossary and relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
