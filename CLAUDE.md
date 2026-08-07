# Working in this repo

This is a **chezmoi source directory**, not a normal project. Files here are
templates for `$HOME`; the thing you edit and the thing that runs are different
files. Most mistakes in this repo come from forgetting that.

Not to be confused with `dot_claude/CLAUDE.md`, which is the *global* Claude
instruction file this repo deploys to `~/.claude/CLAUDE.md`. This file is about
contributing here.

## Ground rules

**This repo is public.** Nothing employer-specific — no `piedotorg`, `pie.org`,
internal hostnames, or private repo names. Machine- or work-specific values go
in `~/.config/chezmoi/chezmoi.toml`, which is never committed. Grep before you
push anything under `dot_claude/`.

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
| `run_once_before_*` | script, runs before apply, re-runs when its content changes |

A mode-only difference still shows as `M` in `chezmoi status`. That is not a bug.

## Verify by applying, not by reading

Rendering a template proves nothing about whether a new machine works. Run the
real bootstrap into a throwaway destination:

```sh
T=$(mktemp -d); mkdir -p "$T/home" "$T/cfg"
cp -R ~/.local/share/chezmoi "$T/src"; rm -rf "$T/src/.git"
printf 'sourceDir = "%s/src"\ndestDir = "%s/home"\n' "$T" "$T" > "$T/cfg/chezmoi.toml"
chezmoi --config "$T/cfg/chezmoi.toml" init --apply --promptDefaults
find "$T/home" -type f | sort
```

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
