# shellcheck shell=bash
# Ghost hook trace — sourced by ghost-session-start.sh and ghost-user-prompt.sh.
# Appends one JSON line per hook run to /tmp/ghost-trace-<session>.jsonl so a
# viewer (the ghost-lens Claude Code mod) can show what ghost loaded, at what
# score and token cost, and why nothing was loaded. The injected text drops
# scores and skip reasons; this keeps them. Best effort: never fails the hook.

# ghost_trace_phase NAME RAW_JSON — one retrieval call, compacted (no content).
ghost_trace_phase() {
  local raw=$2
  [ -z "$raw" ] && raw='{}'
  printf '%s' "$raw" | jq -c --arg phase "$1" '{
    phase: $phase, used: (.used // 0), budget: (.budget // 0),
    skipped: (.skipped // 0), stages: (.stages // {}),
    memories: [.memories[]? | {key, ns, score: (.score // null), via: (.via // null),
      tok: (((.content // "") | length) / 4 | floor)}]
  }' 2>/dev/null || printf '{"phase":"%s","error":"unparsed"}' "$1"
}

# ghost_trace HOOK OUTCOME REASON QUERY INJECTED_KEYS [PHASE_JSON...]
#   OUTCOME: injected | skipped | empty | deduped
#   INJECTED_KEYS: newline-separated keys actually written into context
ghost_trace() {
  local hook=$1 outcome=$2 reason=$3 query=$4 injected=$5
  shift 5
  local phases='[]'
  if [ $# -gt 0 ]; then
    phases=$(printf '%s\n' "$@" | jq -cs . 2>/dev/null || echo '[]')
  fi
  {
  jq -cn --arg hook "$hook" --arg outcome "$outcome" --arg reason "$reason" \
    --arg query "${query:0:300}" --arg injected "$injected" --argjson phases "$phases" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg floor "${MIN_SCORE:-}" '{
      v: 1, at: $at, hook: $hook, outcome: $outcome,
      reason: (if $reason == "" then null else $reason end),
      query: $query, floor: ($floor | tonumber? // null),
      injected: ($injected | split("\n") | map(select(length > 0))),
      phases: $phases
    } | .injected_tok = (
      .injected as $inj
      | [.phases[].memories[]? | select(.key as $k | $inj | index($k))]
      | unique_by(.key) | map(.tok) | add // 0
    )' >>"${GHOST_TRACE_DIR:-/tmp}/ghost-trace-${SESSION_ID:-default}.jsonl"
  } 2>/dev/null || true
}

# ghost_trace_spent HOOK — tokens this hook has already put into the session's
# context (sum of injected_tok on its trace lines); 0 when there is no trace.
ghost_trace_spent() {
  local f="${GHOST_TRACE_DIR:-/tmp}/ghost-trace-${SESSION_ID:-default}.jsonl"
  local n
  n=$(jq -s --arg hook "$1" '[.[] | select(.hook == $hook) | .injected_tok // 0] | add // 0' "$f" 2>/dev/null) || n=0
  printf '%s' "${n:-0}"
}
