#!/usr/bin/env bash
# Ghost memory retrieval — UserPromptSubmit hook
# Injects per-prompt relevant memories with small budget.
# Deduplicates against keys already loaded by SessionStart hook.
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
AGENT_NS="${GHOST_AGENT_NS:-agent:claude-code}"
# Retrieval noise filters (new in ghost): absolute score floor + flat-noise
# spread collapse. Live-DB calibration: on-topic non-pinned ≥0.66, junk ~0.19.
MIN_SCORE="${GHOST_MIN_SCORE:-0.55}"
MIN_SPREAD="${GHOST_MIN_SPREAD:-0.15}"
FILTERS=(--min-score "$MIN_SCORE" --min-spread "$MIN_SPREAD")

HOOK_INPUT=$(cat)
QUERY=$(echo "$HOOK_INPUT" | jq -r '.prompt // empty' 2>/dev/null)
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null)
PROJECT_NAME=$(basename "${CWD:-unknown}")

if [ -z "$QUERY" ] || [ ${#QUERY} -lt 10 ]; then
  exit 0  # Skip trivial prompts
fi

# Buffer the raw prompt for the mechanical capture tier (ghost-stop-heuristic.sh).
# This hook receives .prompt — exactly what the user typed — whereas the Stop
# hook only has the transcript, where user speech is multiplexed with harness
# control messages, hook-injected context, skill bodies and tool results, all
# labelled type=user. Pattern-stripping that stream repeatedly failed (junk
# regenerated under new keys), so capture reads THIS buffer instead: clean user
# speech by construction. Slash commands and automation prompts are excluded
# here rather than downstream.
#
# Intent guard: buffer ASSERTIONS, not questions or directives. Filler like
# "lets keep building", "is the tip button actually functional?", "can you run
# it locally" is real user speech, so the speaker filter keeps it, and it scores
# 0.56-0.76 salience — overlapping genuine conventions, so no threshold
# separates them either. What separates them is intent: this tier's job is to
# learn what the user ASSERTED (conventions, corrections, preferences), and a
# question or a task request asserts nothing. Measured 2026-07-28: filler was
# ~50% of that day's captures and one such memory ("lets-keep-building-a")
# became the 3rd most-retrieved memory in the store, riding into 236 sessions.
PROMPT_BUF="/tmp/ghost-prompt-buffer/${SESSION_ID:-default}.txt"
mkdir -p "$(dirname "$PROMPT_BUF")" 2>/dev/null || true
QLOW=$(printf '%s' "$QUERY" | tr '[:upper:]' '[:lower:]')
case "$QLOW" in
  /*|'<'*|"run ~/"*) : ;;                        # slash command, harness tag, cron prompt
  *"ghost-monitor.sh"*) : ;;                     # scheduled monitor prompt
  *\?|\(*) : ;;                                  # question
  can\ *|could\ *|is\ *|are\ *|does\ *|do\ *|did\ *|should\ *|would\ *|will\ *) : ;;
  what\ *|why\ *|how\ *|where\ *|when\ *|who\ *|which\ *) : ;;
  lets\ *|"let's "*|go\ ahead*|okay*|ok\ *|sure*|yes*|yeah*|nice*|thanks*) : ;;
  also\ *|oh,\ *|"actually,"*|hmm*|great*|perfect*) : ;;
  it\ would\ *|maybe\ *|please\ *|try\ *|we\ can\ *|we\ could\ *|"i think we"*) : ;;
  *root@*|*"-----"*) : ;;                        # pasted terminal output / log dumps
  *) printf 'User: %s\n' "$(printf '%s' "$QUERY" | tr '\n\r' '  ')" >> "$PROMPT_BUF" 2>/dev/null || true ;;
esac

# Build dedup key set from SessionStart
KEYS_FILE="/tmp/ghost-session-keys-${SESSION_ID:-default}"
LOADED_KEYS=""
if [ -f "$KEYS_FILE" ]; then
  LOADED_KEYS=$(cat "$KEYS_FILE")
fi

# Two-phase retrieval: project-scoped first, then general (like SessionStart)
# This prevents high-importance cross-project memories from drowning out
# project-relevant ones while still allowing cross-project knowledge to surface.
MEM=""
if [ -n "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "unknown" ] && [ "$PROJECT_NAME" != "/" ]; then
  # Phase 1: project-scoped (1000 tokens)
  PROJ_RAW=$($GHOST context "$QUERY" -n "$AGENT_NS" -t "project:${PROJECT_NAME}" --budget 1000 "${FILTERS[@]}" 2>/dev/null || echo "{}")
  if [ -n "$LOADED_KEYS" ]; then
    PROJ_MEM=$(echo "$PROJ_RAW" | jq -r --slurpfile loaded <(echo "$LOADED_KEYS" | jq -R . | jq -s .) \
      '.memories[]? | select(.key as $k | ($loaded[0] // []) | index($k) | not) | "[\(.key)] \(.content)"' 2>/dev/null || echo "")
    PROJ_KEYS=$(echo "$PROJ_RAW" | jq -r --slurpfile loaded <(echo "$LOADED_KEYS" | jq -R . | jq -s .) \
      '.memories[]? | select(.key as $k | ($loaded[0] // []) | index($k) | not) | .key' 2>/dev/null || echo "")
  else
    PROJ_MEM=$(echo "$PROJ_RAW" | jq -r '.memories[]? | "[\(.key)] \(.content)"' 2>/dev/null || echo "")
    PROJ_KEYS=$(echo "$PROJ_RAW" | jq -r '.memories[]?.key' 2>/dev/null || echo "")
  fi

  # Phase 2: general (500 tokens), dedup against both SessionStart AND Phase 1 keys
  ALL_LOADED=$(printf "%s\n%s" "$LOADED_KEYS" "$PROJ_KEYS" | sort -u)
  GEN_RAW=$($GHOST context "$QUERY" -n "$AGENT_NS" --budget 500 "${FILTERS[@]}" 2>/dev/null || echo "{}")
  if [ -n "$ALL_LOADED" ]; then
    GEN_MEM=$(echo "$GEN_RAW" | jq -r --slurpfile loaded <(echo "$ALL_LOADED" | jq -R . | jq -s .) \
      '.memories[]? | select(.key as $k | ($loaded[0] // []) | index($k) | not) | "[\(.key)] \(.content)"' 2>/dev/null || echo "")
  else
    GEN_MEM=$(echo "$GEN_RAW" | jq -r '.memories[]? | "[\(.key)] \(.content)"' 2>/dev/null || echo "")
  fi

  [ -n "$PROJ_MEM" ] && MEM="$PROJ_MEM"
  [ -n "$GEN_MEM" ] && MEM="${MEM:+${MEM}\n}${GEN_MEM}"
else
  # No project context — single query
  RAW=$($GHOST context "$QUERY" -n "$AGENT_NS" --budget 1500 "${FILTERS[@]}" 2>/dev/null || echo "{}")
  if [ -n "$LOADED_KEYS" ]; then
    MEM=$(echo "$RAW" | jq -r --slurpfile loaded <(echo "$LOADED_KEYS" | jq -R . | jq -s .) \
      '.memories[]? | select(.key as $k | ($loaded[0] // []) | index($k) | not) | "[\(.key)] \(.content)"' 2>/dev/null || echo "")
  else
    MEM=$(echo "$RAW" | jq -r '.memories[]? | "[\(.key)] \(.content)"' 2>/dev/null || echo "")
  fi
fi

if [ -n "$MEM" ]; then
  echo -e "[Ghost Memory — Relevant]\n$MEM\n[End Ghost Memory]"
fi
