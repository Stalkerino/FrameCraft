#!/bin/sh
set -eu
FRAMECRAFT_BUILD_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -x "$FRAMECRAFT_BUILD_ROOT/.runtime/node/bin/node" ]; then
    FRAMECRAFT_BUILD_NODE="$FRAMECRAFT_BUILD_ROOT/.runtime/node/bin/node"
else
    FRAMECRAFT_BUILD_NODE=$(command -v node || true)
fi
if [ -z "$FRAMECRAFT_BUILD_NODE" ]; then
    echo 'Install Node.js 22+ with npm first (or run Install-Linux.sh --no-launch).' >&2
    exit 1
fi
exec "$FRAMECRAFT_BUILD_NODE" "$FRAMECRAFT_BUILD_ROOT/scripts/build-desktop.mjs" "$@"
