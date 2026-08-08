# --- bootstrap -----------------------------------------------------------
# chezmoi manages this repo; a new machine needs it before anything else, so
# this entry is really a self-check rather than the install path.
brew "chezmoi"

# --- shell ---------------------------------------------------------------
brew "zsh"
brew "pure"
# jq backs the Claude Code status line; macOS ships one, but pin it anyway.
brew "jq"

# --- terminal multiplexers -----------------------------------------------
brew "tmux"
brew "zellij"
# agent-oriented multiplexer; ~/.config/herdr/config.toml is tracked here
brew "herdr"
# for tmux copy and paste
brew "reattach-to-user-namespace"

# --- editors -------------------------------------------------------------
brew "neovim"
brew "emacs"
# language spell checking
brew "ispell"

# --- command line productivity -------------------------------------------
# file finders
brew "fd"
brew "fzf"
brew "ripgrep"
# replacement for cat
brew "bat"
# markdown preview
brew "glow"
# jump / z written in Rust: https://github.com/ajeetdsouza/zoxide
brew "zoxide"
# terminal file browser
brew "yazi"
# terminal slides
brew "slides"
# terminal session recording
brew "asciinema"
brew "agg"

# --- git -----------------------------------------------------------------
brew "gh"
# .gitconfig sets delta as the pager for diff/log/show
brew "git-delta"

# --- languages and runtimes ----------------------------------------------
# Per-project runtime pinning. Several repos I work in commit a mise.toml or
# .tool-versions; without mise installed those pins are inert and everything
# silently builds against whatever version brew happens to have. The brew
# entries below stay as the global fallback — mise only takes over inside a
# directory that pins something.
brew "mise"
## JavaScript
brew "node"
brew "pnpm"
## Go
brew "go"
## Rust
brew "rust-analyzer"
## Python
brew "uv"
## Java — .zshrc puts /opt/homebrew/opt/openjdk/bin on PATH
brew "openjdk"
## Postgres client libs
brew "libpq"

# --- rpc / schemas -------------------------------------------------------
brew "grpc"
tap "bufbuild/buf"
brew "buf"

# --- infra and cloud -----------------------------------------------------
# HashiCorp's BUSL relicense got terraform removed from homebrew/core, so the
# bare name no longer resolves anywhere. It has to come from their own tap.
# This matters more than a missing package usually would: `brew bundle` resolves
# the whole file before installing anything, so one unresolvable name installs
# NOTHING — a bare `brew "terraform"` silently cost a machine all 16 packages.
#
# Two manual steps a fresh machine still needs, neither of which this file can
# do for you:
#   1. `brew trust --formula hashicorp/tap/terraform`. Tap trust applies to
#      formulae, not just casks — see the aerospace note below. Untrusted tap
#      entries are ignored rather than installed.
#   2. Current Xcode Command Line Tools. This tap ships no bottles, so terraform
#      is compiled from source and a stale CLT fails the build.
# `brew "opentofu"` from homebrew/core is bottled and needs neither, if the
# HashiCorp-specific bits are ever not required.
tap "hashicorp/tap"
brew "hashicorp/tap/terraform"
brew "kubernetes-cli"
brew "kustomize"
brew "k9s"
brew "sops"
brew "aws-vault"
brew "doppler"
brew "cloudflared"
brew "render"
brew "go-task"
# run GitHub Actions locally
brew "act"
# load testing
brew "k6"

# --- data ----------------------------------------------------------------
brew "duckdb"
brew "redis"
# diagrams as code
brew "d2"

# --- media / misc --------------------------------------------------------
brew "ffmpeg"
brew "poppler"
brew "watchman"
brew "yt-dlp"

# --- casks ---------------------------------------------------------------
cask "ghostty"
cask "alacritty"
cask "1password-cli"
# The Standalone variant, which is the one Tailscale recommends: it ships
# security fixes without waiting on App Store review, and unlike the App Store
# build it supports Funnel, full exit nodes and Tailscale SSH.
#
# Deliberately NOT alongside `brew "tailscale"`. That formula is the third
# variant (tailscaled, CLI-only, unsandboxed), and Tailscale's docs are explicit
# that two variants must not run on one machine — the extension fails to launch.
# Having both listed here left a machine with the App Store app serving the
# tailnet, an erroring homebrew.mxcl.tailscale launch agent, and a CLI one
# version ahead of the daemon it was talking to.
cask "tailscale-app"
cask "mitmproxy"
# experimenting with aerospace as tile manager instead
# brew "koekeishiya/formulae/yabai"
# brew "koekeishiya/formulae/skhd"
