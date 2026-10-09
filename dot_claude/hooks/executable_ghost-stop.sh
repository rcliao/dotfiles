#!/usr/bin/env bash
# Ghost memory capture — Stop hook
# Captures learnings when Claude finishes responding, then consolidates
# them under a session summary node for hierarchical recall.
#
# Configure via environment variables:
#   GHOST_BIN       — path to ghost binary (default: ghost on PATH)
#   GHOST_AGENT_NS  — agent namespace (default: agent:claude-code)
#   GHOST_LLM_MODEL — model for extraction (default: claude-sonnet-4-6)
set -uo pipefail

# Capture children (the `claude -p` below runs with GHOST_SESSION_HOOK=1) have
# nothing worth capturing.
if [ "${GHOST_SESSION_HOOK:-}" = "1" ]; then
  exit 0
fi

GHOST="${GHOST_BIN:-ghost}"
# ORT reranker backend: hugot loads libonnxruntime.dylib at runtime from this dir
export GHOST_ONNXRUNTIME_PATH="${GHOST_ONNXRUNTIME_PATH:-/opt/homebrew/lib}"
# Utility-weighted scoring: parasite bench on a live snapshot (2026-07-28) showed
# w=0.5 lifts recall canary 7/8 -> 8/8 and zero-utility share 2% -> 0%.
export GHOST_UTILITY_WEIGHT="${GHOST_UTILITY_WEIGHT:-0.5}"
AGENT_NS="${GHOST_AGENT_NS:-agent:claude-code}"
LLM_MODEL="${GHOST_LLM_MODEL:-claude-sonnet-4-6}"
# Each run logs to its own buffer and appends it whole on exit: concurrent
# Stop hooks interleaved in the shared log, and capture output landed under
# the wrong session (12% of checkable runs, 2026-10-08).
SHARED_LOG="${GHOST_STOP_LOG:-/tmp/ghost-stop-debug.log}"
DEBUG_LOG=$(mktemp "${TMPDIR:-/tmp}/ghost-stop.XXXXXX" 2>/dev/null) || DEBUG_LOG="$SHARED_LOG"
KEYS_FILE=""
WINDOW_FILE=""
ghost_stop_cleanup() {
  trap - ERR # a failing test here must not re-log into the buffer just removed
  if [ "$DEBUG_LOG" != "$SHARED_LOG" ]; then
    cat "$DEBUG_LOG" >>"$SHARED_LOG" 2>/dev/null
    rm -f "$DEBUG_LOG"
  fi
  if [ -n "$KEYS_FILE" ]; then rm -f "$KEYS_FILE"; fi
  if [ -n "$WINDOW_FILE" ]; then rm -f "$WINDOW_FILE" "$WINDOW_FILE.open"; fi
  return 0
}
trap ghost_stop_cleanup EXIT

# Trap errors so Claude Code gets stderr output instead of silent failure
trap 'echo "ghost-stop.sh failed at line $LINENO" >&2; echo "Error at line $LINENO" >> "$DEBUG_LOG"' ERR

HOOK_INPUT=$(cat)

echo "=== $(date -Iseconds) ===" >>"$DEBUG_LOG"

# Extract environment context
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // empty' 2>/dev/null)
# shellcheck source=/dev/null
. "$(dirname "$0")/ghost-transcript.sh"
# Main repo (+ unit), not the folder name: worktrees split one repo into many.
PROJECT_NAME=$(ghost_repo_key "${CWD:-unknown}")
DATE=$(date +%Y-%m-%d)
SESSION_TAG="session:${SESSION_ID:-$(date +%s)}"

echo "Environment: project=$PROJECT_NAME cwd=$CWD session=$SESSION_TAG" >>"$DEBUG_LOG"

# Extract transcript path
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

if [ -z "$TRANSCRIPT_PATH" ]; then
  if [ -n "$SESSION_ID" ]; then
    TRANSCRIPT_PATH=$(find ~/.claude/projects -name "${SESSION_ID}*.jsonl" 2>/dev/null | head -1)
  fi
fi

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  echo "No readable transcript found, skipping" >>"$DEBUG_LOG"
  exit 0
fi

# Skip trivial sessions: require real work (>= 2 tool calls), not raw line count.
# JSONL preamble (system reminders, etc.) alone can clear a naive line threshold.
TOOL_USE_COUNT=$(grep -c '"type":"tool_use"' "$TRANSCRIPT_PATH" 2>/dev/null || true)
TOOL_USE_COUNT=${TOOL_USE_COUNT:-0}
if [ "$TOOL_USE_COUNT" -lt 2 ]; then
  echo "Trivial session ($TOOL_USE_COUNT tool calls), skipping" >>"$DEBUG_LOG"
  exit 0
