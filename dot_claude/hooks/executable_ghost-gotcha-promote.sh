#!/usr/bin/env bash
# Ghost gotcha promotion — keeps one pinned memory of gotchas that recur.
# Started in the background by ghost-stop.sh; runs at most once a day.
#
# Capture tags environment/tool failures with their workaround as `gotcha`
# (see ghost-transcript.sh). Search doesn't bring those back when they'd help
# (eval 2026-10-07, ghost docs/research/session-start-eval-2026-10-07.md: 2
# useful of 213 lookups on a failed tool call), so one that shows up in 2+
# sessions is merged into the pinned memory `environment-gotchas`, which
# session start always loads. 90 gotchas from 18 sessions grouped into 10 lines
# (macOS sed ranges, zsh globs and word splitting, sandbox network/writes...).
#
# No human approval step: lines in ~/.ghost/gotcha-declined.txt are removed
# and never added again, and every update is a new version (`ghost history`).
#
# Configure via environment variables:
#   GHOST_BIN            — path to ghost binary (default: ghost on PATH)
#   GHOST_AGENT_NS       — agent namespace (default: agent:claude-code)
#   GHOST_PROMOTE_MODEL  — model for grouping (default: sonnet)
#   GHOST_PROMOTE_DIR    — where declined/stamp live (default: ~/.ghost)
set -uo pipefail

GHOST="${GHOST_BIN:-ghost}"
AGENT_NS="${GHOST_AGENT_NS:-agent:claude-code}"
MODEL="${GHOST_PROMOTE_MODEL:-sonnet}"
DIR="${GHOST_PROMOTE_DIR:-$HOME/.ghost}"
KEY=environment-gotchas
MAX_LINES=12
MAX_CHARS=1100 # ~280 tokens; session start's pin budget is half of 1100
DECLINED="$DIR/gotcha-declined.txt"
STAMP="$DIR/gotcha-promote.stamp"
DEBUG_LOG="/tmp/ghost-gotcha-promote-debug.log"

if [ -f "$STAMP" ] && [ -z "$(find "$STAMP" -mmin +1440 2>/dev/null)" ]; then
  exit 0
fi
mkdir -p "$DIR" 2>/dev/null
touch "$STAMP" || exit 0 # no stamp, no throttle: don't run on every Stop
echo "=== $(date -Iseconds) ===" >>"$DEBUG_LOG"

GOTCHAS=$($GHOST list -n "$AGENT_NS" -t gotcha -l 500 -f json 2>>"$DEBUG_LOG" |
  jq -r '(.memories? // .)[]? | ([.tags[]? | select(startswith("session:")) | .[8:16]][0] // "unknown") as $s
    | "\($s) [\(.key)] \(.content | gsub("\n"; " "))"' 2>/dev/null)
SESSIONS=$(printf '%s\n' "$GOTCHAS" | awk 'NF {print $1}' | grep -v unknown | sort -u | wc -l | tr -d ' ')
if [ "${SESSIONS:-0}" -lt 2 ]; then
  echo "Gotchas from $SESSIONS session(s), nothing can recur yet" >>"$DEBUG_LOG"
  exit 0
fi
CURRENT=$($GHOST get -n "$AGENT_NS" -k "$KEY" -f json 2>/dev/null | jq -r '.content // empty' 2>/dev/null)

PROMPT='You maintain CURRENT, a short list of environment gotchas that every Claude Code session of this developer loads. Input: CLAUDE.md (also loaded every session), CURRENT, DECLINED lines the developer removed, then GOTCHAS: memories captured from past sessions, one per line as "<session> [<key>] <content>".

1. Group gotchas that describe the same underlying problem (different wording or keys can still be the same problem).
2. A group may be added only if it was seen in 2 or more DIFFERENT sessions and applies across projects (shell, OS, sandbox, CLI tools, Claude Code tools, MCP servers). Skip facts about one codebase or service.
3. Skip a group CLAUDE.md or CURRENT already covers. Remove any CURRENT line that matches a DECLINED line, and never add one that does.
4. Keep every other CURRENT line word for word. Write each new group as ONE line: "- " then symptom, colon, fix; under 20 words, no session ids.
5. At most '"$MAX_LINES"' lines and '"$MAX_CHARS"' characters in total. When over, merge related lines or drop the ones seen in the fewest sessions.

Return ONLY JSON, no fences: {"lines":["- ...",...],"added":[{"line":"- ...","sessions":["<session>",...]}]}'

RESULT=$({
  echo "CLAUDE.md:"
  cat "$HOME/.claude/CLAUDE.md" 2>/dev/null
  echo
  echo "CURRENT:"
  printf '%s\n' "${CURRENT:-(empty)}"
  echo
  echo "DECLINED:"
  cat "$DECLINED" 2>/dev/null
  echo
  echo "GOTCHAS:"
  printf '%s\n' "$GOTCHAS"
} | GHOST_SESSION_HOOK=1 claude -p --no-session-persistence --model "$MODEL" "$PROMPT" 2>>"$DEBUG_LOG" |
  sed '/^```/d' | sed -n '/^{/,/^}/p')

# Every line a "- " string, or the reply is malformed: keep the memory rather
# than let a format slip filter NEW down to empty and delete it below.
if ! printf '%s' "$RESULT" | jq -e '(.lines | type == "array") and all(.lines[]; type == "string" and startswith("- "))' >/dev/null 2>&1; then
  echo "Invalid JSON output, keeping $KEY as is" >>"$DEBUG_LOG"
  exit 0
fi
# Enforce the caps the prompt asks for: whole lines only, first ones win.
NEW=$(printf '%s' "$RESULT" | jq -r --argjson n "$MAX_LINES" --argjson c "$MAX_CHARS" '
  reduce .lines[:$n][] as $l ([]; if ((. + [$l]) | join("\n") | length) <= $c then . + [$l] else . end)
  | join("\n")')
if [ "$NEW" = "$CURRENT" ]; then
  echo "$KEY unchanged" >>"$DEBUG_LOG"
  exit 0
fi
if [ -z "$NEW" ]; then
  [ -n "$CURRENT" ] && $GHOST rm -n "$AGENT_NS" -k "$KEY" >>"$DEBUG_LOG" 2>&1
  echo "No recurring gotchas, $KEY removed" >>"$DEBUG_LOG"
  exit 0
fi
printf '%s' "$RESULT" | jq -r '.added[]? | "added (\(.sessions | length) sessions): \(.line)"' >>"$DEBUG_LOG"
# put has no --pinned flag; --tier identity stores ltm + pinned on every
# version (a plain put would leave the new version unpinned). Not tagged
# `gotcha`, or the next run would read it back as a captured gotcha.
$GHOST put -n "$AGENT_NS" -k "$KEY" --tier identity --kind procedural -p high \
  -t environment-gotchas,convention -- "$NEW" >>"$DEBUG_LOG" 2>&1 &&
  echo "$KEY updated ($(printf '%s\n' "$NEW" | wc -l | tr -d ' ') lines)" >>"$DEBUG_LOG"
