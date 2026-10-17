# Claude Code mods

In-process function-hook plugins ("mods", Claude Code 2.1.287+), loaded in every
session through `CLAUDE_CODE_PLUGIN_DIRS` in `.chezmoitemplates/claude-settings.json`.
Each folder is a complete plugin; `claude plugin validate <dir>` and
`claude plugin test <dir>` check one. This README is repo documentation and is
not deployed.

| Mod | What it does |
| --- | --- |
| `failure-streak` | Flags likely sandbox network blocks on failed Bash; refuses the 4th identical failing command (edits, new errors and polling reset it); pinned status from the 2nd repeat. |
| `brief` | One glance at a session, in at most two band lines. Between turns: `3/6 <step>  waiting on <job> 1m12s` (or `wakes in`, `ended 2m ago`, or `6/6 done  3/3 done-when met  22m`). Whenever Claude has asked something: the armed ask nearest the prompt, `! <question>  1: a  2: b  <meta>` (`!` blocks, `?` goes ahead with option 1); a digit typed into an empty prompt answers it, held 3 s as `sent: <option>  0: undo`, then delivered to Claude (a user row mid-turn, a prompt when idle). Defaults apply after 10 minutes and come back as `? … 1: keep  2: drop`, as does work a per-turn direction check (`$.model.fork`, only once a goal is set) finds outside done-when. The spinner gets ` k/n`; `/brief` prints a snapshot (goal, done-when, open asks, what changed, health) into the transcript; blocking asks raise a notification. Claude writes through `brief_ask` (always loaded), `brief_note` and `brief_read`; steps come from its task tool, jobs and wakeups from `classic.Stop`. The v1 tools `mcp__brief__brief` and `mcp__brief__report` still work from `hooks/legacy.ts` until they are retired. Design: `docs/brief-mod-design.md`; v2 build log: `docs/brief-band-v2-findings.md`. |
| `ghost-lens` | Watches the ghost memory hooks. It is quiet by default and keeps a shadow log (`~/.ghost/lens/`) of which memories were injected and whether the agent used them. `/ghost` opens a pane: memories with their scores, tokens and verdicts, hook runs, captured writes, and used/noise corrections. `/ghost debug` turns on a band and status line, and `/ghost report` prints a cross-session report. It also adds one system-prompt sentence nudging the agent to call `ghost_context`. Reads the hook trace that `~/.claude/hooks/ghost-trace.sh` writes. |
| `collision-guard` | Asks before editing a file another open session changed in the last 30 minutes. Vendored unchanged from `nateherkai/claude-code-mods` at `33a936f` (MIT); reviewed: no network or model calls, writes only `~/.claude/mods-data/collision-guard/`, runs `git ls-files`. |

## One display per kind of event

Mods share a small screen, so each event gets the quietest surface that still
gets it noticed:

| Surface | For |
| --- | --- |
| band activity line | where the work stands between turns (brief); silent during a turn |
| band ask line | the one question you can answer with a digit (brief), amber when it blocks Claude |
| spinner suffix | the step count while a turn runs (brief) |
| ⚠ pinned status | a run that is stuck (repeated failure) |
| notification | a blocking ask (brief) |
| dialog | a decision only you can make (edit collision) |
| model-only context | steering Claude, invisible to you |
| pane / command | detail on request (`/brief` snapshot, `/ghost`, `/guard`) |

When `brief` has something to say it draws the band alone (at most two lines,
fitted by hand to `bodyColumns`); otherwise it passes the band to whatever is
beneath. Nothing draws in the footer tail: the engine drops it when the footer
is full.

## Evals

`brief` has two eval suites, both for the v1 tools (`hooks/legacy.ts`). Each writes only aggregates to the repo:

- `node evals/replay/replay.mjs --n 40 --seed 7` replays real turn ends from
  `~/.claude/projects` through the turn-end summarizer. A sonnet judge grades
  the result with hindsight from your next message. All per-sample output stays
  in `~/.claude/mods-data/brief/eval/`. Cost is about $0.01–0.02 per sample.
- `claude plugin eval ~/.claude/mods/brief --scaffold --allow-tools Write Edit --no-publish`
  runs scripted cases with and without the mod. Write and Edit need the grant
  even though the cases list them. No case grants Bash, because Bash-granting
  cases refuse to run while `~/.docker/cli-plugins` holds Docker Desktop
  symlinks. Cost is about $6 for the full two-arm run.
