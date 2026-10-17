#!/usr/bin/env sh
# Start the Trace self-host server. Runs from this directory so config.json is
# picked up. Any arguments are passed through to serve.py.
set -eu
cd "$(dirname "$0")"
exec python3 serve.py "$@"
