# brief mod: progress and findings

Design: [brief-mod-design.md](brief-mod-design.md). Dev copy: `~/.claude/dev-mods/638885c3-44b6-43ba-a005-46975a5ad1e5/brief/`.

## Checklist
- [x] Design one-pager
- [x] 1. Port ledger.ts + progress.ts + 18 tests, green (baseline 9+9 pass on the old mods first)
- [x] 2. BriefState, BriefTool, ReportTool + prompt rule
- [x] 3. Band + BriefPane (merged renderer)
- [x] 4. TurnFallback (in `hooks/brief.ts`, not a separate summarize.ts)
- [x] 5. SessionFile + AllView. 27/27 tests, tsc 0, validate passes (only warning: no author)
- [x] 6a. ReplayEval: built, baseline score, tuned (results below)
- [x] 6b. LiveEval: cases run, results below
- [x] Fresh-context review of the diff: 3 blocking bugs found and fixed, each with a regression test
- [x] 7. Swapped in the dotfiles source (PLUGIN_DIRS, README, .chezmoiignore; run-ledger and jobs removed). Not yet applied with `chezmoi apply`

## Findings
- `claude plugin eval` grader types (2.1.296, read from the binary): `regex` (target last_message|trace|files|{source:file,path}), `tool_used` (tool, input_match, min, max, arm), `tool_order`, `file_exists`, `llm` (focus as regex target), `baseline`. Cases can set `context.history_file` (resume a recorded session) and `execution.append_system_prompt`. The HTML report publishes to claude.ai by default, so pass `--no-publish`.
- Lean model calls with no API key: `CLAUDE_CODE_PLUGIN_DIRS= claude -p --setting-sources "" --strict-mcp-config --tools "" --model haiku --output-format json`. Output is a JSON array; take the `type: "result"` row. `--bare` needs `ANTHROPIC_API_KEY`, so it doesn't work here.

## ReplayEval results (2026-10-12)

`node evals/replay/replay.mjs --n 40 --seed <s>`. The summarizer is haiku, using the TurnFallback prompt in `hooks/brief.ts`. The judge is sonnet with frozen gold labels. Samples are pairs of consecutive turn ends from 78 interactive sessions: 1,126 pairs whose answer has a "Blocked on me" section (report stratum) and 1,848 without (plain stratum). Only aggregates are recorded here. Per-sample output stays in `~/.claude/mods-data/brief/eval/`.

