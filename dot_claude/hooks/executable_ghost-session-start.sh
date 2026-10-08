#!/usr/bin/env bash
# Ghost memory retrieval — SessionStart hook
# Injects environment-aware context at session start.
# Output goes to stdout → Claude Code injects as additionalContext.
#
# Configure via environment variables:
#   GHOST_BIN       — path to ghost binary (default: ghost on PATH)
#   GHOST_AGENT_NS  — agent namespace (default: agent:claude-code)
set -euo pipefail

GHOST="${GHOST_BIN:-ghost}"
# ORT reranker backend: hugot loads libonnxruntime.dylib at runtime from this dir
export GHOST_ONNXRUNTIME_PATH="${GHOST_ONNXRUNTIME_PATH:-/opt/homebrew/lib}"
# Utility-weighted scoring: parasite bench on a live snapshot (2026-07-28) showed
# w=0.5 lifts recall canary 7/8 -> 8/8 and zero-utility share 2% -> 0%.
export GHOST_UTILITY_WEIGHT="${GHOST_UTILITY_WEIGHT:-0.5}"
# Drop edge-expansion passengers scoring under 0.05 (contradicts and other
# reserved edges are exempt). Edge A/B 2026-10-06 (ghost evals/claude-code):
# removed every near-zero passenger in a 40-query live replay, kept multi-hop
# traversal intact (edges off broke it), no change in agent outcomes.
export GHOST_EDGE_MIN_SCORE="${GHOST_EDGE_MIN_SCORE:-0.05}"
AGENT_NS="${GHOST_AGENT_NS:-agent:claude-code}"
# Absolute relevance floor — suppresses low-confidence retrievals at scale
# (live DB: on-topic non-pinned ≥0.66, junk ~0.19; pinned bypass the floor).
# The flooding gate rescues topically-dominant old memories from this floor.
MIN_SCORE="${GHOST_MIN_SCORE:-0.55}"
# One lookup, small budget. Eval 2026-10-07 (ghost docs/research/session-start-eval-2026-10-07.md):
# ~3 useful memories in 18 sessions, 77% of tokens irrelevant, and the old
# untagged "general" call (500 tok) had 0 useful of 69 — it only re-found pinned
# memories, which the project call already returns. Pinned bypass the floor.
BUDGET="${GHOST_SESSION_BUDGET:-800}"

# Guard against recursive invocation
if [ "${GHOST_SESSION_HOOK:-}" = "1" ]; then
  exit 0
fi
export GHOST_SESSION_HOOK=1

# Read hook input for environment context
HOOK_INPUT=$(cat)
PROJECT_DIR=$(echo "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null)
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SOURCE=$(echo "$HOOK_INPUT" | jq -r '.source // "startup"' 2>/dev/null)
PROJECT_NAME=$(basename "${PROJECT_DIR:-unknown}")
TIMESTAMP=$(date -Iseconds)

# Trace for viewers (ghost-lens mod): what was loaded, scores, skip reasons.
# shellcheck source=/dev/null
. "$(dirname "$0")/ghost-trace.sh" 2>/dev/null || {
  ghost_trace() { :; }
  ghost_trace_phase() { :; }
}

# Build environment-aware query so ghost scores relevance properly
QUERY="working in ${PROJECT_NAME} at ${PROJECT_DIR:-unknown}, session ${SOURCE} at ${TIMESTAMP}"

# Project-scoped tag filter: when working in a known project, prefer project-tagged memories
TAG_ARGS=""
if [ -n "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "unknown" ] && [ "$PROJECT_NAME" != "/" ]; then
  TAG_ARGS="-t project:${PROJECT_NAME}"
fi

MEMORIES=""
# $TAG_ARGS is two words (-t project:x) and must split; empty when no project.
# shellcheck disable=SC2086
AGENT_RAW=$($GHOST context "$QUERY" -n "$AGENT_NS" $TAG_ARGS --budget "$BUDGET" --min-score "$MIN_SCORE" 2>/dev/null || echo "{}")
AGENT_MEM=$(echo "$AGENT_RAW" | jq -r '.memories[]? | "[\(.key)] \(.content)"' 2>/dev/null || echo "")
if [ -n "$AGENT_MEM" ]; then
  if [ -n "$TAG_ARGS" ]; then
    MEMORIES="## Project: ${PROJECT_NAME}\n${AGENT_MEM}"
  else
    MEMORIES="## Agent Knowledge\n${AGENT_MEM}"
  fi
fi

TRACE_PHASES=("$(ghost_trace_phase "$([ -n "$TAG_ARGS" ] && echo project || echo single)" "$AGENT_RAW")")
INJECTED_KEYS=$(printf '%s' "$AGENT_MEM" | sed -n 's/^\[\([^]]*\)\] .*/\1/p')

# Proposed CLAUDE.md gotchas (ghost-gotcha-promote.sh): told to one fresh session
# per new proposal set, not to every parallel session.
GOTCHA_NOTE=""
PROPOSALS="$HOME/.ghost/gotcha-proposals.md"
SEEN="$HOME/.ghost/gotcha-proposals.seen"
if [ "$SOURCE" = "startup" ] && [ -s "$PROPOSALS" ] && { [ ! -f "$SEEN" ] || [ "$PROPOSALS" -nt "$SEEN" ]; }; then
  N=$(grep -c '^- ' "$PROPOSALS" 2>/dev/null || echo 0)
  GOTCHA_NOTE="Ghost proposes ${N} CLAUDE.md gotcha line(s), each hit in 2+ sessions: ${PROPOSALS}. Mention this to the user once, in one line, at a natural pause. Never edit CLAUDE.md without their approval."
  touch "$SEEN" 2>/dev/null || true
fi

if [ -z "$MEMORIES" ]; then
  ghost_trace session-start empty "no memory passed min-score ${MIN_SCORE}" "$QUERY" "" "${TRACE_PHASES[@]}"
  [ -n "$GOTCHA_NOTE" ] && echo -e "[Ghost Memory — Session Start]\n$GOTCHA_NOTE\n[End Ghost Memory]"
  exit 0
fi
ghost_trace session-start injected "" "$QUERY" "$INJECTED_KEYS" "${TRACE_PHASES[@]}"

# Write loaded keys to temp file for UserPromptSubmit dedup. On resume the whole
# transcript comes back, so keep what the session already saw; on startup, clear
# and compact the earlier injections are gone from context, so start fresh.
KEYS_FILE="/tmp/ghost-session-keys-${SESSION_ID:-default}"
PREV_KEYS=/dev/null
if [ "$SOURCE" = "resume" ] && [ -f "$KEYS_FILE" ]; then
  PREV_KEYS="${KEYS_FILE}.prev"
  cp "$KEYS_FILE" "$PREV_KEYS" 2>/dev/null || PREV_KEYS=/dev/null
fi
echo "$AGENT_RAW" 2>/dev/null | jq -r '.memories[]?.key // empty' 2>/dev/null | cat - "$PREV_KEYS" | sort -u >"$KEYS_FILE" 2>/dev/null || true

CURATE_HINT="**Memory hygiene**: After your first substantive task, scan the memories above and curate — ghost_curate(op='boost') relevant ones, ghost_curate(op='diminish') irrelevant ones. This trains the utility signal."

echo -e "[Ghost Memory — Session Start]\n$MEMORIES\n\n$CURATE_HINT${GOTCHA_NOTE:+\n$GOTCHA_NOTE}\n[End Ghost Memory]"
