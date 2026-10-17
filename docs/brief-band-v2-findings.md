# brief band v2: findings

Branch `feat/brief-band-v2` (worktree `.worktrees/brief-band-v2`), from origin/master b017ac4. Claude Code 2.1.302.

## Checklist

- [x] Inventory + gap list
- [x] Pure layout module (fit function, line forms, ASCII) + tests
- [x] Ask model (queue, armed ask, undo window, defaults, drift) + tests
- [x] Hooks: band, spinner suffix, /brief snapshot, notify, tools, compose, delivery, classic.Stop, fork check
- [x] Remove dropped surfaces (panes, /brief subcommands, /ledger /jobs aliases, job poller)
- [x] validate + tsc + plugin test clean
- [x] tmux captures at 80x30, 60x24, main screen (NO_FLICKER=0)
- [x] Remove debug command, kill tmux + server
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


## Captures (tmux capture-pane -p; band rows only, trailing spaces trimmed)

Fullscreen (default), 80x30:

```
# turn running, nothing open
· Swirling… 3/6 (4s · ↓ 4 tokens)
# turn running, ask open
✢ Swirling… 3/6 (11s · ↓ 4 tokens)
! Publish the mod to GitHub?  1: private  2: public  3: later        +1  6m [-]
# blocked (2 lines)
3/6 Register brief_ask  waiting on plugin test 1m12s                        [-]
! Publish the mod to GitHub?  1: private  2: public  3: later        +1  6m
# default (2 lines)
3/6 Register brief_ask  ended 2m ago                                        [-]
? Deliver your answers mid-turn?  1: mid-turn  2: next turn   default in 4m
# drift
? Status-line entry isn't in done-when  1: keep  2: drop       after turn 7 [-]
# answered
sent: private  0: undo                                                      [-]
# done
6/6 done  3/3 done-when met  22m                                            [-]
# after pressing 1 mid-turn
sent: private  0: undo                                                      [-]
# after 2 then 0 (undo)
? Deliver your answers mid-turn?  1: mid-turn  2: next turn   default in 4m [-]
```

60x24:

```
# blocked
3/6 Register brief_ask  waiting on plugin test 1m12s    [-]
! Push to GitHub?  1: private  2: public  3: later   +1
# default
3/6 Register brief_ask  ended 2m ago                    [-]
? Answers mid-turn?  1: mid-turn  2: next turn       4m
# drift
? Status-line entry?  1: keep  2: drop               t7 [-]
# answered
sent: private  0: undo                                  [-]
# done
6/6 done  3/3 done-when met  22m                        [-]
# between
3/6 Register brief_ask  waiting on plugin test 1m12s    [-]
```

Main screen (CLAUDE_CODE_NO_FLICKER=0), 80x30:

```
# blocked
3/6 Register brief_ask  waiting on plugin test 1m12s                        [-]
! Publish the mod to GitHub?  1: private  2: public  3: later        +1  6m
# default
3/6 Register brief_ask  ended 2m ago                                        [-]
? Deliver your answers mid-turn?  1: mid-turn  2: next turn   default in 4m
# drift
? Status-line entry isn't in done-when  1: keep  2: drop       after turn 7 [-]
# answered
sent: private  0: undo                                                      [-]
# turn running
· Burrowing… 3/6 (3s · ↓ 4 tokens)
```

/brief at 80 columns:

```
Ship v0 of the brief mod: pane + agent ask tool
done when  [x] pane draws  [ ] answers reach agent  [ ] tests pass
! Publish the mod to GitHub?  private / public / later  6m
? Deliver your answers mid-turn?  mid-turn / next turn  default in 4m
since 9m  pane skeleton, contract, 2 asks, 3 file edits
on track after turn 6  unplanned: status-line entry  ctx 0%
```

Colors (capture-pane -e): blocking sigil+question 38;5;220 (warning); hotkey digits 38;5;153 (accent, drawn by Claude Code); meta, activity state, `sent:` 38;5;246 (dim); `done` 38;5;114 (success).

Delivery: mid-turn answer landed in the transcript JSONL as `[brief] D3 -> private (you). Resume with private.`; an idle answer started a turn shown as "Prompt from the brief plugin". Undo (0) sent nothing (`grep -c "D4 ->"` = 0).

## Differences from the reference

- Snapshot "since" line says `3 file edits` where the reference says `3 type errors fixed`: hooks count what they observe and do not write prose. `ctx 0%` is the fake server's usage.
- Drift short form is the unplanned work cut at a word plus `?` (`Status-line entry?`); the spec gives no 60-column drift line.
- Agent rows use ASCII `->` where the spec's example has an arrow.

## Where the types and the prompt rub

- Spinner `suffix` replaces the engine's ellipsis entirely; the mod sets `suffix: e.props.suffix + ' 3/6'` so its own string stays ASCII.
- `claude plugin validate`: `classic.Stop` and `prompt.compose` hooks do not run in a plugin a person installs where an organization manages Claude Code.
- Not in the types, found by the loader: one hooks module per mod (`hooks.json` with two modules loads none), one hook per event per module, `$` passed across files only into a function declaration.
- An idle `$.prompt.submit` is framed by Claude Code ("The brief plugin sent a message: ... This is how Claude Code surfaces a prompt a plugin submits"), so the agent reads more than the 120-character row.
