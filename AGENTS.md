<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

<!-- effect-start -->

## Effect

This project uses [Effect](https://effect.website) (stable 3.x) for typed effects at impure boundaries.

Conventions:

- Prefer Effect for external I/O and multi-step impure workflows (e.g. TheSportsDB).
- Use `Data.TaggedError` (or Schema-tagged errors) instead of `throw new Error` in new Effect code.
- Decode unknown I/O with Effect `Schema` at boundaries. Convex `v.*` validators remain the source of truth for Convex args and `convex/schema.ts`.
- Call `runEffect` / `runAppEffect` only at action, script, or HTTP edges. Do not put Layer graphs inside Convex mutations/queries.
- New Effect modules should prefer namespace/deep imports (`import * as Effect from "effect/Effect"`) when practical.
- Convex Effect code lives under `convex/effect/`. Next.js edge helpers live under `lib/effect/`.

<!-- effect-end -->
