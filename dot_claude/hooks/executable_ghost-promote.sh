#!/usr/bin/env bash
# Ghost promotion — keeps short always-loaded lists of what recurs.
# Started in the background by ghost-stop.sh; runs at most once a day.
#
# Search doesn't bring lessons back when they'd help (eval 2026-10-07, ghost
# docs/research/session-start-eval-2026-10-07.md: 2 useful of 213 lookups on a
# failed tool call), so a lesson captured in 2+ sessions is merged into a list
# that session start always prints:
#   - environment-gotchas (pinned, every repo): environment/tool gotchas, plus
#     lessons re-captured with no repo or in 2+ repos.
#   - repo-notes-<repo>[-<unit>] (locked, read by key in that repo): lessons a
#     repo keeps re-teaching. A dedup hit adds the duplicate's session:/project:
#     tags to the memory it reinforces, so "captured in 2+ sessions" is countable
#     (ghost docs/research/repo-notes-design-2026-10-08.md).
#
# No human approval step: lines in ~/.ghost/gotcha-declined.txt or
# ~/.ghost/notes-declined.txt are removed and never added again, and every
# update is a new version (`ghost history`).
#
# Configure via environment variables:
#   GHOST_BIN            — path to ghost binary (default: ghost on PATH)
#   GHOST_AGENT_NS       — agent namespace (default: agent:claude-code)
#   GHOST_PROMOTE_MODEL  — model for grouping (default: sonnet)
#   GHOST_PROMOTE_DIR    — where declined lists, state and stamp live (default: ~/.ghost)
#   GHOST_PROMOTE_MAX_REPOS — repo passes per run (default: 8)
set -uo pipefail

GHOST="${GHOST_BIN:-ghost}"
AGENT_NS="${GHOST_AGENT_NS:-agent:claude-code}"
MODEL="${GHOST_PROMOTE_MODEL:-sonnet}"
DIR="${GHOST_PROMOTE_DIR:-$HOME/.ghost}"
MAX_REPOS="${GHOST_PROMOTE_MAX_REPOS:-8}"
MAX_LINES=12
MAX_CHARS=1100 # ~280 tokens; session start's pin budget is half of 1200
STAMP="$DIR/promote.stamp"
STATE="$DIR/notes-state"
DEBUG_LOG="/tmp/ghost-promote-debug.log"

if [ -f "$STAMP" ] && [ -z "$(find "$STAMP" -mmin +1440 2>/dev/null)" ]; then
  exit 0
fi
mkdir -p "$DIR" "$STATE" 2>/dev/null
touch "$STAMP" || exit 0 # no stamp, no throttle: don't run on every Stop
echo "=== $(date -Iseconds) ===" >>"$DEBUG_LOG"

