#!/usr/bin/env bash
# Ghost memory capture — PreCompact hook (also used for SessionEnd).
# Flushes what ghost-stop.sh has not captured yet: the stop hook reads each
# part of a session once, after enough new conversation builds up, so the tail
# before a compaction (or the end of a session) would otherwise wait or be lost.
# Before 2026-10-08 this hook ran its own capture over the whole transcript,
# repeating what the stop hook had already stored.
GHOST_CAPTURE_FLUSH=1 GHOST_CAPTURE_MAX_CHARS="${GHOST_CAPTURE_FLUSH_MAX_CHARS:-150000}" \
  exec "$(dirname "$0")/ghost-stop.sh"
