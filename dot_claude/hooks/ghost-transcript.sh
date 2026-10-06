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

# ghost_junk_learning KEY CONTENT — true (0) when an extracted item must not be
# stored as a learning: any session-summary key (the summary is handled
# separately, whatever suffix the model gives it) or empty-session filler.
ghost_junk_learning() {
  local key=$1 content=$2
  case "$key" in session-summary*) return 0 ;; esac
  printf '%s' "$content" | grep -qiE 'transcript (ends|captures only)|ends immediately|no (tool calls|investigation|implementation|user (work|tasks))|(startup|planning)-only session|no (ai )?response was (produced|recorded)'
}
