#!/usr/bin/env bash
# Ghost gotcha promotion — proposes CLAUDE.md lines for gotchas that recur.
# Started in the background by ghost-stop.sh; runs at most once a day.
#
# Capture tags environment/tool failures with their workaround as `gotcha`
# (see ghost-transcript.sh). One that shows up in 2+ sessions belongs in the
# global CLAUDE.md, which every session reads, not in a search. Eval 2026-10-07
# (ghost docs/research/session-start-eval-2026-10-07.md): 90 gotchas from 18
# sessions grouped into 10 recurring lines (macOS sed ranges, zsh globs and word
# splitting, sandbox network/writes, Chrome tab groups...).
#
# Writes proposals to ~/.ghost/gotcha-proposals.md; session start mentions them.
# It never edits CLAUDE.md. Lines listed in ~/.ghost/gotcha-declined.txt are
# not proposed again.
#
# Configure via environment variables:
#   GHOST_BIN            — path to ghost binary (default: ghost on PATH)
#   GHOST_AGENT_NS       — agent namespace (default: agent:claude-code)
#   GHOST_PROMOTE_MODEL  — model for grouping (default: sonnet)
#   GHOST_PROMOTE_DIR    — where proposals/declined/stamp live (default: ~/.ghost)
set -uo pipefail

GHOST="${GHOST_BIN:-ghost}"
AGENT_NS="${GHOST_AGENT_NS:-agent:claude-code}"
MODEL="${GHOST_PROMOTE_MODEL:-sonnet}"
DIR="${GHOST_PROMOTE_DIR:-$HOME/.ghost}"
OUT="$DIR/gotcha-proposals.md"
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

PROMPT='You maintain the "Environment Gotchas" list in a developer'"'"'s global CLAUDE.md, which every Claude Code session reads. Input: the current CLAUDE.md, DECLINED lines the developer rejected, then GOTCHAS: memories captured from past sessions, one per line as "<session> [<key>] <content>".

1. Group gotchas that describe the same underlying problem (different wording or keys can still be the same problem).
2. Keep only groups seen in 2 or more DIFFERENT sessions.
   Keep only problems that apply across projects (shell, OS, sandbox, CLI tools, Claude Code tools, MCP servers). Skip facts about one codebase or service.
3. Drop a group if CLAUDE.md already covers it or it matches a DECLINED line.
4. For each kept group write ONE CLAUDE.md bullet: short, imperative, symptom then fix, under 30 words, no session ids.

Return ONLY JSON, no fences: [{"line":"- ...","sessions":["<session>",...],"keys":["..."]}]
Return [] if nothing qualifies.'

RESULT=$({
  echo "CURRENT CLAUDE.md:"
  cat "$HOME/.claude/CLAUDE.md" 2>/dev/null
  echo
  echo "DECLINED:"
  cat "$DECLINED" 2>/dev/null
  echo
  echo "GOTCHAS:"
  printf '%s\n' "$GOTCHAS"
} | GHOST_SESSION_HOOK=1 claude -p --no-session-persistence --model "$MODEL" "$PROMPT" 2>>"$DEBUG_LOG" |
  sed '/^```/d' | sed -n '/^\[/,/^\]/p')

if ! printf '%s' "$RESULT" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "Invalid JSON output, keeping previous proposals" >>"$DEBUG_LOG"
  exit 0
fi
COUNT=$(printf '%s' "$RESULT" | jq 'length')
if [ "$COUNT" -eq 0 ]; then
  rm -f "$OUT"
  echo "No recurring gotchas to propose" >>"$DEBUG_LOG"
  exit 0
fi
LINES=$(printf '%s' "$RESULT" | jq -r '.[] | "\(.line)  <!-- \(.sessions | length) sessions: \(.keys | join(", ")) -->"')
# Same lines as before: leave the file alone, so session start doesn't re-announce it.
if [ -f "$OUT" ] && [ "$(grep '^- ' "$OUT" | sed 's/  <!--.*//')" = "$(printf '%s\n' "$LINES" | sed 's/  <!--.*//')" ]; then
  echo "Proposals unchanged ($COUNT)" >>"$DEBUG_LOG"
  exit 0
fi
{
  echo "# Proposed CLAUDE.md gotchas ($(date +%F))"
  echo
  echo "Each was hit in 2+ sessions. Add the ones you want to the Environment Gotchas section of CLAUDE.md;"
  echo "put any you reject in ~/.ghost/gotcha-declined.txt. This file is regenerated daily."
  echo
  printf '%s\n' "$LINES"
} >"$OUT.tmp" && mv "$OUT.tmp" "$OUT"
echo "Proposed $COUNT line(s)" >>"$DEBUG_LOG"
