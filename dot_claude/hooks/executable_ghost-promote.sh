#!/usr/bin/env bash
# Ghost promotion — keeps the pinned environment-gotchas list.
# Started in the background by ghost-stop.sh; runs at most once a day.
#
# Search doesn't bring lessons back when they'd help (eval 2026-10-07, ghost
# docs/research/session-start-eval-2026-10-07.md: 2 useful of 213 lookups on a
# failed tool call), so a gotcha captured in 2+ sessions is merged into the
# pinned memory environment-gotchas, which session start always loads.
# Per-repo notes and pushing lessons between concurrent sessions were tested
# and not kept (same doc, sections 11-12).
#
# No human approval step: lines in ~/.ghost/gotcha-declined.txt are removed
# and never added again, and every update is a new version (`ghost history`).
#
# Configure via environment variables:
#   GHOST_BIN            — path to ghost binary (default: ghost on PATH)
#   GHOST_AGENT_NS       — agent namespace (default: agent:claude-code)
#   GHOST_PROMOTE_MODEL  — model for grouping (default: sonnet)
#   GHOST_PROMOTE_DIR    — where declined list, state and stamp live (default: ~/.ghost)
set -uo pipefail

GHOST="${GHOST_BIN:-ghost}"
AGENT_NS="${GHOST_AGENT_NS:-agent:claude-code}"
MODEL="${GHOST_PROMOTE_MODEL:-sonnet}"
DIR="${GHOST_PROMOTE_DIR:-$HOME/.ghost}"
KEY=environment-gotchas
MAX_LINES=12
MAX_CHARS=1100 # ~280 tokens; session start's pin budget is half of 1200
STAMP="$DIR/promote.stamp"
STATE="$DIR/promote.hash"
DECLINED="$DIR/gotcha-declined.txt"
DEBUG_LOG="/tmp/ghost-promote-debug.log"

if [ -f "$STAMP" ] && [ -z "$(find "$STAMP" -mmin +1440 2>/dev/null)" ]; then
  exit 0
fi
mkdir -p "$DIR" 2>/dev/null
touch "$STAMP" || exit 0 # no stamp, no throttle: don't run on every Stop
echo "=== $(date -Iseconds) ===" >>"$DEBUG_LOG"

# One line per gotcha: "<session> [<key>] <content>". Capture stores gotchas
# per session (see ghost_is_gotcha), so the model can count sessions.
GOTCHAS=$($GHOST list -n "$AGENT_NS" -t gotcha -l 500 -f json 2>>"$DEBUG_LOG" |
  jq -r '(.memories? // .)[]? | select((.tags // []) | index("environment-gotchas") | not)
    | ([.tags[]? | select(startswith("session:")) | .[8:16]][0] // "unknown") as $s
    | "\($s) [\(.key)] \(.content | gsub("\n"; " "))"' 2>/dev/null)
SESSIONS=$(printf '%s\n' "$GOTCHAS" | awk 'NF {print $1}' | grep -v unknown | sort -u | grep -c .)
if [ "${SESSIONS:-0}" -lt 2 ]; then
  echo "Gotchas from $SESSIONS session(s), nothing can recur yet" >>"$DEBUG_LOG"
  exit 0
fi
CURRENT=$($GHOST get -n "$AGENT_NS" -k "$KEY" -f json 2>/dev/null | jq -r '.content // empty' 2>/dev/null)
# No model call when the inputs haven't changed since the last pass.
inputs_hash() { { printf '%s\n' "$GOTCHAS" "$1"; cat "$DECLINED" "$HOME/.claude/CLAUDE.md" 2>/dev/null || true; } | shasum | cut -c1-16; }
if [ "$(cat "$STATE" 2>/dev/null)" = "$(inputs_hash "$CURRENT")" ]; then
  echo "$KEY: inputs unchanged, skipped" >>"$DEBUG_LOG"
  exit 0
fi

PROMPT='You maintain CURRENT, a short list of environment gotchas that every Claude Code session of this developer loads, in every repository. Input: CLAUDE.md (also loaded every session), CURRENT, DECLINED lines the developer removed, then GOTCHAS: memories captured from past sessions, one per line as "<session> [<key>] <content>".

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

# Every line a "- " string, or the reply is malformed: keep the list.
if ! printf '%s' "$RESULT" | jq -e '(.lines | type == "array") and all(.lines[]; type == "string" and startswith("- "))' >/dev/null 2>&1; then
  echo "$KEY: invalid JSON output, kept as is" >>"$DEBUG_LOG"
  exit 0
fi
# Enforce the caps the prompt asks for: whole lines only, first ones win.
NEW=$(printf '%s' "$RESULT" | jq -r --argjson n "$MAX_LINES" --argjson c "$MAX_CHARS" '
  reduce .lines[:$n][] as $l ([]; if ((. + [$l]) | join("\n") | length) <= $c then . + [$l] else . end)
  | join("\n")')
if [ "$NEW" = "$CURRENT" ]; then
  inputs_hash "$CURRENT" >"$STATE"
  echo "$KEY unchanged" >>"$DEBUG_LOG"
  exit 0
fi
# An empty reply never deletes the list: a failed read of CURRENT shows the
# model "(empty)". Remove by hand (ghost rm) or decline lines instead.
if [ -z "$NEW" ]; then
  echo "$KEY: model returned no lines, kept as is" >>"$DEBUG_LOG"
  exit 0
fi
printf '%s' "$RESULT" | jq -r '.added[]? | "added (\(.sessions | length) sessions): \(.line)"' >>"$DEBUG_LOG"
# put has no --pinned flag; --tier identity stores ltm + pinned on every
# version (a plain put would leave the new version unpinned). Not tagged
# `gotcha`, or the next run would read it back as a captured gotcha. The
# content starts with "- ", so it goes after -- or put parses it as a flag.
$GHOST put -n "$AGENT_NS" -k "$KEY" --tier identity --kind procedural -p high \
  -t environment-gotchas,convention -- "$NEW" >/dev/null 2>>"$DEBUG_LOG" &&
  inputs_hash "$NEW" >"$STATE" &&
  echo "$KEY updated ($(printf '%s\n' "$NEW" | wc -l | tr -d ' ') lines)" >>"$DEBUG_LOG"