| Prompt version | Seed | Recall | False asks | Stale | Actionable | Status supported | Plain recall | Plain false |
|---|---|---|---|---|---|---|---|---|
| v1 (first draft) | 7 | 0.89 | 0.25 | 0.02 | 0.86 | 0.97 | 0.75 | 0.36 |
| v2 (new message is source of truth; one ask per decision) | 7 | 0.94 | 0.08 | 0.00 | 0.98 | 1.00 | 0.86 | 0.22 |
| v3 (skip "optional" offers): over-corrected | 7 / 11 | 0.86 / 0.91 | 0.07 / 0.00 | | | | 0.68 / 0.82 | |
| v4 (closing proposal counts; asides don't) | 7 / 11 | 0.85 / 0.90 | 0.11 / 0.02 | | | | 0.73 / 0.82 | |
| **v5 (handed-off steps count, kind `action`), pooled over seeds 7, 11, 23, n=120** | | **0.90** | **0.02** | **0.01** | **0.96** | **0.97** | **0.79** | **0.05** |

v1 to v4 were graded by a single judge call that also produced the gold labels. Those labels were noisy: the same 40 samples got 64 gold asks in one run and 46 in another. v5 rows use frozen gold, made once per sample and cached. Compare v5 only with itself.

What the tuning found:
- The biggest error source was carry-over. Given the previous view, haiku kept asks the new message no longer raised (5 of 12 failures in v1). The fix was to make the new message the only source of truth.
- Splitting one decision into several asks ("run the script" + "approve its spend") read as false asks. One ask per decision fixed it.
- "Want me to…?" and "Say the word if…" at the end of a message are real asks: the developer acted on them. The same phrasing used as an aside mid-message is not.
- Steps the agent hands to the developer (merge a PR first, change a setting and retry, sign up for a third-party account) were the main recall gap. They are now kind `action`.
- Status was never the problem: 0.97–1.00 supported and useful across every version.

Bars from the design: recall ≥0.8, false asks ≤10%, actionable ≥0.9, status supported ≥0.9. Every bar is met overall. Plain-stratum recall is **0.79**, just under its 0.8 bar. The plain stratum is the hard one (no formal report to copy from). I stopped tuning there to avoid fitting these samples. Each further point is about one ask in 57.

Harness gotchas:
- This live session's transcript grows while the eval runs, so a seed drew different samples on later runs. Samples are now frozen per seed in `~/.claude/mods-data/brief/eval/samples/`; use `--resample` to redraw.
- Cost: about $0.02 per sample with fresh gold, $0.01 with cached gold. Replay total for the tuning so far: about $8.

## LiveEval results (2026-10-12)

`claude plugin eval <brief> --scaffold --allow-tools Write Edit --no-publish`: 5 cases, no Bash. With-only graders are indicators: they check that the brief tool was chosen and what it says. Both-arm graders check the final answer.

| Case | Brief tool chosen | Brief content right | Outcome, with / without |
|---|---|---|---|
| decision-needed | 3/3 | 3/3 ask names both key options | 3/3 / 3/3 |
| handoff-action | 3/3 | 3/3 ask hands over "put API_TOKEN in .env.local" | 3/3 / 3/3 |
| report-from-brief | 3/3 report tool read | n/a | 2/3 / 2/3 |
| no-false-asks | 3/3 | 1/1 empty asks* | 1/1* |
| long-run-status | 3/3 (5 calls over 4 phases) | 1/1 statuses track phases, last says done* | 1/1* |

\* The full run did not grant Write and Edit. Both cases' file graders failed in **both** arms, and the agent rightly asked for write access, so its asks weren't empty. Re-run once each with `--allow-tools Write Edit`: every grader passed. Write and Edit are gated tools in `plugin eval` and need the operator grant even when the case's `allowed_tools` names them.

- Selection: 15/15 with-arm runs called the brief tool. The `prompt.compose` sentence works, as run-ledger's eval predicted.
- Outcome delta is 0 on every case. The baseline already writes good final answers for tasks this short. What the mod adds is the band, which `-p` can't show; per EVAL-LEARNINGS #2, Δ=0 here is a case-design limit.
- Example statuses from a trace: "Phase 2/4: writing plan.md" … "Done: spec, plan, wc.ts, test-notes written (not run)".
- Cost: $6.37 live, about $8.50 replay, about $14.90 total.

## Fresh-context review (2026-10-12)

Blocking findings. Each fix has a test that fails on the pre-fix code and passes now (31/31):
1. A brief call mid-turn turned off the turn-end fallback for the whole turn. The rule asks for a call at every phase change, so a run that ended on "approve force-push?" after an earlier brief showed ✓ and no asks. Now any later main-loop tool call re-arms the fallback, so only a brief call that is the turn's last tool call covers the turn.
2. On /clear, a fallback still running finished and wrote the old conversation's asks under the new session id. Now session.end forgets the brief and turn ids and removes the file by `e.sessionId`.
3. `void fallback(...)` had no catch, so a rejected `$.model.complete` went unhandled. Now it is logged.

Non-blocking findings fixed as well:
- `/brief reset` now blocks an in-flight fallback.
- `/brief all` skips files that parse as JSON but have the wrong shape.
- Liveness is a 60 s heartbeat with a 5 min cutoff (was 12 h on brief time alone). The file carries `briefAt` for display.
- The session file is written at every turn end, so `isWorking` can't stick when the fallback is dropped.

Noted, not changed: while run-ledger and jobs are loaded beside brief, hook order decides which one answers `/ledger` and `/jobs`.

## Dogfood test (2026-10-12)

Setup: two worker sessions (`claude -p`, only `brief` loaded). The human read only `/brief all`.
- Round 1: each asks row matched the worker's "Blocked on me" item for item. The human answered from the brief alone, never the transcript, and round 2 cleared every ask.
- Gap: the brief dropped the worker's recommendation ("I'd go with timeoutMs"). The fix: the brief rule and the tool schema now ask for the recommended option first, marked (recommended). Re-run 2/2: `Pick timeout key name: timeoutMs (recommended) or requestTimeoutMs`.
- Not surfaced, left as is: an assumption the worker flagged (cacheTtl taken as seconds). Adding it would trade toward the false asks the replay eval penalised.
- Cost: $0.76.

## Stress scenarios (2026-10-12)

Five worker sessions (`claude -p`, only `brief` loaded). The human read only the brief view, then answered part of the open asks.

| Scenario | Brief (human view) | Verdict |
|---|---|---|
| s1: three tasks, one blocked | "mul + README done; license header blocked on missing text" + one ask | right |
| s2: pure question, no changes | "Answered: max total backoff wait is 6200 ms", no asks | right |
| s3: vague ("make it better") | picked a default, asked to confirm it + approve a test run | right (the test-run ask is a `-p` permission artifact) |
| s4: risky outward ask it can't do | "not a git repo" + ask: remote (recommended) or local-only delete | right |
| s5: 3 background subagents | showed ✓ while "waiting on 3 subagents" | **bug, fixed**: the glyph counts running background shells and agents as working |
| partial answers (s3, s1) | the answered ask dropped, the open one kept and narrowed ("due 2026-10-13", ".ts files only") | right |

The model called the brief tool in every scenario, 2–6 times each, so the fallback was never needed. Cost: $1.62.
