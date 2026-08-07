#!/usr/bin/env bash
# mux-name.sh "My Custom Name"   -> pin a custom tab name for THIS pane/window
# mux-name.sh --clear            -> unpin (revert to native name / repo basename)
#
# The status hook (mux-status.sh) keeps this name and only swaps the leading
# status symbol. Run it from inside the tmux window / zellij tab you want named.

STATE_DIR="$HOME/.claude/hooks/.mux-status"
ALL_SYMS="◐✓⚠○"

# --- per-tab key (MUST match mux_key() in mux-status.sh) ---------------------
if [ -n "$TMUX" ] && [ -n "$TMUX_PANE" ]; then
  key="$(tmux display-message -p -t "$TMUX_PANE" 'tmux:#{session_name}:#{window_id}' 2>/dev/null)"
elif [ -n "$ZELLIJ" ]; then
  key="zellij:${ZELLIJ_SESSION_NAME:-z}:${ZELLIJ_PANE_ID:-$(basename "$PWD")}"
else
  key="cwd:$PWD"
fi
keyfile="$STATE_DIR/$(printf '%s' "$key" | tr -c 'A-Za-z0-9' '_')"
mkdir -p "$STATE_DIR" 2>/dev/null

if [ "$1" = "--clear" ] || [ "$1" = "-c" ]; then
  rm -f "$keyfile.name" 2>/dev/null
  base="$(basename "$PWD")"
  echo "mux-name: cleared custom name for this tab (reverts to: $base)"
else
  name="$*"
  if [ -z "$name" ]; then
    echo "usage: mux-name.sh \"My Name\"   |   mux-name.sh --clear" >&2
    exit 1
  fi
  printf '%s' "$name" > "$keyfile.name"
  base="$name"
  echo "mux-name: pinned this tab as \"$name\""
fi

# --- re-render now, reusing the last symbol (default ○) ----------------------
sym="○"
[ -f "$keyfile.sym" ] && sym="$(cat "$keyfile.sym" 2>/dev/null)"
label="$sym $base"

if [ -n "$ZELLIJ" ] && command -v zellij >/dev/null 2>&1; then
  zellij action rename-tab "$label" >/dev/null 2>&1
fi
if [ -n "$TMUX" ] && command -v tmux >/dev/null 2>&1 && [ -n "$TMUX_PANE" ]; then
  win="$(tmux display-message -p -t "$TMUX_PANE" '#{window_id}' 2>/dev/null)"
  [ -n "$win" ] && tmux rename-window -t "$win" "$label" 2>/dev/null
  tmux select-pane -t "$TMUX_PANE" -T "$label" 2>/dev/null
fi
exit 0
