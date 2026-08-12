#!/usr/bin/env bash
# Boot Next.js for Cloud Agents. Safe to run from both `start` and `terminals`.
set -euo pipefail

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

# Dashboard Cloud Agent secrets win. Placeholders only boot marketing HTML for UI demos.
if [ -z "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]; then
  export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_Y2xlcmsuZXhhbXBsZS5jb20k"
fi
if [ -z "${CLERK_SECRET_KEY:-}" ]; then
  export CLERK_SECRET_KEY="sk_test_c2VjcmV0"
fi

if curl -sf --max-time 2 "http://127.0.0.1:3000/" >/dev/null; then
  echo "Next.js already serving at http://127.0.0.1:3000"
  exec tail -f /dev/null
fi

exec bun run dev -- --hostname 127.0.0.1 --port 3000
