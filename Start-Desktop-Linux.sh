#!/bin/sh
set -eu
FRAMECRAFT_DESKTOP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FRAMECRAFT_DESKTOP_NODE=node
if [ -x "$FRAMECRAFT_DESKTOP_ROOT/.runtime/node/bin/node" ]; then FRAMECRAFT_DESKTOP_NODE="$FRAMECRAFT_DESKTOP_ROOT/.runtime/node/bin/node"; fi
exec "$FRAMECRAFT_DESKTOP_NODE" "$FRAMECRAFT_DESKTOP_ROOT/scripts/start-desktop.mjs"
