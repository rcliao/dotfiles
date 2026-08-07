# Eric's Dotfiles

Managed with [chezmoi](https://github.com/twpayne/chezmoi). Shell, terminals,
editors, git, and the Claude Code setup I actually work in.

## Set up a new machine

```sh
brew install chezmoi
chezmoi init --apply rcliao
```

That prompts for three things and writes them to
`~/.config/chezmoi/chezmoi.toml`, which stays **local to the machine** and is
never committed:

| Prompt | Why it is per-machine |
| --- | --- |
| Full name | git author name |
| Git email | so a work laptop and a personal box can share this repo without cross-signing commits |
| Ghost hooks | see [Ghost](#ghost-memory-hooks-opt-in) below |

Re-running `chezmoi init` later is non-interactive — it keeps whatever is
already set. To change an answer, edit `~/.config/chezmoi/chezmoi.toml` and
`chezmoi apply`. For an unattended install, `chezmoi init --apply --promptDefaults`
takes the personal identity with Ghost off.

The first apply runs `brew bundle` for everything below. A package failure
warns rather than aborting, so the dotfiles land either way.

## Day to day

```sh
chezmoi diff                 # what would change
chezmoi apply                # everything
chezmoi apply ~/.zshrc       # just one target
chezmoi add ~/.tmux.conf     # pull a local edit back into the repo
chezmoi update               # git pull + apply
```

This repo is edited from more than one machine, so **read `chezmoi diff` before
applying**. Whichever machine committed last is not automatically the machine
that is more correct.

## What is in here

**Shell** — `.zshrc` (zsh, [pure](https://github.com/sindresorhus/pure) prompt,
shared history across panes, cached `compinit`), `.gitconfig`
(delta pager, `zdiff3` conflicts, `rerere`, auto-set upstream on push),
`.config/git/ignore`, `.ssh/config` (keychain-backed agent loading — this is what
replaces the `ssh-add -A` that used to run on every shell start).

**Terminals** — [ghostty](https://ghostty.org) (primary), alacritty.

**Multiplexers** — [herdr](https://herdr.dev) (primary, keys mapped to match
tmux muscle memory), tmux, zellij.

**Editors** — neovim, emacs.

**Runtimes** — [mise](https://mise.jdx.dev), activated at the end of `.zshrc` so
it wins over the PATH exports above it. Homebrew still provides the global node,
go, and python; mise only takes over inside a directory that pins a version in
`mise.toml` or `.tool-versions`.

**Window management** — [aerospace](https://github.com/nikitabobko/AeroSpace),
plus a leftover `.yabairc`.

**Claude Code** — `CLAUDE.md`, `settings.json`, and the hook scripts under
`.claude/hooks`. `settings.json` is a template: hooks belonging to tools that
may not be installed (herdr, Zero) are only wired in when their script is
actually present, so a machine never ends up pointing at a hook that does not
exist.

**Other** — bat, yazi.

### Ghost memory hooks (opt-in)

The `ghost-*` hooks drive the [Ghost](https://github.com/rcliao/ghost) MCP
memory server. A machine without Ghost has no use for them, so they are off by
default: neither the scripts nor their `settings.json` entries are installed.

To turn them on, set `ghost = true` in `~/.config/chezmoi/chezmoi.toml` and
`chezmoi apply`. To turn them off again, flip it back and apply.

### aerospace

Homebrew refuses casks from untrusted taps, and trusting one is a decision
worth making deliberately, so the bundle does not install aerospace:

```sh
brew trust nikitabobko/tap
brew install --cask nikitabobko/tap/aerospace
```

## What is deliberately not tracked

Anything regenerated, tool-managed, or machine-specific — Claude Code session
transcripts and caches, plugin directories, herdr's own integration hook, and
`~/.config/chezmoi/chezmoi.toml` itself. See `.chezmoiignore`, which lists each
exclusion explicitly so `chezmoi add ~/.claude` can never sweep one in.

This repo is public, so nothing employer-specific goes in it.
