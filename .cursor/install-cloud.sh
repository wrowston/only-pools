#!/usr/bin/env bash
# Idempotent Cloud Agent install. Runs during a Build, not at every agent boot.
set -euo pipefail

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if [ -f "$HOME/.bashrc" ] && ! grep -q 'BUN_INSTALL' "$HOME/.bashrc"; then
  {
    echo ''
    echo 'export BUN_INSTALL="$HOME/.bun"'
    echo 'export PATH="$BUN_INSTALL/bin:$PATH"'
  } >> "$HOME/.bashrc"
fi

bun install --frozen-lockfile
