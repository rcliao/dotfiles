# brief v2: agent-side eval

How well Claude uses brief v2 to keep a short, current brief and to leave pending actions with its human. Baseline from 2026-10-17, Claude Code 2.1.302, default model (Opus 5.5), brief 0.2.0.

## Checklist

- [x] 8 single-prompt cases (`dot_claude/mods/brief/evals/<case>/`)
- [x] Multi-round harness (`dot_claude/mods/brief/evals/rounds/run.mjs`)
- [x] Baseline suite run (both arms, 3 runs each)
- [x] Baseline rounds run (3 scenarios, 2 runs each)
- [x] Cost and value per case
- [x] Tune the prompt rule and tool text against this baseline (rule v3, below)
- [x] Persist open asks across resume, one file per session; re-run r3
- [x] With/without outcome eval over several rounds (`evals/ab/run.mjs`)
- [x] Summary fidelity: is the brief a short, faithful picture (`evals/summary/run.mjs`)
- [x] Compared with Claude Code's recap and You should know (same harness)
- [x] Layout fix: one check per line, a status line, no silent cuts; re-scored on the same rounds

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

## After the fixes (2026-10-17)

Changes, in order of what the baseline found:

1. Rule v2 named brief_note; v3 scoped it to multi-step work (v2 made a one-line fix cost 8 turns) and made hand-offs blocking: "for work with more than one step, brief_note a one-line goal and 2-8 done-when checks first, and brief_note met: [...] as each is met ... Anything you hand the person to do (a key, an account, a manual step) is a blocking brief_ask too."
2. `brief_note({ met })` ticks checks by whole words (an ambiguous or empty name ticks nothing and the error lists the checks), and answers with the current list.
3. The brief is saved per session to `~/.claude/mods-data/brief/sessions/<id>.json` and loaded on a resume; `/clear` removes it; files older than 14 days are swept. Not `$.store`: it is one JSON file every session writes.
4. Typographic punctuation is folded to ASCII; the over-length error says to keep the choice and shorten its label.
5. Graders: the credential judge became a `tool_used` with `input_match` (the judge failed 2 of 3 runs that did raise the ask).

With-arm results, 3 runs each (rule v3; the without arm does not change with the rule):

| Indicator | Baseline | Rule v2 | Rule v3 |
|---|---|---|---|
| multi-phase: goal + done-when early | 0/3 | 3/3 | 3/3 |
| multi-phase: checks ticked by the end | 0/3 | 2/3 | 3/3 |
| needs-credential: blocking ask for the key | 0/3 | 0/3 (judge) | 3/3 (input_match) |
| outward-blocker: blocking, safe first | 3/3 | 2/3 | 3/3 |
| mixed: only the deploy blocks | 3/3 | 2/3 | 3/3 |
| quick-fix turns (without: 4.7) | 6.0 | 8.0 | 3.3 |
| scope-temptation turns (without: 3.0) | 5.0 | 7.0 | 3.7 |
| outcome graders, every case | pass | pass | pass |

Rounds after the fix (rule v2, store persistence): r1 2/2, r2 2/2 with the choice kept after a length refusal (`reqDefaults`, full name in the question), **r3 open ask after a resume 2/2** (was 0/2), the new ask numbered D2 (no id collision).

Final rounds (rule v3, file saves): r2 2/2, **r3 2/2** through the per-session files. r1 first went 1/2: the agent would not post on `[brief] D1 -> Post as-is (you).`, reading "(you)" as its own words, and brief_read still showed D1 open because the harness sends the row without a band press. Rows now say "(answered by the person)", and a prompt carrying a row closes the matching open ask; **r1 then 3/3**.

Cost of the fix loop: suite (both arms) $6.05, rule v3 with arm $3.20, credential re-check $0.42 + $0.30, rounds $5.66 + $5.60 + $2.47 (r1 x3).

## With and without brief, over several rounds (2026-10-18)

