# brief band v2: findings

Branch `feat/brief-band-v2` (worktree `.worktrees/brief-band-v2`), from origin/master b017ac4. Claude Code 2.1.302.

## Checklist

- [x] Inventory + gap list
- [ ] Pure layout module (fit function, line forms, ASCII) + tests
- [ ] Ask model (queue, armed ask, undo window, defaults, drift) + tests
- [ ] Hooks: band, spinner suffix, /brief snapshot, notify, tools, compose, delivery, classic.Stop, fork check
- [ ] Remove dropped surfaces (panes, /brief subcommands, /ledger /jobs aliases, job poller)
- [ ] validate + tsc + plugin test clean
- [ ] tmux captures at 80x30, 60x24, main screen (NO_FLICKER=0)
- [ ] Remove debug command, kill tmux + server
- [ ] Docs (brief-mod-design.md), fresh-context review
- [ ] Ask: retire legacy `brief` / `report` tools (agent already calls them)

## Baseline (before any change)

- `claude plugin validate`: passed with warnings (prompt.compose under managed orgs; gating hooks with .catch).
- `claude plugin test`: 41 pass, 0 fail.
- `tsc -p` (TS 7.0.2 and 5.6.3): only TS5097 "import path can only end with '.ts'" on `./brief.ts`-style imports. Pre-existing.

## Inventory (today)

- Hooks: session.start, session.end, ui.close, turn.start, turn.complete, tool.call, session.append, session.receive, prompt.submit, prompt.compose, command.run{brief|ledger|jobs}, ui.render{AbovePrompt}, ui.render{Pane brief}, ui.render{Pane brief-all}.
- Draws: band of up to ~8 rows (glyph+status, asks in raw `yellow`, decided count, ctx%+ledger summary, up to 4 job rows in raw `red`); Pane `brief`; Pane `brief-all`; toasts for failed/killed jobs.
- Registers: commands /brief (11 subcommands), /ledger, /jobs; tools `brief` and `report` (both deferred).
- Prompt: sections `brief:rule` (BRIEF_RULE) and `brief:progress` (::progress markers).
- Model: haiku turn-end summary when the turn did not end on a brief call.
- State ($.state brief.*): entries, ctx, fails, turns, limits, jobs, lastPromptAt, brief, decisions, isWorking.
- Stored: $.store `bandMode`, `decisions:<sessionId>`; files `~/.claude/mods-data/brief/<sessionId>.json`.
- Not used today: $.ui.status, PromptHint tail, SessionMode, /recap. Nothing to remove there.

## Gap list against the spec

1. Band draws many rows -> at most 2 (activity, ask), computed fit at bodyColumns, theme keys not raw colors.
2. No Spinner hook -> add suffix `… k/n`.
3. /brief toggles a Pane and has subcommands -> CommandOutput snapshot, `{ text: 'Brief shown.' }`; drop panes, subcommands, /ledger /jobs aliases.
4. No $.ui.notify -> notify on blocking asks only.
5. Tools `brief`, `report` -> `brief_ask` (not deferred), `brief_note`, `brief_read`. The agent already calls `brief`/`report` (global CLAUDE.md, BRIEF_RULE): renaming needs the owner's OK, so the legacy pair stays isolated in `hooks/legacy.ts` until then.
6. Two compose sections -> one fixed section (legacy rule stays only while legacy tools do).
7. No answer delivery -> Buttons with hotkeys, 3s undo, then session.append (turn running) or prompt.submit (idle), merged per step, <= 120 chars.
8. Jobs by tailing logs / ::progress -> classic.Stop background_tasks + session_crons.
9. Steps: none -> task tool calls when present, else done-when count.
10. haiku fallback summary -> direction check via $.model.fork on turn.complete (drift ask).
11. Default-applied ask: new.
12. Old $.store keys and mods-data files: no longer read or written; NOT deleted (needs the owner's OK).

## Decisions taken (see brief queue)