# One line per candidate and owner: "<owner>\t<sessions>\t[<key>] <content>".
# owner = the memory's one project key; several keys in one repo: that repo;
# several repos: the first (creating) key, and also "*"; none: "-" ("*" and
# "-" go to the global list). Gotchas are candidates from one session (they're
# stored per session); other memories need 2+ session tags. The lists
# themselves are never input. Tags keep their stored order: the dedup merge
# appends, so the first project tag is the one the memory was created with.
CANDIDATES=$($GHOST list -n "$AGENT_NS" -l 50000 -f json 2>>"$DEBUG_LOG" | jq -r '
  def uniq_ordered: reduce .[] as $x ([]; if index([$x]) then . else . + [$x] end);
  (.memories? // .)[]?
  | (.tags // []) as $t
  | select(($t | index("repo-notes")) == null and ($t | index("environment-gotchas")) == null)
  | ([$t[] | select(startswith("project:")) | .[8:]] | uniq_ordered) as $p
  | ([$t[] | select(startswith("session:")) | .[8:16]] | unique) as $s
  | select((($t | index("gotcha")) != null and ($s | length) >= 1) or ($s | length) >= 2)
  | ([$p[] | split("/")[0]] | unique) as $repos
  | (if ($p | length) == 0 then ["-"]
     elif ($p | length) == 1 then [$p[0]]
     elif ($repos | length) == 1 then [$repos[0]]
     else [$p[0], "*"] end)[] as $owner
  | "\($owner)\t\($s | join(","))\t[\(.key)] \(.content | gsub("[\n\t]"; " "))"' 2>/dev/null)

# run_list KEY PROMPT INPUT DECLINED -- PUT_ARGS...: one model call that
# rewrites the list at KEY, then a guarded put. Malformed output keeps the list.
run_list() {
  local key=$1 prompt=$2 input=$3 declined=$4 current result new
  shift 5
  current=$($GHOST get -n "$AGENT_NS" -k "$key" -f json 2>/dev/null | jq -r '.content // empty' 2>/dev/null)
  result=$({
    printf '%s\n' "$input"
    echo
    echo "CURRENT:"
    printf '%s\n' "${current:-(empty)}"
    echo
    echo "DECLINED:"
    cat "$declined" 2>/dev/null
  } | GHOST_SESSION_HOOK=1 claude -p --no-session-persistence --model "$MODEL" "$prompt" 2>>"$DEBUG_LOG" |
    sed '/^```/d' | sed -n '/^{/,/^}/p')
  # Every line a "- " string, or the reply is malformed: keep the list rather
  # than let a format slip filter it down to empty and delete it below.
  if ! printf '%s' "$result" | jq -e '(.lines | type == "array") and all(.lines[]; type == "string" and startswith("- "))' >/dev/null 2>&1; then
    echo "$key: invalid JSON output, kept as is" >>"$DEBUG_LOG"
    return 1
  fi
  # Enforce the caps the prompt asks for: whole lines only, first ones win.
  new=$(printf '%s' "$result" | jq -r --argjson n "$MAX_LINES" --argjson c "$MAX_CHARS" '
    reduce .lines[:$n][] as $l ([]; if ((. + [$l]) | join("\n") | length) <= $c then . + [$l] else . end)
    | join("\n")')
  if [ "$new" = "$current" ]; then
    echo "$key: unchanged" >>"$DEBUG_LOG"
    return 0
  fi
  # An empty reply never deletes a list: a failed read of CURRENT shows the
  # model "(empty)", and a soft delete would drop every line. Remove by hand
  # (ghost rm) or decline lines instead.
  if [ -z "$new" ]; then
    echo "$key: model returned no lines, kept as is" >>"$DEBUG_LOG"
    return 0
  fi
  printf '%s' "$result" | jq -r --arg k "$key" '.added[]? | "\($k) added (\(.sessions | length) sessions): \(.line)"' >>"$DEBUG_LOG"
  # -- before the content: it starts with "- ", which put would parse as a flag.
  $GHOST put -n "$AGENT_NS" -k "$key" "$@" -- "$new" >/dev/null 2>>"$DEBUG_LOG" &&
    echo "$key: updated ($(printf '%s\n' "$new" | wc -l | tr -d ' ') lines)" >>"$DEBUG_LOG"
}

FORMAT='one per line as "<sessions> [<key>] <content>", where <sessions> lists the ids of the sessions that captured it'
CAPS="At most $MAX_LINES lines and $MAX_CHARS characters in total. When over, merge related lines or drop the ones seen in the fewest sessions."
OUTPUT='Return ONLY JSON, no fences: {"lines":["- ...",...],"added":[{"line":"- ...","sessions":["<session>",...]}]}'

# --- Global pass: environment-gotchas (pinned) ---------------------------------
GLOBAL=$(printf '%s\n' "$CANDIDATES" | awk -F'\t' '$1 == "-" || $1 == "*" {print $2" "$3}')
GSESSIONS=$(printf '%s\n' "$GLOBAL" | awk 'NF {print $1}' | tr ',' '\n' | sort -u | grep -c .)
if [ "${GSESSIONS:-0}" -ge 2 ]; then
  # put has no --pinned flag; --tier identity stores ltm + pinned on every
  # version (a plain put would leave the new version unpinned).
  run_list environment-gotchas "You maintain CURRENT, a short list of environment gotchas that every Claude Code session of this developer loads, in every repository. Input: CLAUDE.md (also loaded every session), CANDIDATES: lessons captured from past sessions, $FORMAT, then CURRENT and DECLINED lines the developer removed.

1. Group candidates that describe the same underlying problem (different wording or keys can still be the same problem).
2. A group may be added only if it was seen in 2 or more DIFFERENT sessions and applies across projects (shell, OS, sandbox, CLI tools, Claude Code tools, MCP servers, services used from several repos). Skip facts about one codebase.
3. Skip a group CLAUDE.md or CURRENT already covers. Remove any CURRENT line that matches a DECLINED line, and never add one that does.
4. Keep every other CURRENT line word for word. Write each new group as ONE line: \"- \" then symptom, colon, fix; under 20 words, no session ids.
5. $CAPS

$OUTPUT" "$(echo "CLAUDE.md:"; cat "$HOME/.claude/CLAUDE.md" 2>/dev/null; echo; echo "CANDIDATES:"; printf '%s\n' "$GLOBAL")" \
    "$DIR/gotcha-declined.txt" -- \
    --tier identity --kind procedural -p high -t environment-gotchas,convention
else
  echo "environment-gotchas: candidates from $GSESSIONS session(s), nothing can recur yet" >>"$DEBUG_LOG"
fi

# --- Repo passes: repo-notes-<owner> (locked, read by key) ---------------------
# Only owners with candidates from 2+ sessions, and only when their candidate
# set changed since the last pass (no model call for an idle repo).
# Off unless GHOST_REPO_NOTES=1 (same switch as session start): in a week of
# sessions in one monorepo, 36 of 37 cross-session re-learnings happened in sessions
# already running when the lesson was first captured, so notes read at
# session start could have helped once (ghost docs/research/repo-notes-design-2026-10-08.md).
RAN=0
[ "${GHOST_REPO_NOTES:-0}" = "1" ] || CANDIDATES=$(printf '%s\n' "$CANDIDATES" | awk -F'\t' '$1 == "-" || $1 == "*"')
for OWNER in $(printf '%s\n' "$CANDIDATES" | awk -F'\t' '$1 != "-" && $1 != "*" && NF {print $1}' | sort -u); do
  ROWS=$(printf '%s\n' "$CANDIDATES" | awk -F'\t' -v o="$OWNER" '$1 == o {print $2" "$3}')
  NSESS=$(printf '%s\n' "$ROWS" | awk 'NF {print $1}' | tr ',' '\n' | sort -u | grep -c .)
  [ "${NSESS:-0}" -ge 2 ] || continue
  SLUG=$(printf '%s' "$OWNER" | tr '/' '-')
  HASH=$(printf '%s' "$ROWS" | shasum | cut -c1-16)
  if [ "$(cat "$STATE/$SLUG" 2>/dev/null)" = "$HASH" ]; then
    continue
  fi
  if [ "$RAN" -ge "$MAX_REPOS" ]; then
    echo "repo-notes-$SLUG: skipped, $MAX_REPOS repo passes already ran" >>"$DEBUG_LOG"
    continue
  fi
  RAN=$((RAN + 1))
  run_list "repo-notes-$SLUG" "You maintain CURRENT, the notes a coding agent loads at the start of every session in the $OWNER repository. Input: CANDIDATES: lessons captured from past sessions in this repository, $FORMAT, then CURRENT and DECLINED lines the developer removed.

1. Group candidates that state the same lesson (different wording or keys can still be the same lesson).
2. A group may be added only if it was seen in 2 or more DIFFERENT sessions and stays true: how this repository works, its commands, conventions, pitfalls, decisions with lasting effect. Skip status (in progress, merged, shipped, planned), one-off results, and anything an agent sees by reading the code in a minute.
3. Remove any CURRENT line that matches a DECLINED line or that a newer candidate contradicts, and never add one that matches DECLINED.
4. Keep every other CURRENT line word for word. Write each new group as ONE line: \"- \" then the lesson; under 25 words, no session ids.
5. $CAPS

$OUTPUT" "$(echo "CANDIDATES:"; printf '%s\n' "$ROWS")" \
    "$DIR/notes-declined.txt" -- \
    --unlock --kind semantic -p high -t "repo-notes,project:$OWNER,locked" &&
    printf '%s\n' "$HASH" >"$STATE/$SLUG"
done
echo "Repo passes: $RAN" >>"$DEBUG_LOG"