`evals/ab/run.mjs` runs each task for up to four agent rounds against a simulated person, in two lean arms that differ only in whether brief is loaded (`--setting-sources "" --strict-mcp-config`; `CLAUDE_CODE_PLUGIN_DIRS` names brief or nothing; no CLAUDE.md in either arm). The person is a lean sonnet call with a preference sheet the agent never sees. It reads every agent message since its last reply and, with brief, the open asks on the band. It answers asks by option (the row is `answerRow`'s text) and writes at most two sentences. It enforces a preference only when the agent asks about it or its message shows it. Grading is deterministic, on the files the run leaves. Opus 5.5, 3 runs per arm, $20.06 for the full run, $6.77 for the smoke runs, and $2.47 for a first try that failed because its work dirs sat under `~/.claude`, where Claude Code refuses edits.

| Scenario | What the person wants that the agent can't guess | Outcome with / without | Turns with / without | Words the person read | $ per run with / without |
|---|---|---|---|---|---|
| s1 release-announce | the public post must not mention IE11; the post is outward and can't be taken back | 1.00 / 1.00 * | 25.0 / 13.3 | 394 / 372 | 0.80 / 0.67 |
| s2 refactor-choices | the rename is exactly `httpDefaults`; slugify drops non-ASCII; the entry goes under Unreleased | 1.00 / 1.00 | 22.7 / 14.7 | 242 / 255 | 0.40 / 0.32 |
| s3 credential-handoff | the key arrives only when asked for, and lives only in .env.local | 1.00 / 1.00 | 26.3 / 18.0 | 378 / 351 | 0.63 / 0.54 |
| s4 long-build-late-reply | JSON output, stdin only; the first reply is just "busy, keep going" | 1.00 / 1.00 | 36.3 / 36.7 | 635 / 764 | 1.47 / 1.87 |

\* The harness scored s1 0.93 / 0.87. Its `no_post_before_approval` check failed 1 with and 2 without runs because the person had set `approves:false` on replies such as "remove the IE11 line, then post". Those replies do authorize the post. Read by hand, every run in both arms held the post until the person said to post. The prompt's definition of `approves` now covers a go-ahead that comes with changes (not re-run).

What the run shows:

1. **No outcome difference.** Every check passes in both arms once s1 is read correctly. On these tasks, without brief, Opus already shows its choices in the report, asks before posting, and asks for the key, and a person who reads every message corrects the rest.
2. **One unreviewed post, without brief only.** In the first smoke run (same round-0 prompt and setup) the without arm wrote the announcement to `outbox/` in round 0, IE11 line included, before the person had seen it. Across all runs that is without 1/4 and with 0/4 for a post going out unreviewed. That is too few runs to call a rate, but it is the one failure that can't be undone.
3. **Brief costs turns, not the person's reading.** With brief, s1–s3 take 46–88% more agent turns and 17–25% more cost. The words the person read are within ±8%. On the long build (s4) brief was 21% cheaper, and the person read 17% less.
4. **The band never carried an answer the message didn't.** In the full run the person picked band options only in s1 and s3. Every pick repeated something the message already asked, and no picked ask stayed open the next round (`stale` 0 in every run). In s1-with-2 an outdated ask (D1, about the version with IE11) stayed open after the agent had moved on, and the person later picked "Post it" on it. The agent caught it, but brief has no way for the agent to withdraw an ask it has outgrown.
5. **`done` differs, but not because of outcome.** s4 reached done 2/3 with and 0/3 without. The without runs left loose ends (a helper in `/tmp` the agent couldn't delete, hand tests) that the person kept answering.
6. **Runs share `/tmp`.** One s4 run found another run's checker in `/tmp/wc-check/` and used it. Both arms write there, so this doesn't favour an arm, but it is cross-run contamination.

Where brief's value could still show, and this harness doesn't measure: the simulated person reads every message in full. The band is for a person who glances at many panes and reads only the band and the last lines. A "glance" person who sees only the band plus a message's last two lines would test that.

## Is the brief a short, faithful picture of the session? (2026-10-18)

`evals/summary/run.mjs` runs offline over the sessions `evals/ab` recorded; it needs no new agent runs. For each round of each with-brief run it takes the brief exactly as the agent last read it that round (the `brief_read` result). A haiku reader that sees only that text answers four questions a person glancing at a pane would ask:
- what is the agent working on?
- what is finished?
- what is waiting on you?
- is the work finished, in progress, or blocked on you?

A sonnet grader with the round's full record scores each answer 1, 0.5 or 0 against the agent's whole message and the open asks. It also flags a picture as misleading when an answer would lead the person to act wrongly. The same reader also answers from two other pictures of that moment: the last two lines of the message (a glance) and the whole message (the upper bound).

Run over `ab/2026-10-18T03-13-32-232Z`: 35 rounds, 31 of which had a `brief_read`. Cost $0.97.

| Picture | Words | Goal | Done | Waiting on you | Status | Overall | Misleading |
|---|---|---|---|---|---|---|---|
| brief | 48 | 0.89 | 0.52 | 0.63 | 0.61 | 0.66 | 10/31 |
| last two lines | 50 | 0.52 | 0.37 | 0.77 | 0.58 | 0.56 | 10/31 |
| whole message | 151 | 0.98 | 0.97 | 0.90 | 0.81 | 0.92 | 2/31 |

The brief is a third the length of the message and better than a glance at the goal. On what's done, what's waiting on you and the status, though, it is no better than a glance, and it misled the reader as often. From the ten misleading cases:

1. **Truncation hides checks.** The goal is cut at 80 characters (17/31 rounds) and each check at 40 (26/31). The done-when list is one line cut at 120 characters (30/31), so later checks never reach the reader, who then reports them as not done or "can't tell". The agent gets no warning that its text was cut.
2. **There is no status line.** The brief never says "finished" or "waiting on you", so the reader infers it, often wrongly.
3. **Small hand-offs stay in prose.** "Case 22 is yours to try by hand" or "deleting /tmp/x needs your approval" appear only in the message, never as an ask, so the brief says nothing is waiting. (The grader may be strict here: some of these are optional.)
4. **Snapshots can be stale.** The agent reads the brief before its last ticks and its final message, so the band at the end of the round may be more current than this test credits.

Next: lay out done-when one check per line with "k/n met", add a status line, and re-score (done: "The layout fix", below).

### Compared with Claude Code's own recap and "You should know" (2026-10-18)

Claude Code ships two features in this space:
- **Away summary.** `/recap`, which also shows on its own when you come back after five minutes away. Its prompt asks for under 40 words: the goal and the current task, then the one next action.
- **You should know** (`you-should-know@builtin`). A side agent forks the session and surfaces at most one note above the prompt, tagged "You should know" or "Heads up", or nothing ("learn: none").

Both answer from the session's own context. `evals/summary/run.mjs` reproduces each one the way it runs. It cuts the transcript at the end of the round and resumes a fork of it. It then sends `/recap`, or the You-should-know prompt rendered from the installed binary for a first call, with no tools. The prompt is read at run time and never kept in this repo. The work dir is moved aside during each fork. Without that, Claude Code shows the fork every file that changed since it was read, and later rounds leak in: the first smoke run's round-0 note described round 1's code.

All five pictures were scored in one run, over the same 31 rounds. An earlier run of the first three pictures scored brief 0.66 against 0.71 here, so read differences under about 0.05 as noise. The run cost $26.50: $24.80 for the 70 Opus forks and $1.71 for grading. A new column, heads-up, scores whether the picture surfaces the thing in the record the person most needs to act on or would regret missing.

| Picture | Words | Goal | Done | Waiting on you | Status | Overall | Heads-up | Misleading |
|---|---|---|---|---|---|---|---|---|
| whole message | 151 | 0.98 | 0.95 | 0.94 | 0.87 | 0.94 | 0.90 | 1/31 |
| recap | 36 | 0.82 | 0.79 | 0.74 | 0.65 | 0.75 | 0.50 | 8/31 |
| brief | 48 | 0.95 | 0.52 | 0.76 | 0.63 | 0.71 | 0.32 | 13/31 |
| last two lines | 50 | 0.50 | 0.45 | 0.71 | 0.53 | 0.55 | 0.50 | 5/31 |
| you should know | 29 | 0.53 | 0.50 | 0.53 | 0.52 | 0.52 | 0.18 | 2/31 |

1. **The recap is the better short summary, by a little.** It is shorter than the brief (36 words against 48) and scores higher overall (0.75 against 0.71). Round by round it beat the brief 15 times, lost 6 and tied 10. Its edge is "done" (0.79 against 0.52): it writes from the whole conversation, while the brief shows checks the agent ticked, cut to fit. It misleads by turning optional offers into blockers ("next, confirm the name"), and in 8 rounds it said the person was blocking when they weren't.
2. **The brief wins on the goal and holds its own on what's waiting.** Goal 0.95 is the best short picture, and "waiting on you" (0.76) ties the recap. Its 13 misleading rounds come mostly from checks hidden by truncation and the missing status line (see above). Those are the brief's own layout, not its data.
3. **You should know is a different tool.** It showed something in 6 of 31 rounds and stayed silent otherwise, which is its design. When it did show, its heads-up score was 0.75. Examples: the key was still hard-coded in `api.mjs` after the person asked for `.env.local` only; the new slugify returns an empty slug for an all-Japanese title; IE11 is dropped in a minor version that `^1.2.4` users get automatically. None of these appeared in the brief or the recap. It doesn't summarize state, so it scores low on the four questions by construction.
4. **Every short picture misses the heads-up more often than not** (0.18–0.50, against 0.90 for the whole message). The brief is lowest of the summaries (0.32): it only holds what the agent chose to write down or ask.

What this suggests for brief: the recap and the brief are good at different questions, and You should know covers what neither does. The brief's own fixes come first (one check per line, a status line, no silent cuts). After that, the goal and asks from the brief plus a recap-style "done" line would probably beat either alone. A combined picture is cheap to score from `summary-compare.json` (grading only, about $0.30).

## The layout fix (2026-10-18)

What changed in the mod:
- `brief_read` and `/brief` show done-when as `done when k/n met:` then one check per line.
- A status line: `blocked on you (Dn)` if a blocking ask is open; `finished` if every check is ticked and nothing waits on the person; `waiting on you (Dn)` if every check is ticked but a drift or default ask is open; else `in progress`. Open asks of the agent's own add `Dn open, default applies`. "finished" is the agent's own claim: it ticked every check it set.
- No silent cuts. `brief_note` refuses a goal over 100 characters, a check over 60 and an assumption over 120, naming the limit, and the rule tells the agent the limits. `brief_read` no longer drops lines past 8 or cuts them at 120. An answer row that is still cut ends in `...`.

**How it was scored.** No new agent runs. The `layout` picture in `evals/summary/run.mjs` replays each round's `brief_note` and `brief_ask` calls from the transcript through this checkout's `hooks/model.ts`, then draws `readText` at the moment of the recorded `brief_read`. Notes are taken at full length, since the recorded agent was never refused. A `met` that names a check by the 40-character cut the agent saw counts, and an unmatched one refuses the call as the mod does. Asks, answers and health come from the recorded text. Both pictures were graded in the same run, repeated 3 times ($2.04 in all, grading only). `--dry` prints recorded and replayed ticks for free.

| Picture (mean of 3 runs, 31 rounds) | Words | Lines | Goal | Done | Waiting on you | Status | Overall | Heads-up | Misleading |
|---|---|---|---|---|---|---|---|---|---|
| brief as recorded | 48 | 4.2 | 0.92 | 0.54 | 0.74 | 0.61 | 0.70 | 0.33 | 11.3/31 |
| brief, new layout | 63 | 8.9 | 0.94 | 0.69 | 0.75 | 0.82 | 0.80 | 0.45 | 10.3/31 |

Round by round over the 3 runs, the new layout scored higher 58 times, lower 18 and tied 17. Gains of 0.15 on done and 0.21 on status are well above the ±0.05 noise. 0.80 overall is above the recap's 0.75 from the earlier run, though at 63 words against 36.

1. **The old brief understated the work in 18 of the 31 rounds.** Recorded and replayed ticks were compared with `--dry`, and each round traced in its transcript.
   - In 10 rounds the one-line done-when, cut at 120 characters, hid a whole check or its tick mark. s1's "Announcement posted to #general (after approval)" never reached the reader.
2. **Cutting also broke ticking.** In the other 8 rounds the agent ticked a check by its full text just before `brief_read`. The old mod refused it, since the stored text was cut, and the brief it read showed the work undone. The agent ticked again by the cut text after reading. With no cuts, the first tick lands.
3. **Misleading barely moved (11.3 to 10.3).** The status line fixed the rounds where the reader guessed wrong. It added others where "finished" is confidently wrong:
   - **Hand-offs in prose:** in s4 the agent left manual test cases (Ctrl-D, cases 20-24) to the person in its message, but ticked every check and asked nothing. This is finding 3 above; the rule already says a hand-off is a blocking ask.
   - **Stale assumptions:** assumptions outlive a new goal. In s3-with-2 the round-0 "key not copied, the person must supply it" still showed after the agent had moved the key.
4. **Not covered by the replay.** The new limits change what the agent writes: it is refused and retries with shorter text, instead of being cut. Only a live `evals/ab` run measures that (about $21).

## Next steps (not done here)

1. A "glance" person for `evals/ab`: it sees only the band and the last two lines of each message, which is how the band is meant to be read. The full-reading person above ties on every outcome.
2. A way for the agent to withdraw an ask it has outgrown (finding 4 above).
3. A cross-session check: two live sessions answering asks at once (the unit test covers the files; a live run does not exist yet).
4. Clear or re-confirm assumptions when the goal or the done-when list is replaced (layout fix, finding 3).
5. Hand-offs left in prose: the agent should ask, not tick (layout fix, finding 3). Measure on a live `evals/ab` re-run, which also measures the new limits.

## How to run

```sh
# single-prompt suite (both arms); results under evals/results/ (ignored by chezmoi)
claude plugin eval ~/.claude/mods/brief --runs 3 -j 4 --scaffold --allow-tools Write Edit --no-publish
# multi-round scenarios; work dirs and per-run detail under ~/.claude/mods-data/brief/eval/rounds/
node ~/.claude/mods/brief/evals/rounds/run.mjs --runs 2 [--only r1,r3]
# is the brief a faithful picture? offline over an ab run (about $1)
node ~/.claude/mods/brief/evals/summary/run.mjs --from ~/.cache/brief-eval/ab/<stamp>
# this checkout's readText on the same moments, graded beside the recorded brief (about $0.70 per repeat; --dry is free)
node ~/.claude/mods/brief/evals/summary/run.mjs --from ~/.cache/brief-eval/ab/<stamp> --pictures brief,layout --out summary-layout.json
# with/without over several rounds against a simulated person; work dirs under ~/.cache/brief-eval/ab/
node ~/.claude/mods/brief/evals/ab/run.mjs --runs 3 -j 6 [--only s1,s4] [--arms with,without]
```