fi

# When to capture. The Stop hook fires after every assistant turn; capture reads
# each part of the session once, in order (ghost_transcript_window), and runs
# when enough new conversation has built up. PreCompact and SessionEnd flush
# whatever is left. The old trigger (every 80 transcript lines, re-reading the
# latest ~46k chars each time) made 491 model calls in a week, and 15 of 19
# dedup hits were a session re-capturing its own lesson (2026-10-08).
EVENT=$(echo "$HOOK_INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null)
case "${GHOST_CAPTURE_FLUSH:-}$EVENT" in
  1* | *PreCompact | *SessionEnd) MIN_CHARS="${GHOST_CAPTURE_FLUSH_MIN:-2000}" ;;
  *) MIN_CHARS="${GHOST_CAPTURE_MIN_CHARS:-30000}" ;;
esac
MAX_CHARS="${GHOST_CAPTURE_MAX_CHARS:-60000}"
STATE_DIR="${GHOST_STOP_STATE_DIR:-/tmp/ghost-stop-state}"
mkdir -p "$STATE_DIR" 2>/dev/null || true
STATE_FILE="$STATE_DIR/${SESSION_ID:-nosession}.lines"
LAST_LINES=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
LAST_LINES=${LAST_LINES:-0}
CUR_LINES=$(wc -l <"$TRANSCRIPT_PATH" 2>/dev/null | tr -d ' ')
CUR_LINES=${CUR_LINES:-0}
if [ "$CUR_LINES" -le "$LAST_LINES" ]; then
  echo "Nothing new since line $LAST_LINES, skipping" >>"$DEBUG_LOG"
  exit 0
fi
WINDOW_FILE=$(mktemp "${TMPDIR:-/tmp}/ghost-window.XXXXXX") || exit 0
WINDOW_END=$(ghost_transcript_window "$TRANSCRIPT_PATH" "$((LAST_LINES + 1))" "$MAX_CHARS" "$WINDOW_FILE")
WINDOW_CHARS=$(wc -c <"$WINDOW_FILE" | tr -d ' ')
if [ "${WINDOW_CHARS:-0}" -lt "$MIN_CHARS" ] && [ "$WINDOW_END" -ge "$CUR_LINES" ]; then
  echo "Window: ${WINDOW_CHARS} chars since line $LAST_LINES (<$MIN_CHARS${EVENT:+, $EVENT}), skipping" >>"$DEBUG_LOG"
  exit 0
fi
# Advance the watermark before the slow claude -p call, so concurrent Stop
# fires don't capture the same window.
echo "$WINDOW_END" >"$STATE_FILE" 2>/dev/null || true
echo "Window: lines $((LAST_LINES + 1))-$WINDOW_END, ${WINDOW_CHARS} chars${EVENT:+ ($EVENT)}" >>"$DEBUG_LOG"
TRANSCRIPT_SAMPLE=$(cat "$WINDOW_FILE")
OPENING=$(ghost_transcript_window "$TRANSCRIPT_PATH" 1 2000 "$WINDOW_FILE.open" >/dev/null; head -c 2000 "$WINDOW_FILE.open"; rm -f "$WINDOW_FILE.open")
# What this session already stored, so the model adds rather than repeats.
CAPTURED=$($GHOST list -n "$AGENT_NS" -t "$SESSION_TAG" -l 40 -f json 2>/dev/null |
  jq -r '(.memories? // .)[]? | select((.key | startswith("session-")) | not) | "- [\(.key)] \(.content | gsub("\n"; " ") | .[0:200])"' 2>/dev/null)
# Failures inside this window, with what came next (the window has no tool output).
sed -n "$((LAST_LINES + 1)),${WINDOW_END}p" "$TRANSCRIPT_PATH" >"$WINDOW_FILE"
FAILURES=$(ghost_failure_digest "$WINDOW_FILE" 12000)

EXTRACT_PROMPT='You are a memory curator for an AI coding agent. The input is one part of a Claude Code session: the OPENING REQUEST of the session (for orientation), the CONVERSATION since the last capture (USER:/ASSISTANT: text; tool payloads omitted), ALREADY CAPTURED (what earlier parts of this session stored), then FAILED TOOL CALLS in this part (each failed call, its error, and the next call to the same tool). Extract ONLY confirmed, valuable learnings from this part. Never repeat or reword anything in ALREADY CAPTURED; a learning that only restates one of those is not new.

