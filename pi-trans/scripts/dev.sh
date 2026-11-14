#!/bin/sh
# Run only this checkout's pi-trans extension, without changing pi's settings.
# Usage: ./scripts/dev.sh [pi arguments...]
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ ! -d "$ROOT/node_modules" ]; then
  echo "Installing dependencies in $ROOT" >&2
  (cd "$ROOT" && npm install)
fi

# Disable discovered and built-in extensions; explicit -e paths still load.
exec pi --no-extensions -e "$ROOT/src/index.ts" "$@"
