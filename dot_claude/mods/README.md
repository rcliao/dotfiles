# Claude Code mods

In-process function-hook plugins ("mods", Claude Code 2.1.287+), loaded in every
session through `CLAUDE_CODE_PLUGIN_DIRS` in `.chezmoitemplates/claude-settings.json`.
Each folder is a complete plugin; `claude plugin validate <dir>` and
`claude plugin test <dir>` check one. This README is repo documentation and is
not deployed.

| Mod | What it does |
| --- | --- |
| `failure-streak` | Flags likely sandbox network blocks on failed Bash; refuses the 4th identical failing command (edits, new errors and polling reset it); pinned status from the 2nd repeat. |
| `run-ledger` | One band line: context tokens/window, growth per turn, turns to auto-compact, named outward actions (PRs, tags, publishes, merges), files edited. `/ledger`, `/ledger reset`, and a model tool for the end-of-run report. |
| `jobs` | Background shells and agents as band rows with progress (`::progress 12/40 …` / `::status …` lines win over guesses), ETA and stall hints; `/jobs` pane with stop buttons. |
| `collision-guard` | Asks before editing a file another open session changed in the last 30 minutes. Vendored unchanged from `nateherkai/claude-code-mods` at `33a936f` (MIT); reviewed: no network or model calls, writes only `~/.claude/mods-data/collision-guard/`, runs `git ls-files`. |

## One display per kind of event

Mods share a small screen, so each event gets the quietest surface that still
gets it noticed:

| Surface | For |
| --- | --- |
| dim band text | ambient state (context, outward actions, running/done jobs) |
| red band row | a failure; stays until the next prompt |
| ⚠ pinned status | a run that is stuck (repeated failure) |
| toast | an event you would otherwise miss (job failed/killed) |
| dialog | a decision only you can make (edit collision) |
| model-only context | steering Claude, invisible to you |
| pane / command | detail on request (`/jobs`, `/ledger`, `/guard`) |

Band order is fixed: `run-ledger` draws above what is beneath it, `jobs` below,
so the ledger line stays on top in either load order. Nothing draws in the
footer tail: the engine drops it when the footer is full.
