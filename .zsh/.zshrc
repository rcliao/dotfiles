# Path to your oh-my-zsh installation.
export ZSH=~/.oh-my-zsh

# Zsh theme
ZSH_THEME=""

plugins=(
  vi-mode
)

source $ZSH/oh-my-zsh.sh

# npm i -g pure-prompt
PURE_GIT_PULL=0
autoload -U promptinit; promptinit
prompt pure

# Go Settings
export GOPATH="$HOME/dev/go"
export PATH=$PATH:$GOPATH/bin

# Java & Gradle Settings
if [[ ! -a /usr/libexec/java_home ]]; then
    export JAVA_HOME=$(/usr/libexec/java_home)
    export PATH=$PATH:~/.local/bin
fi

# fzf settings – enables fuzzy search with "**" like `nvim **`
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# Use nvim if local env and vim for ssh connection
if [[ -n $SSH_CONNECTION ]]; then
  export EDITOR='vim'
else
  export EDITOR='nvim'
fi

# for gpg
export GPG_TTY=$(tty)

# rust-lang cargo env
export PATH="$HOME/.cargo/bin:$PATH"

# use fd as default find command to traverse the file system while respecting .gitignore
export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'

# Load up ssh keys
ssh-add -A &> /dev/null

# jump for easier dir traversal
eval "$(jump shell)"
