#!/usr/bin/env bash
# mux-status.sh <state>
# Updates the tmux window name / zellij tab name with a status symbol so you can
# glance at the tab bar and see which Claude session is working / done / blocked.
#
# The base NAME is preserved across updates — only the leading symbol changes:
#   * tmux:    reads the current window name and swaps its symbol, so renaming
#              the window natively (Ctrl-b ,) sticks.
#   * pinned:  a custom name set via `mux-name.sh "My Name"` (state file) wins
#              over everything, for both tmux and zellij.
#   * default: the repo (cwd) basename.
#
# Invoked by Claude Code hooks:
#   working -> UserPromptSubmit   idle  -> Stop
#   blocked -> Notification       start -> SessionStart
#   tool    -> PreToolUse (glyph reflects the tool: ⚡bash ✎edit ▤read ◍search ▶task)
#
# Never blocks Claude: always exits 0. No-op when not inside tmux/zellij.

state="${1:-idle}"
STATE_DIR="$HOME/.claude/hooks/.mux-status"
export LC_CTYPE="${LC_CTYPE:-UTF-8}"   # so sed treats multibyte glyphs as one char

# --- symbols (edit to taste) -------------------------------------------------
SYM_WORKING="◐"   # thinking / generic working
SYM_IDLE="✓"      # done, waiting on you
SYM_BLOCKED="⚠"   # needs input / permission
SYM_START="○"     # fresh session
# per-tool activity glyphs (PreToolUse)
SYM_BASH="⚡"; SYM_EDIT="✎"; SYM_READ="▤"; SYM_SEARCH="◍"
SYM_TASK="▶"; SYM_TODO="☰"; SYM_MCP="◇"; SYM_TOOL="◆"
# every glyph we might emit — stripped when reading a name back
ALL_SYMS="◐✓⚠○⚡✎▤◍▶☰◇◆●"

# map a PreToolUse tool name to an activity glyph
tool_sym() {
  case "$1" in
    Bash|BashOutput|KillShell)                printf '%s' "$SYM_BASH" ;;
    Edit|Write|MultiEdit|NotebookEdit|Update) printf '%s' "$SYM_EDIT" ;;
    Read)                                     printf '%s' "$SYM_READ" ;;
    Grep|Glob|WebSearch|WebFetch|ToolSearch)  printf '%s' "$SYM_SEARCH" ;;
    Task|Agent)                               printf '%s' "$SYM_TASK" ;;
    TodoWrite|TaskCreate|TaskUpdate)          printf '%s' "$SYM_TODO" ;;
    mcp__*)                                   printf '%s' "$SYM_MCP" ;;
    *)                                        printf '%s' "$SYM_TOOL" ;;
  esac
}

# --- read hook JSON on stdin (cwd, tool_name) --------------------------------
cwd=""; tool_name=""
if [ ! -t 0 ]; then
  payload="$(cat 2>/dev/null)"
  cwd="$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  tool_name="$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
fi
[ -z "$cwd" ] && cwd="$PWD"
repo="$(basename "$cwd")"

# --- pick the symbol for this event ------------------------------------------
case "$state" in
  working) sym="$SYM_WORKING" ;;
  idle)    sym="$SYM_IDLE" ;;
  blocked) sym="$SYM_BLOCKED" ;;
  start)   sym="$SYM_START" ;;
  tool)    sym="$(tool_sym "$tool_name")" ;;
  *)       sym="$SYM_IDLE" ;;
esac

# --- strip any leading status symbol from a name -----------------------------
strip_sym() {
  # remove a leading symbol from $ALL_SYMS plus following spaces
  printf '%s' "$1" | sed -E "s/^[${ALL_SYMS}]+[[:space:]]*//"
}

# --- per-tab key (must match what mux-name.sh computes) ----------------------
mux_key() {
  if [ -n "$TMUX" ] && [ -n "$TMUX_PANE" ]; then
    tmux display-message -p -t "$TMUX_PANE" 'tmux:#{session_name}:#{window_id}' 2>/dev/null
  elif [ -n "$ZELLIJ" ]; then
    printf 'zellij:%s:%s' "${ZELLIJ_SESSION_NAME:-z}" "${ZELLIJ_PANE_ID:-$repo}"
  else
    printf 'cwd:%s' "$cwd"
  fi
}
key="$(mux_key)"
keyfile="$STATE_DIR/$(printf '%s' "$key" | tr -c 'A-Za-z0-9' '_')"

# --- resolve the base label --------------------------------------------------
# Precedence: pinned custom name > a genuine later manual rename > repo name.
base=""
if [ -n "$key" ] && [ -f "$keyfile.name" ]; then
  # 1. pinned via mux-name.sh — always wins
  base="$(cat "$keyfile.name" 2>/dev/null)"
elif [ -n "$key" ] && [ -f "$keyfile.base" ]; then
  # Not the first render for this tab. Default to the base we last used, but
  # adopt the current name if it was manually changed since (tmux only, since
  # zellij can't report its tab name back).
  base="$(cat "$keyfile.base" 2>/dev/null)"
  if [ -n "$TMUX" ] && [ -n "$TMUX_PANE" ]; then
    cur="$(strip_sym "$(tmux display-message -p -t "$TMUX_PANE" '#{window_name}' 2>/dev/null)")"
    [ -n "$cur" ] && [ "$cur" != "$base" ] && base="$cur"
  fi
else
  # First render for this tab: use the repo name, NOT tmux's default window
  # name (which would be the shell/program, e.g. "zsh").
  base="$repo"
fi
[ -z "$base" ] && base="$repo"

label="$sym $base"

# --- apply -------------------------------------------------------------------
if [ -n "$ZELLIJ" ] && command -v zellij >/dev/null 2>&1; then
  zellij action rename-tab "$label" >/dev/null 2>&1
fi
if [ -n "$TMUX" ] && command -v tmux >/dev/null 2>&1; then
  if [ -n "$TMUX_PANE" ]; then
    win="$(tmux display-message -p -t "$TMUX_PANE" '#{window_id}' 2>/dev/null)"
    if [ -n "$win" ]; then
      # keep tmux from auto-renaming the window back to the running program
      tmux set-window-option -t "$win" automatic-rename off 2>/dev/null
      tmux rename-window -t "$win" "$label" 2>/dev/null
    fi
    tmux select-pane -t "$TMUX_PANE" -T "$label" 2>/dev/null
  else
    tmux rename-window "$label" 2>/dev/null
  fi
fi

# remember base + symbol so mux-name.sh can re-render on demand
if [ -n "$key" ]; then
  mkdir -p "$STATE_DIR" 2>/dev/null
  printf '%s' "$sym"  > "$keyfile.sym"  2>/dev/null
  printf '%s' "$base" > "$keyfile.base" 2>/dev/null
fi

exit 0
