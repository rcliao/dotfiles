#!/usr/bin/env bash
# Ghost memory capture — PreCompact hook
# Reads transcript, pipes to claude -p for LLM-powered extraction,
# stores results via ghost put CLI. Runs async.
#
# Configure via environment variables:
#   GHOST_BIN       — path to ghost binary (default: ghost on PATH)
#   GHOST_AGENT_NS  — agent namespace (default: agent:claude-code)
#   GHOST_LLM_MODEL — model for extraction (default: claude-sonnet-4-6)
set -uo pipefail

GHOST="${GHOST_BIN:-ghost}"
# ORT reranker backend: hugot loads libonnxruntime.dylib at runtime from this dir
export GHOST_ONNXRUNTIME_PATH="${GHOST_ONNXRUNTIME_PATH:-/opt/homebrew/lib}"
# Utility-weighted scoring: parasite bench on a live snapshot (2026-07-28) showed
# w=0.5 lifts recall canary 7/8 -> 8/8 and zero-utility share 2% -> 0%.
export GHOST_UTILITY_WEIGHT="${GHOST_UTILITY_WEIGHT:-0.5}"
AGENT_NS="${GHOST_AGENT_NS:-agent:claude-code}"
LLM_MODEL="${GHOST_LLM_MODEL:-claude-sonnet-4-6}"
DEBUG_LOG="/tmp/ghost-precompact-debug.log"

# Trap errors so Claude Code gets stderr output instead of silent failure
trap 'echo "ghost-precompact.sh failed at line $LINENO" >&2; echo "Error at line $LINENO" >> "$DEBUG_LOG"' ERR

HOOK_INPUT=$(cat)

echo "=== $(date -Iseconds) ===" >>"$DEBUG_LOG"
HOOK_SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty' 2>/dev/null)

# Extract transcript path from hook input
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

if [ -z "$TRANSCRIPT_PATH" ]; then
  SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
  if [ -n "$SESSION_ID" ]; then
    TRANSCRIPT_PATH=$(find ~/.claude/projects -name "${SESSION_ID}*.jsonl" 2>/dev/null | head -1)
    echo "Found transcript via session_id: $TRANSCRIPT_PATH" >>"$DEBUG_LOG"
  fi
fi

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  echo "No readable transcript found, skipping" >>"$DEBUG_LOG"
  exit 0
fi

echo "Processing transcript: $TRANSCRIPT_PATH" >>"$DEBUG_LOG"

# The conversation as plain text (see ghost-transcript.sh): raw JSONL tail cut
# at 60k chars was mostly tool payloads, often cut mid-JSON.
# shellcheck source=/dev/null
. "$(dirname "$0")/ghost-transcript.sh"
TRANSCRIPT_TAIL=$(ghost_transcript_sample "$TRANSCRIPT_PATH" 50000)

if [ -z "$TRANSCRIPT_TAIL" ]; then
  echo "Transcript empty or unreadable" >>"$DEBUG_LOG"
  exit 0
fi

# Recent failures with what came next (the sample has no tool output).
FAILURES=$(ghost_failure_digest "$TRANSCRIPT_PATH" 12000)

PROMPT='You are a memory curator for an AI coding agent. Analyze the following Claude Code session transcript (USER:/ASSISTANT: text; tool payloads omitted), then a FAILED TOOL CALLS section (each failed call, its error, and the next call to the same tool) and extract ONLY confirmed, valuable learnings.

## What to capture (tier: stm)
ONLY store memories that pass this bar — would a future session benefit from knowing this?
- Debugging insights: error -> root cause -> confirmed fix
- Architecture or design decisions with clear rationale
- User corrections or stated preferences
- Non-obvious gotchas that were confirmed through testing

'"$GHOST_GOTCHA_RULES"'
## What NOT to capture
- Raw observations, file paths, or service names (noise, not learnings)
- Error messages without a resolution
- Patterns noticed but not confirmed
- What was being worked on (too ephemeral)
- Anything re-derivable from code or git log
- Status snapshots that go stale ("PR #422 awaiting merge", "feature X is planned on branch Y") — capture the durable lesson, not the state

