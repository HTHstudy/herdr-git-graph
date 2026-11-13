#!/bin/sh
# Re-copy mods into ~/.config/herdr-app/mods on every change (needs fswatch).
cd "$(dirname "$0")/.." || exit 1
scripts/link.sh --copy
fswatch -o mods | xargs -n1 -I{} scripts/link.sh --copy
