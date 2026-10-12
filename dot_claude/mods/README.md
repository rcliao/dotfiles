# Claude Code mods

In-process function-hook plugins ("mods", Claude Code 2.1.287+), loaded in every
session through `CLAUDE_CODE_PLUGIN_DIRS` in `.chezmoitemplates/claude-settings.json`.
Each folder is a complete plugin; `claude plugin validate <dir>` and
`claude plugin test <dir>` check one. This README is repo documentation and is
not deployed.

| Mod | What it does |
| --- | --- |
| `failure-streak` | Flags likely sandbox network blocks on failed Bash; refuses the 4th identical failing command (edits, new errors and polling reset it); pinned status from the 2nd repeat. |
| `brief` | One glance at a session. Band: Claude's status (◐ working, ⚠ needs you, ✓ done), then `needs you (N): …` in yellow until you reply, then the context and outward-actions line, then background job rows. Claude writes the status and asks through a model tool (`mcp__brief__brief`); when a turn ends without that call, haiku summarizes the final answer instead. Status and asks are narrative; context, outward actions (PRs, tags, publishes, merges, paid calls), edited files and job progress (`::progress 12/40 …` / `::status …`) are recorded from what actually ran. `/brief` toggles a pane with stop buttons for jobs; `/brief min` keeps only the status and asks rows (plus red context and failed jobs), `/brief off` hides the band, `/brief full` restores it, and the choice is remembered across sessions; `/brief all` lists every live session's asks from `~/.claude/mods-data/brief/`; `/brief reset`; `/ledger` and `/jobs` are aliases. `mcp__brief__report` feeds the end-of-run report. Replaces `run-ledger` and `jobs`. Design and eval results: `docs/brief-mod-design.md`, `docs/brief-mod-findings.md`. |
| `ghost-lens` | Watches the ghost memory hooks. It is quiet by default and keeps a shadow log (`~/.ghost/lens/`) of which memories were injected and whether the agent used them. `/ghost` opens a pane: memories with their scores, tokens and verdicts, hook runs, captured writes, and used/noise corrections. `/ghost debug` turns on a band and status line, and `/ghost report` prints a cross-session report. It also adds one system-prompt sentence nudging the agent to call `ghost_context`. Reads the hook trace that `~/.claude/hooks/ghost-trace.sh` writes. |
| `collision-guard` | Asks before editing a file another open session changed in the last 30 minutes. Vendored unchanged from `nateherkai/claude-code-mods` at `33a936f` (MIT); reviewed: no network or model calls, writes only `~/.claude/mods-data/collision-guard/`, runs `git ls-files`. |

## One display per kind of event

Mods share a small screen, so each event gets the quietest surface that still
gets it noticed:

| Surface | For |
| --- | --- |
| plain band text | what Claude is doing now (brief status) |
| yellow band row | what Claude needs from you (brief asks); dim once you have replied |
| dim band text | ambient state (context, outward actions, running/done jobs) |
| red band row | a failure; stays until the next prompt |
| ⚠ pinned status | a run that is stuck (repeated failure) |
| toast | an event you would otherwise miss (job failed/killed) |
| dialog | a decision only you can make (edit collision) |
| model-only context | steering Claude, invisible to you |
| pane / command | detail on request (`/brief`, `/brief all`, `/ghost`, `/guard`) |

Band order is fixed: `brief` draws status, asks, the ledger line and job rows
above whatever is beneath it. Nothing draws in the footer tail: the engine
drops it when the footer is full.

## Evals

`brief` has two eval suites. Each writes only aggregates to the repo:

- `node evals/replay/replay.mjs --n 40 --seed 7` replays real turn ends from
  `~/.claude/projects` through the turn-end summarizer. A sonnet judge grades
  the result with hindsight from your next message. All per-sample output stays
  in `~/.claude/mods-data/brief/eval/`. Cost is about $0.01–0.02 per sample.
- `claude plugin eval ~/.claude/mods/brief --scaffold --allow-tools Write Edit --no-publish`
  runs scripted cases with and without the mod. Write and Edit need the grant
  even though the cases list them. No case grants Bash, because Bash-granting
  cases refuse to run while `~/.docker/cli-plugins` holds Docker Desktop
  symlinks. Cost is about $6 for the full two-arm run.
