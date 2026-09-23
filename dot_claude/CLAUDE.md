## Critical Thinking

Push back if a task, plan, or proposed change does not make sense. Ask clarifying questions, flag risks, and suggest alternatives before proceeding. Do not blindly execute — if something seems wrong, over-engineered, or contradictory, say so. Do this at the plan stage; once scope is agreed, don't re-ask mid-run.

## Plan & Scope

- For multi-file, unfamiliar, or architecturally-uncertain changes: propose a short plan and confirm scope BEFORE writing code. Skip this only when the diff fits in one sentence.
- If I didn't say what "done" looks like, propose the finish line in the plan (e.g. "tests pass", "every endpoint migrated"). After that, the finish line is the stop condition.
- For substantial design work, use the `tech-design` skill (the design one-pager: Intent, Components, Data flow, Data model, Interfaces, Plan, backed by an Evidence appendix) rather than ad-hoc planning.
- State what's out of scope, and end the plan with how it'll be verified.
- Work one feature/unit at a time; don't batch unrelated changes. (Fanning the *same* change out across many units via subagents is fine — see Long Runs.)

## Long Runs: When to Stop

Once scope is agreed, run to the finish line. Default is keep going.
- When a step doesn't need my input, keep going. Put status notes in the same message as your next action, not in a separate turn — I scan many panes at once.
- Don't stop to ask "should I continue?", to report partial progress, or to offer options you could pick between with a sensible default. Pick one, note it, move on.
- Stop and ask only when (a) you can't continue without a decision, credential, or access only I have, or (b) the next action is destructive or outward-facing:
  - deleting data, force-pushing, rewriting shared history, pushing to main
  - writing to prod or shared infra (deploys, migrations, prod DB/BigQuery writes)
  - switching branches in a shared checkout — use a `.worktrees/<name>` worktree instead
  - changing anything outside the current repo/worktree
  - posting externally (Slack, Linear, PR comments) or spending money (paid APIs)
- The auto-mode permission rules in settings.json stay the hard gate; this section only governs when you pause on your own.
- If the same failure repeats 3 times, stop looping: say what you tried and propose a different approach.
- For multi-step work, keep a checklist at the top of the findings markdown file (see Evidence & Context) and tick it off as you go — it survives context summarization.
- For audits, migrations, or wide reviews, give each unit its own subagent. Check a subagent's evidence before accepting its result.

## Technical Design

When explaining architecture or proposing changes, focus on:
1. **Data flow** — Use domain storytelling: describe who does what, with what data, in what sequence. Name the actors, actions, and work objects.
2. **Data model** — Show the entities, their relationships, and key fields. Call out what changes.
3. **Interface changes** — List new/modified public APIs, CLI commands, function signatures, or protocol changes.

## UI & Visual Design

Aim for minimal and plain, the opposite of a generated-looking page. Defaults: system sans or one typeface, black/white/gray plus at most one accent color, 0–4px corner radius, hairline rules and whitespace instead of cards, tables over card grids, text links and plain rectangular buttons.

Avoid these AI-default tells unless I ask for them:
- pill-shaped buttons, status badges, tags, or chips
- gradients (purple/indigo/blue especially), gradient text, glow, glassmorphism
- cream/beige backgrounds, italic serif accent words in headings
- numbered section labels ("01 —"), uppercase letter-spaced eyebrow text, monospace used as decoration
- rounded cards with soft drop shadows, icon-in-a-colored-circle feature grids, three-card rows
- emoji or sparkle icons in headings and buttons, colored left-border callout boxes

## Documentation First

- Write or update documentation before (or alongside) code changes. Docs live in the `docs/` folder of the repo.
- Keep `docs/ARCHITECTURE.md` up to date so it always reflects the high-level architecture of the repo.
- When a task changes architecture, data model, or public interfaces, update ARCHITECTURE.md as part of the task.

## Verification

The loop is: gather context → act → verify → repeat. Verification is not optional.
- Establish a clean baseline FIRST: on existing code, run the build/tests before changing anything.
- Show evidence, don't assert success: paste the command + its output (test result, exit code, screenshot). If you can't verify it, don't claim it's done.
- Verify STATE before raising an alarm or applying a fix: confirm merge/deploy status, which file/worktree copy you're editing, and the actual diff scope. Don't conclude root cause from a single signal — one source is a hypothesis, not a conclusion.
- For non-trivial changes, have a fresh context (subagent or new session) review the diff against the plan before I review it. List only problems you'd block the merge for; for each, give file:line, why it's wrong, and how to show it fails. No style nits.
- Run e2e tests if they exist; suggest adding them if the change is non-trivial. Do not mark work done without verifying it works.
- For long docs (designs, reports, plans), check internal consistency before handing off: dates vs weekdays, numbers vs charts/tables, cross-references between sections.

## Evidence & Context

- Ground conclusions in real backend/prod data (logs, PostHog, GCP/CLI, on-chain) before concluding. Prefer reversible/safe changes for any prod write.
- Mark anything you couldn't confirm, and say where you looked.
- Prefer agentic search (grep/glob/git/CLI) and just-in-time reads over dumping large context.
- Delegate wide investigations to subagents; keep only their findings, not raw file dumps.
- On long investigations, stream detailed findings to a markdown file as you go and keep chat replies to short progress summaries — so nothing is lost if the session dies.

## Reporting

End every run with three headings, in this order:
- **Blocked on me** — decisions, approvals, or access you need (write "nothing" if none)
- **Changed** — what you changed, with evidence it works
- **Found** — anything notable you discovered but didn't act on

## Ghost Memory (MCP)

You have a persistent memory system via Ghost MCP tools. This is how you learn across sessions. **Use it.**

**MUST: retrieve before working.** Before any non-trivial task, call `ghost_context(query="<task>", ns="agent:claude-code", budget=2000)`. Trigger on: debugging an error, working in an unfamiliar repo/service, making architecture/design decisions, or any "I might have seen this before." Do NOT skip — one tool call avoids repeated mistakes.

**Write after the task** when you learn something worth keeping (debugging insight, design decision, user correction, convention, costly gotcha). For the mechanics of writing, linking, consolidating, curating, and reflecting — and when `ghost_context` returns `compaction_suggested: true` — use the `ghost-memory` skill.

## Environment Gotchas

- Git diffs and logs already page through `delta`; piping them again mangles the output.
- The `git stat` / `files` / `review` aliases need `$REVIEW_BASE` set, and fail unhelpfully without it.
- `push.default = current` and `push.autoSetupRemote = true`, so a first push on a new branch needs no `-u`.
- `merge.conflictStyle = zdiff3` and `rerere.autoUpdate` are on — conflict markers include the common ancestor, and repeated resolutions replay automatically.
- Dotfiles are managed by chezmoi (source: `~/.local/share/chezmoi`, repo `rcliao/dotfiles`). Edit the source and `chezmoi apply`, or `chezmoi add` after editing in place — a bare edit to `~/.zshrc` will be reported as drift.
- Per-machine values (like git email) live in `~/.config/chezmoi/chezmoi.toml`, which is deliberately **not** in the repo.

## Preferences

- Editor is `nvim`.
- Back up a file before rewriting or deleting it.