## Rules
- Use tier "stm" for all learnings. Do NOT use "sensory" or "ltm".
- If the session was trivial or produced no genuine insights, output an empty array: []
- Be selective: 2-3 high-quality learnings are better than 10 low-quality ones. Gotchas do not count toward this limit.
- Include the project name in tags when inferrable from file paths or repo names.

## Output format
Output a JSON array of objects. Each object has:
  - "key": descriptive kebab-case key
  - "kind": one of "semantic", "episodic", "procedural"
  - "priority": one of "low", "normal", "high", "critical"
  - "tier": one of "sensory", "stm"
  - "tags": comma-separated string like "learning,project:foo"
  - "content": the insight in one or two sentences (plain text)

Output ONLY valid JSON. No markdown fences, no explanation.'

# GHOST_SESSION_HOOK=1 keeps ghost's own hooks out of the child (see ghost-stop.sh).
RESULT=$(printf '%s\n\n## FAILED TOOL CALLS\n%s\n' "$TRANSCRIPT_TAIL" "${FAILURES:-(none)}" | GHOST_SESSION_HOOK=1 claude -p --no-session-persistence --model "$LLM_MODEL" "$PROMPT" 2>>"$DEBUG_LOG")

echo "Claude output:" >>"$DEBUG_LOG"
echo "$RESULT" >>"$DEBUG_LOG"

if [ -z "$RESULT" ]; then
  echo "No output from claude" >>"$DEBUG_LOG"
  exit 0
fi

# Extract JSON array: strip fences, then grab from first [ to last ]
RESULT=$(echo "$RESULT" | sed '/^```/d')
RESULT=$(echo "$RESULT" | sed -n '/^\[/,/^\]/p')

# Validate JSON
if ! echo "$RESULT" | jq 'type' >/dev/null 2>&1; then
  echo "Invalid JSON output, skipping" >>"$DEBUG_LOG"
  exit 0
fi

COUNT=$(echo "$RESULT" | jq 'length')
if [ "$COUNT" -eq 0 ]; then
  echo "No learnings found" >>"$DEBUG_LOG"
  exit 0
fi

echo "Processing $COUNT learnings..." >>"$DEBUG_LOG"

echo "$RESULT" | jq -c '.[]' | while IFS= read -r item; do
  KEY=$(echo "$item" | jq -r '.key')
  KIND=$(echo "$item" | jq -r '.kind')
  PRIORITY=$(echo "$item" | jq -r '.priority')
  TIER=$(echo "$item" | jq -r '.tier // "stm"')
  TAGS=$(echo "$item" | jq -r '.tags')
  CONTENT=$(echo "$item" | jq -r '.content')
  # Same session tag as ghost-stop.sh: gotcha promotion counts distinct sessions.
  [ -n "$HOOK_SESSION_ID" ] && TAGS="${TAGS},session:${HOOK_SESSION_ID}"

  # Summaries and empty-session filler are not learnings (see ghost-transcript.sh).
  if ghost_junk_learning "$KEY" "$CONTENT"; then
    echo "Dropped junk: $KEY" >>"$DEBUG_LOG"
    continue
  fi

  # Never allow hooks to write directly to ltm
  if [ "$TIER" = "ltm" ]; then
    TIER="stm"
  fi

  # Gotchas: one memory per session (see ghost_is_gotcha), so recurrence is countable.
  DEDUP=--dedup
  if ghost_is_gotcha "$TAGS"; then
    KEY="${KEY}${HOOK_SESSION_ID:+-${HOOK_SESSION_ID:0:8}}"
    DEDUP=
  fi

  echo "Storing: $KEY (tier=$TIER)" >>"$DEBUG_LOG"
  # shellcheck disable=SC2086 # $DEDUP is one flag or nothing
  $GHOST put -n "$AGENT_NS" -k "$KEY" --kind "$KIND" -p "$PRIORITY" --tier "$TIER" -t "$TAGS" $DEDUP "$CONTENT" >>"$DEBUG_LOG" 2>&1 || echo "Failed to store: $KEY" >>"$DEBUG_LOG"
done

echo "Done" >>"$DEBUG_LOG"
