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
# 1200, not 800: pinned get half the budget, and the pinned environment-gotchas
# memory (ghost-promote.sh, up to ~300 tok) plus the other pins (~300)
# overflowed 400 and dropped two pins (eval 2026-10-08).
BUDGET="${GHOST_SESSION_BUDGET:-1200}"

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
# shellcheck source=/dev/null
. "$(dirname "$0")/ghost-transcript.sh"
# Main repo (+ unit, e.g. myrepo/api), the same key capture tags with.
PROJECT_NAME=$([ -n "$PROJECT_DIR" ] && ghost_repo_key "$PROJECT_DIR" || echo unknown)
FOLDER_NAME=$(basename "${PROJECT_DIR:-unknown}")
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
  # Memories captured before 2026-10-08 carry the folder name (worktree, unit).
  [ "$FOLDER_NAME" != "$PROJECT_NAME" ] && TAG_ARGS="$TAG_ARGS -t project:${FOLDER_NAME}"
fi

MEMORIES=""
# $TAG_ARGS is two words (-t project:x) and must split; empty when no project.
# shellcheck disable=SC2086
AGENT_RAW=$($GHOST context "$QUERY" -n "$AGENT_NS" $TAG_ARGS --budget "$BUDGET" --min-score "$MIN_SCORE" 2>/dev/null || echo "{}")
AGENT_MEM=$(echo "$AGENT_RAW" | jq -r '.memories[]? | "[\(.key)] \(.content)"' 2>/dev/null || echo "")
if [ -n "$AGENT_MEM" ]; then
  if [ -n "$TAG_ARGS" ]; then
    MEMORIES="## Project: ${PROJECT_NAME}"$'\n'"${AGENT_MEM}"
  else
    MEMORIES="## Agent Knowledge"$'\n'"${AGENT_MEM}"
  fi
fi

TRACE_PHASES=("$(ghost_trace_phase "$([ -n "$TAG_ARGS" ] && echo project || echo single)" "$AGENT_RAW")")
INJECTED_KEYS=$(printf '%s' "$AGENT_MEM" | sed -n 's/^\[\([^]]*\)\] .*/\1/p')
if [ -z "$MEMORIES" ]; then
  ghost_trace session-start empty "no memory passed min-score ${MIN_SCORE}" "$QUERY" "" "${TRACE_PHASES[@]}"
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

# No "memory hygiene" curate prompt: in 6,706 memories none was ever marked used
# (used_count = 0, 2026-10-08), so it was ~60 tokens of ignored text per session.
# printf, not echo -e: memory text can hold a literal \n (e.g. a shell gotcha).
printf '[Ghost Memory — Session Start]\n%s\n[End Ghost Memory]\n' "$MEMORIES"
