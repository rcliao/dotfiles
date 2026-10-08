# shellcheck shell=bash
# Shared by ghost-stop.sh and ghost-precompact.sh: what the memory curator sees,
# and what it may not store.
#
# Why (2026-10-06): both hooks fed `claude -p` raw JSONL cut at 60k chars. A
# session's first 30 lines alone run ~200 KB (hook output, system reminders), so
# the cut kept only startup preamble and the opening prompt, never the work.
# The curator then wrote "transcript ends immediately after the prompt" summaries
# (176 in the debug log, 453 session-summary-* memories), re-minted on every
# debounced Stop as -v2/-final/-v4 variants.

# ghost_transcript_sample PATH [MAX_CHARS] — the conversation as plain text:
# user and assistant text only (no tool payloads, meta rows or system
# reminders), the opening request plus the most recent MAX_CHARS-4000 chars.
ghost_transcript_sample() {
  local tpath=$1 max=${2:-50000} text
  text=$(jq -r '
    select((.type == "user" or .type == "assistant") and ((.isMeta // false) | not))
    | .type as $t
    | (.message.content
       | if type == "string" then .
         else ([.[]? | select(.type == "text") | .text] | join("\n")) end) as $c
    | select(($c | length) > 0)
    | "\($t | ascii_upcase): \($c)"' "$tpath" 2>/dev/null |
    perl -0pe 's/<system-reminder>.*?<\/system-reminder>//gs' 2>/dev/null) || text=""
  [ -z "$text" ] && return 0
  if [ "${#text}" -le "$max" ]; then
    printf '%s\n' "$text"
    return 0
  fi
  printf '%s\n…\n%s\n' "${text:0:4000}" "${text: -$((max - 4000))}"
}

# ghost_failure_digest PATH [MAX_CHARS] [FROM_LINE] — failed tool calls and what came next.
# The text sample above drops tool payloads, so capture never saw an error
# unless the agent narrated it (eval 2026-10-07: 22 of 91 failures were
# recurring environment gotchas, none in the store). One block per distinct
# failure: the call, the error tail, then the next call to the same tool and
# whether it worked. Harness refusals (user rejections, unread-file guards) and
# ghost's own tools are skipped. Keeps the most recent MAX_CHARS. FROM_LINE limits it
# to transcript lines from there on (ghost-stop.sh: what is new since the last capture).
ghost_failure_digest() {
  local tpath=$1 max=${2:-12000} from=${3:-1} text
  text=$(jq -rs '
    def flat: if type == "string" then . elif type == "array" then map(.text // (.content | strings) // "") | join("\n") else "" end;
    def short(n): gsub("<system-reminder>[\\s\\S]*?</system-reminder>"; "") | gsub("\u001b\\[[0-9;]*m"; "") | gsub("\\s+"; " ") | .[0:n];
    def tail(n): gsub("<system-reminder>[\\s\\S]*?</system-reminder>"; "") | gsub("\\s+"; " ") | .[-n:];
    [ .[] | select((.isSidechain // false) | not) | .message.content | arrays | .[] ] as $items
    | [ $items | to_entries[] | select(.value.type == "tool_use") | {i: .key, id: .value.id, name: .value.name, input: (.value.input | tojson | short(220))} ] as $uses
    | ($items | map(select(.type == "tool_result") | {key: .tool_use_id, value: {err: (.is_error // false), text: (.content | flat)}}) | from_entries) as $res
    | [ $uses[] | . as $u | ($res[$u.id] // {err: false, text: ""}) as $r
        | select($r.err and ($u.name | startswith("mcp__ghost") | not))
        | select($r.text | test("doesn.t want to proceed|user rejected|File has not been read yet|Blocked: sleep|InputValidationError|has been modified since read|String to replace not found|interrupted by user|has been denied|STOP and explain"; "i") | not)
        | ([ $uses[] | select(.i > $u.i and .name == $u.name) ][0]) as $n
        | "FAILED \($u.name): \($u.input)\n  error: \($r.text | tail(300))"
          + (if $n then "\n  next \($n.name): \($n.input) -> \(if ($res[$n.id].err // false) then "failed again" else "ok" end)" else "" end) ]
    | reduce .[] as $b ([]; if any(.[]; .[0:160] == $b[0:160]) then . else . + [$b] end) | join("\n")' \
    < <(tail -n +"$from" "$tpath" | jq -cR 'fromjson? // empty' 2>/dev/null) 2>/dev/null) || text=""
  [ -z "$text" ] && return 0
  if [ "${#text}" -gt "$max" ]; then
    text=${text: -$max}
    text="FAILED${text#*$'\n'FAILED}" # start at a whole block
  fi
  printf '%s\n' "$text"
}

# ghost_is_gotcha TAGS — true when the comma-separated tags include `gotcha`.
# Capture stores these per session (key suffixed with the session id, no
# --dedup): a same-key put replaces the earlier version's session tag, and
# --dedup reinforces a paraphrase without adding one, so either would hide that
# the gotcha recurred. ghost-gotcha-promote.sh does the grouping instead.
ghost_is_gotcha() {
  case ",$(printf '%s' "$1" | tr -d ' ')," in *,gotcha,*) return 0 ;; esac
  return 1
}

# The gotcha section both capture prompts share (eval 2026-10-07: catches 7 of
# 22 known recurring gotchas fully and 4 partly, vs 0 before; regular learnings
# unchanged).
GHOST_GOTCHA_RULES='## Gotchas (tag: gotcha)
From FAILED TOOL CALLS, capture each environment, tool, sandbox, CLI or workflow failure that
- has a visible workaround (the next call worked, or the assistant text says what fixed it), and
- would plausibly recur in other sessions or projects.
Capture these even when the fix took one step: they recur. One memory per distinct gotcha.
  - "content": one rule: "When <symptom>, <workaround> (<cause>)."
  - "kind": "procedural"; "tags": "gotcha" (add project:<name> only if it is specific to that repo)
Skip failures caused by the code being written (type errors, failing tests, bugs) and noise (no-match greps, commands that printed results then exited non-zero).
'

# ghost_junk_learning KEY CONTENT — true (0) when an extracted item must not be
# stored as a learning: any session-summary key (the summary is handled
# separately, whatever suffix the model gives it) or empty-session filler.
ghost_junk_learning() {
  local key=$1 content=$2
  case "$key" in session-summary*) return 0 ;; esac
  printf '%s' "$content" | grep -qiE 'transcript (ends|captures only)|ends immediately|no (tool calls|investigation|implementation|user (work|tasks))|(startup|planning)-only session|no (ai )?response was (produced|recorded)'
}
