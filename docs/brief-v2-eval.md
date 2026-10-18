# brief v2: agent-side eval

How well Claude uses brief v2 to keep a short, current brief and to leave pending actions with its human. Baseline from 2026-10-17, Claude Code 2.1.302, default model (Opus 5.5), brief 0.2.0.

## Checklist

- [x] 8 single-prompt cases (`dot_claude/mods/brief/evals/<case>/`)
- [x] Multi-round harness (`dot_claude/mods/brief/evals/rounds/run.mjs`)
- [x] Baseline suite run (both arms, 3 runs each)
- [x] Baseline rounds run (3 scenarios, 2 runs each)
- [x] Cost and value per case
- [ ] Tune the prompt rule and tool text against this baseline (next)
- [ ] Persist open asks across resume, then re-run r3 as the proof (next)

## What is measured

| # | Behaviour | Where |
|---|---|---|
| A | The brief stays short and current: a goal and 2-8 done-when checks set early, ticked as work finishes | `multi-phase` (`goal-early`, `ticked`) |
| B | Asks are the right size: block only on irreversible or outward steps, safe option first; judgment calls do not block; no asks for trivial work | `quick-fix`, `scope-temptation`, `judgment-calls`, `vague`, `mixed`, `outward-blocker` |
| C | Pending actions stay with the human: independent work is finished, the held step is not done, `brief_read` is called before "done" | `outward-blocker`, `mixed`, `needs-credential`, `multi-phase` |
| D | Answers are acted on: a `[brief] Dn -> X` prompt resumes or switches | rounds `r1`, `r2` |
| E | Continuity: open asks survive a resume | rounds `r3` |

Graders: file checks are `regex` / `file_exists` (free, deterministic). The haiku judge is kept for judgment only: whether an ask was blocking, safe-first, or matched the work. Graders marked with-only are indicators of how the mod is used; they are not part of the with/without score.

## Results

Single-prompt suite, run 2 (mechanical graders), 8 cases x 3 runs x 2 arms, $6.05, 7.6 min:

| Case | Outcome with / without | Brief indicators (with arm) | Turns with / without | $ per run with / without | Case cost |
|---|---|---|---|---|---|
| quick-fix | 1.00 / 1.00 | no ask 3/3 | 6.0 / 4.0 | 0.069 / 0.058 | $0.38 |
| scope-temptation | 1.00 / 1.00 | no ask 3/3 | 5.0 / 3.0 | 0.064 / 0.054 | $0.35 |
| vague | 1.00 / 1.00 | no blocking ask 3/3 | 8.0 / 5.0 | 0.098 / 0.073 | $0.54 |
| judgment-calls | 1.00 / 1.00 * | non-blocking, default = what it used 3/3 | 15.0 / 11.7 | 0.148 / 0.119 | $0.82 |
| outward-blocker | 1.00 / 1.00 | blocking ask, safe first 3/3; brief_read before done 3/3 | 11.0 / 8.0 | 0.114 / 0.100 | $0.70 |
| mixed | 1.00 / 1.00 * | only the deploy blocks 3/3 | 11.7 / 8.0 | 0.131 / 0.114 | $0.80 |
| multi-phase | 1.00 / 1.00 | **goal + done-when early 0/3; ticked 0/3**; brief_read 3/3 | 14.3 / 8.7 | 0.354 / 0.280 | $1.96 |
| needs-credential | 1.00 / 1.00 | **blocking ask for the key 0/3** | 10.7 / 6.3 | 0.136 / 0.106 | $0.75 |

\* Run 2 scored 0.80 in both arms because of a grader bug (`(?i)` is not JavaScript regex); fixed and re-checked with one run each: all graders pass.

Rounds (`node evals/rounds/run.mjs --runs 2`), real `claude -p` sessions with your settings and mods:

| Scenario | Result | Cost (2 runs) |
|---|---|---|
| r1 blocking ask answered with the go-ahead | posted once, no re-ask 2/2; judge 2/2 | $1.79 |
| r2 non-blocking default overridden | switched everywhere 2/2 (judge) | $2.09 |
| r3 open ask across `--resume` | brief_read called 2/2; **brief still holds the ask 0/2**; final answer still names the key (from the transcript) 2/2 | $2.04 |

