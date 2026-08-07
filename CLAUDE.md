# Working in this repo

This is a **chezmoi source directory**, not a normal project. Files here are
templates for `$HOME`; the thing you edit and the thing that runs are different
files. Most mistakes in this repo come from forgetting that.

Not to be confused with `dot_claude/CLAUDE.md`, which is the *global* Claude
instruction file this repo deploys to `~/.claude/CLAUDE.md`. This file is about
contributing here.

## Ground rules

**This repo is public.** Nothing employer-specific — no employer or internal
org names, private repo names, internal hostnames, or work email addresses.
Machine- and work-specific values go in `~/.config/chezmoi/chezmoi.toml`, which
is never committed; the work email there is the pattern to follow. Before
pushing anything under `dot_claude/`, grep the diff for the employer's domain
and org name. Do not write those literals into this file either.

**More than one machine writes here, and neither is automatically right.** A
commit from the other machine can be a downgrade on this one. Always
`chezmoi diff` before applying, and prefer `chezmoi apply ~/.specific-file` over
a bare apply.

**Never `chezmoi add` a file another tool owns.** herdr rewrites
`~/.claude/hooks/herdr-agent-state.sh` on every upgrade; plugin dirs and caches
regenerate themselves. `.chezmoiignore` lists every exclusion explicitly so a
broad `chezmoi add ~/.claude` cannot sweep one in — if you add a new exclusion,
add it there rather than relying on a glob.

## Naming

| Prefix / suffix | Effect on the target |
| --- | --- |
| `dot_foo` | `~/.foo` |
| `private_foo` | mode `0600` |
| `executable_foo` | mode `0755` |
| `foo.tmpl` | rendered as a Go template |
| `run_onchange_before_*` | script, runs before apply, re-runs when its content changes |
| `modify_foo` | script/template that *edits* the target instead of replacing it |

Type prefixes come first: `modify_private_settings.json`, not
`private_modify_...`. A mode-only difference still shows as `M` in
`chezmoi status`. That is not a bug.

Prefer `run_onchange_` over `run_once_`. `run_once_` keys on whether a given
script body has ever succeeded, so reverting a change is skipped as
already-seen content.

## settings.json is a `modify_` template, on purpose

`~/.claude/settings.json` is written by Claude Code as well as by us — it
reorders keys, records UI state, and registers plugins installed mid-session.
`dot_claude/modify_private_settings.json` therefore *merges* rather than
replaces: `mergeOverwrite` lets our keys win while every other key survives.
The managed content lives in `.chezmoitemplates/claude-settings.json`.

Three things to know before editing it:

- **No `.tmpl` suffix.** With one, chezmoi renders the template to produce a
  *script* and then executes it — you get `exec format error` on the JSON. The
  `chezmoi:modify-template` marker is what makes it a template.
- **`.chezmoi.stdin` is absent, not empty,** outside a real apply (`chezmoi cat`
  and `status` render without it). Test with `hasKey .chezmoi "stdin"`.
- **A merge can add and change keys but never remove one.** Dropping a key from
  the template leaves it on machines that already have it; delete it by hand.

This is also what keeps machine-local, work-only plugins working without their
names appearing in this public repo.

## Verify by applying, not by reading

CI does this on every push — `.github/workflows/chezmoi.yml` runs
`chezmoi init --apply` into a throwaway home on macOS and Ubuntu, for both
`ghost` states, then applies a second time to prove idempotence and checks that
the `modify_` merge still preserves untracked keys. If a change is worth making
it is worth letting that job run.

Locally, rendering a template proves nothing about whether a new machine works.
Run the real bootstrap into a throwaway destination:

```sh
T=$(mktemp -d); mkdir -p "$T/home" "$T/cfg"
printf '[data]\n  name = "Test"\n  email = "t@example.com"\n  ghost = false\n' > "$T/cfg/chezmoi.toml"
CM="chezmoi --config $T/cfg/chezmoi.toml --source $PWD --destination $T/home"
$CM init --apply --promptDefaults --exclude=scripts
$CM apply --exclude=scripts   # second run proves idempotence
[ "$($CM data | jq -r '.chezmoi.destDir')" = "$T/home" ] || echo "NOT confined!"
find "$T/home" -type f | sort
```

**Pass `--source` and `--destination` as flags, never as `sourceDir`/`destDir` in
the test config.** `chezmoi init` regenerates the config file from
`.chezmoi.toml.tmpl`, which emits only `[data]` — everything else in that file is
silently dropped. The next command then falls back to the real source directory
and **the real `$HOME`**, and quietly rewrites your actual dotfiles. This has
already happened once; it overwrote a git identity and a hand-kept ghostty
config. The `destDir` assertion above is cheap insurance.

Check both `ghost = true` and `ghost = false`, and that any JSON you generate is
still valid: `jq empty "$T/home/.claude/settings.json"`.

## Traps this repo has already hit

- **Files in the source root become targets.** `README.md` was being deployed to
  `~/README.md` for months. Anything here that is repo documentation, including
  this file, must be listed in `.chezmoiignore`.
- **`.chezmoidata.toml` is not in scope while `.chezmoi.toml.tmpl` renders.**
  Using `.email` as a prompt default there fails with `map has no entry for key`
  and breaks `chezmoi init` outright. Prompt defaults must be literals.
- **A failing `run_once_before_` script aborts the entire apply** before a single
  dotfile is written. Anything that can fail for environmental reasons — a
  package being unavailable, a tap being untrusted — must fail soft and report.
- **Hardcoded `/Users/rcliao` in a non-template file** silently does nothing on
  any other machine. Use `$HOME` in shell files, `{{ .chezmoi.homeDir }}` in
  templates.
- **`--promptString` does not satisfy `promptStringOnce`.** For a
  non-interactive test use `--promptDefaults`, or pre-seed `[data]` in the test
  config. Feeding a pty with `script` just hangs.
- **`chezmoi apply` wants a TTY** when a target changed since chezmoi last wrote
  it (`MM` status). Use `--force` in a non-interactive session.
- **A target path passed to `apply` is resolved against the real `destDir`,** not
  the one in `--config`. In a scratch-destination test, apply everything rather
  than naming a path, or it fails with "not in destination directory".
- **A script that reads a separate file needs that file's hash in its body,**
  otherwise its own contents never change and `run_onchange_` never fires:
  `# Brewfile hash: {{ include "Brewfile" | sha256sum }}`. And the file itself
  must be in `.chezmoiignore`, or it deploys to `$HOME`.

## Deciding where something belongs

- Same on every machine → track it here.
- Differs per machine → a value in `~/.config/chezmoi/chezmoi.toml`, referenced
  from a `.tmpl`.
- Optional per machine → a boolean flag, gated in both `.chezmoiignore` (so the
  files do not land) and the template that references them. `ghost` is the
  worked example.
- Installed by another tool → do not track; if a template must reference it,
  gate on `stat` so the reference only appears where the file exists. Gate on a
  flag instead when *chezmoi itself* writes the file, since a `stat` check would
  depend on file ordering within a single apply.

## Commits

Explain why the change was needed, not what it does — the diff shows what. State
what was verified. Keep unrelated changes in separate commits.