## What to capture (tier: stm)
ONLY store memories that pass this bar — would a future session benefit from knowing this?
- Debugging insights: error -> root cause -> confirmed fix
- Architecture or design decisions with clear rationale
- User corrections or stated preferences
- Non-obvious gotchas that were confirmed through testing
- Solutions that required multiple attempts to find

'"$GHOST_GOTCHA_RULES"'
## What NOT to capture
- Raw observations, file paths, or service names (these are noise, not learnings)
- Error messages without a resolution
- Patterns noticed but not confirmed
- What was being worked on (session summaries cover this)
- Anything that could be re-derived by reading the code or git log
- Git status, branch names, PR numbers without technical insight
- Status snapshots that go stale ("PR #422 awaiting merge", "feature X is planned on branch Y", "package Z is fully implemented") — capture the durable lesson, not the state

## Rules
- Use tier "stm" for all learnings. Do NOT use "sensory" or "ltm".
- If the session was trivial or produced no genuine insights, output an empty array: []
- Be selective by the bar above, not by count: there is no fixed number. A long part of a busy session can hold many learnings; a quiet one may hold none. Never pad.
- Include the project name in tags when inferrable from file paths or repo names.

## Output format
Output a JSON array of objects. Each object has:
  - "key": descriptive kebab-case key
  - "kind": one of "semantic", "episodic", "procedural"
  - "priority": one of "low", "normal", "high", "critical"
  - "tier": "stm"
  - "tags": comma-separated string like "learning,project:foo"
  - "content": the insight in one or two sentences (plain text)

Also include one final object with key "session-summary" that summarizes what was accomplished
in this part of the session in 1-2 sentences. This will become the consolidation summary node.

Output ONLY valid JSON. No markdown fences, no explanation.'

# Unset CLAUDECODE to prevent nested detection
unset CLAUDECODE

# GHOST_SESSION_HOOK=1: the child must not run ghost's own hooks. Without it every
# capture ran the session-start lookup (~12s, ~1.4k tokens of memories into the
# summarizer prompt) and showed up as 78 of 98 "sessions" in the lens report
# (eval 2026-10-07, ghost docs/research/session-start-eval-2026-10-07.md).
RESULT=$(printf '## OPENING REQUEST\n%s\n\n## CONVERSATION\n%s\n\n## ALREADY CAPTURED\n%s\n\n## FAILED TOOL CALLS\n%s\n' "$OPENING" "$TRANSCRIPT_SAMPLE" "${CAPTURED:-(none)}" "${FAILURES:-(none)}" | GHOST_SESSION_HOOK=1 claude -p --no-session-persistence --model "$LLM_MODEL" "$EXTRACT_PROMPT" 2>>"$DEBUG_LOG")

echo "Claude output:" >>"$DEBUG_LOG"
echo "$RESULT" >>"$DEBUG_LOG"

if [ -z "$RESULT" ]; then
  echo "No output from claude" >>"$DEBUG_LOG"
  exit 0
fi

# Extract JSON array: strip fences, then grab from first [ to last ]
RESULT=$(echo "$RESULT" | sed '/^```/d')
RESULT=$(echo "$RESULT" | sed -n '/^\[/,/^\]/p')

if ! echo "$RESULT" | jq 'type' >/dev/null 2>&1; then
  echo "Invalid JSON output, skipping" >>"$DEBUG_LOG"
  exit 0
fi

COUNT=$(echo "$RESULT" | jq 'length')
if [ "$COUNT" -eq 0 ]; then
  echo "No learnings found" >>"$DEBUG_LOG"
  exit 0
fi

# Separate session summary from individual learnings. Match the summary by
# prefix: the model often names it session-summary-<date>-<slug>, which slipped
# past an exact match and was stored as a learning (453 of them by 2026-10-06).
SUMMARY_CONTENT=$(echo "$RESULT" | jq -r '[.[] | select(.key | startswith("session-summary"))][0].content // empty' 2>/dev/null)
LEARNINGS=$(echo "$RESULT" | jq -c '[.[] | select(.key | startswith("session-summary") | not)]')
# Drop empty-session filler the model sometimes emits as a "learning".
FILTERED="[]"
while IFS= read -r item; do
  [ -z "$item" ] && continue
  if ghost_junk_learning "$(echo "$item" | jq -r '.key')" "$(echo "$item" | jq -r '.content')"; then
    echo "Dropped junk: $(echo "$item" | jq -r '.key')" >>"$DEBUG_LOG"
  else
    FILTERED=$(echo "$FILTERED" | jq -c --argjson i "$item" '. + [$i]')
  fi
done < <(echo "$LEARNINGS" | jq -c '.[]')
LEARNINGS=$FILTERED
if [ -n "$SUMMARY_CONTENT" ] && ghost_junk_learning "summary" "$SUMMARY_CONTENT"; then
  echo "Dropped empty-session summary" >>"$DEBUG_LOG"
  SUMMARY_CONTENT=""