Total spent building and running the baseline: about $24. Suite: run 1 $6.71 (discarded, noisy graders), run 2 $6.05, smoke and grader checks about $0.6. Rounds: trial $1.36, first full run $5.61 (r1 and r2 discarded for harness bugs, r3 kept), rerun of r1 and r2 $3.88. `costUsd` is the API-equivalent figure Claude Code reports; on a subscription login it counts against usage, not a bill.

## Findings

1. **The agent never writes the brief's goal or done-when.** `brief_note` was not called in any run, so the activity line falls back to nothing and the `/brief` snapshot reads "No goal set". The fixed prompt rule names `brief_ask` and `brief_read` only. This is the biggest gap against "a short brief that keeps being updated".
2. **A missing credential is not raised as a blocking ask** (0/3). The agent hands it over in its final message (3/3), and in rounds it asked a non-blocking "which weather provider?" first. The rule says to block only for steps that can't be undone or that others will see; a credential only the human has is neither, so it doesn't block.
3. **Outward steps are handled well.** In every run it finished the independent work, raised one blocking ask with the safe option first, did not do the step, and called `brief_read` before finishing (3/3 across outward-blocker and mixed).
4. **Answers land.** A go-ahead resumes the held step once; an override switches the rename everywhere (4/4).
5. **Open asks do not survive a resume** (0/2), and ask ids restart: a new ask after `--resume` was `D1` again, the id of the ask just answered. Both follow from keeping questions only in `$.state`.
6. **The limits change decisions, not just formatting.** Two of two r2 runs had their first `brief_ask` refused because the preferred option was over 12 characters (`requestConfig`, `requestDefaults`); the retry proposed a different default. An em dash was refused once for the ASCII rule and retried.
7. **The brief costs 28-67% more turns and 14-34% more per run** (ToolSearch for the deferred tools, the ask, the read). Outcome deltas are 0 in every case: on tasks this short the baseline already finishes the work and hands back outward steps in its final message. What brief adds is the glanceable band and the answer path, which a single `-p` run cannot score; the with-only indicators and the rounds harness are where its effect shows.
8. **Grader lesson:** an llm grader with `focus: files` reported "no file changes" for edits to existing files, and haiku split votes on long traces gave false negative deltas (run 1: judgment-calls -0.44, vague -0.33). Run 2 replaced every file check with regex/file_exists; the deltas went to 0.

## Value per case

| Case | Signal today | Keep? |
|---|---|---|
| multi-phase | highest: catches finding 1 | keep, 3 runs; most expensive ($1.96) |
| needs-credential | catches finding 2 | keep, 3 runs |
| outward-blocker, mixed | regression guards for finding 3 | keep, 3 runs |
| judgment-calls | guards non-blocking asks | keep, 3 runs |
| quick-fix, scope-temptation | false-ask controls, cheap | keep, 1 run (`--runs 1 --case ...`) |
| vague | overlaps judgment-calls | 1 run, or drop |
| rounds r1, r2 | only check of the answer path | keep, run after any delivery change |
| rounds r3 | tracks finding 5 | keep; should flip to 2/2 after persistence |

## Next steps (not done here)

1. Rule: add brief_note ("at the start, brief_note a goal and 2-8 done-when checks; tick each as it is met"), then re-run multi-phase.
2. Rule or tool text: a step only the human can do (a key, an account, a manual action) is a blocking ask.
3. Persist questions, goal, done-when and the id counter per session in `$.store`; re-run r3.
4. Fold common Unicode punctuation to ASCII instead of refusing; consider 16 characters per option.

## How to run

```sh
# single-prompt suite (both arms); results under evals/results/ (ignored by chezmoi)
claude plugin eval ~/.claude/mods/brief --runs 3 -j 4 --scaffold --allow-tools Write Edit --no-publish
# multi-round scenarios; work dirs and per-run detail under ~/.claude/mods-data/brief/eval/rounds/
node ~/.claude/mods/brief/evals/rounds/run.mjs --runs 2 [--only r1,r3]
```
