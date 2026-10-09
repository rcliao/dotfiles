#!/usr/bin/env bash
# Ghost memory capture — SessionEnd hook. Flushes what the stop hook has not
# captured yet (see ghost-precompact.sh), detached so the capture call outlives
# the exiting session.
INPUT=$(cat)
( printf '%s' "$INPUT" | nohup "$(dirname "$0")/ghost-precompact.sh" >/dev/null 2>&1 & )
exit 0
