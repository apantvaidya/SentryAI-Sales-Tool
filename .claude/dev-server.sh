#!/bin/bash
# Wrapper so the preview harness can launch the Next dev server with node on PATH.
export PATH="/Users/apantvaidya/.nvm/versions/node/v24.17.0/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
exec npm run dev