fi
LEARNING_COUNT=$(echo "$LEARNINGS" | jq 'length')

echo "Processing $LEARNING_COUNT learnings + summary..." >>"$DEBUG_LOG"

# Store individual learnings, collect keys for consolidation
KEYS_FILE=$(mktemp) # removed by ghost_stop_cleanup

echo "$LEARNINGS" | jq -c '.[]' | while IFS= read -r item; do
  KEY=$(echo "$item" | jq -r '.key')
  KIND=$(echo "$item" | jq -r '.kind')
  PRIORITY=$(echo "$item" | jq -r '.priority')
  TIER=$(echo "$item" | jq -r '.tier // "stm"')
  TAGS=$(echo "$item" | jq -r '.tags')
  CONTENT=$(echo "$item" | jq -r '.content')

  if [ "$TIER" = "ltm" ]; then
    TIER="stm"
  fi

  # The model's project tag guesses from paths; use the repo key instead.
  TAGS="$(ghost_normalize_project "$TAGS" "$PROJECT_NAME"),${SESSION_TAG}"
  # Gotchas: one memory per session (see ghost_is_gotcha), so recurrence is countable.
  DEDUP=--dedup
  if ghost_is_gotcha "$TAGS"; then
    KEY="${KEY}${SESSION_ID:+-${SESSION_ID:0:8}}"
    DEDUP=
  fi

  echo "Storing: $KEY (tier=$TIER)" >>"$DEBUG_LOG"
  # shellcheck disable=SC2086 # $DEDUP is one flag or nothing
  if PUT_OUTPUT=$($GHOST put -n "$AGENT_NS" -k "$KEY" --kind "$KIND" -p "$PRIORITY" --tier "$TIER" -t "$TAGS" $DEDUP -- "$CONTENT" 2>>"$DEBUG_LOG") && [ -n "$PUT_OUTPUT" ]; then
    # Dedup may return a different key — use the actual stored key for consolidation
    ACTUAL_KEY=$(echo "$PUT_OUTPUT" | jq -r '.key // empty' 2>/dev/null)
    if [ -n "$ACTUAL_KEY" ]; then
      echo "$ACTUAL_KEY" >>"$KEYS_FILE"
    else
      echo "$KEY" >>"$KEYS_FILE"
    fi
    echo "$PUT_OUTPUT" >>"$DEBUG_LOG"
  else
    echo "Failed to store: $KEY" >>"$DEBUG_LOG"
  fi
done

# Read collected keys (while loop runs in subshell due to pipe, so use file)
STORED_KEYS=$(cat "$KEYS_FILE" 2>/dev/null | tr '\n' ',' | sed 's/,$//')

# Consolidate under a session summary node if we have >= 2 learnings and a summary
KEY_COUNT=$(cat "$KEYS_FILE" 2>/dev/null | wc -l | tr -d ' ')
if [ "$KEY_COUNT" -ge 2 ] && [ -n "$SUMMARY_CONTENT" ]; then
  SUMMARY_KEY="session-${PROJECT_NAME//\//-}-${DATE}-${SESSION_ID:0:8}"
  SUMMARY_TAGS="project:${PROJECT_NAME},${SESSION_TAG}"

  echo "Consolidating $KEY_COUNT learnings under $SUMMARY_KEY" >>"$DEBUG_LOG"
  $GHOST consolidate -n "$AGENT_NS" \
    --summary-key "$SUMMARY_KEY" \
    --keys "$STORED_KEYS" \
    --content "$SUMMARY_CONTENT" \
    --tags "$SUMMARY_TAGS" \
    >>"$DEBUG_LOG" 2>&1 || echo "Failed to consolidate" >>"$DEBUG_LOG"
else
  echo "Skipping consolidation: $KEY_COUNT keys, summary='${SUMMARY_CONTENT:0:50}'" >>"$DEBUG_LOG"
fi

# Lightweight reflect: prune expired sensory, decay stale edges.
# Runs after capture so new memories are included. Silent on error.
echo "Running lightweight reflect..." >>"$DEBUG_LOG"
$GHOST reflect --ns "$AGENT_NS" >>"$DEBUG_LOG" 2>&1 || echo "Reflect failed (non-fatal)" >>"$DEBUG_LOG"

# Daily: merge what recurs in 2+ sessions into environment-gotchas and repo notes (self-throttled).
nohup "$(dirname "$0")/ghost-promote.sh" >/dev/null 2>&1 &

echo "Done" >>"$DEBUG_LOG"
