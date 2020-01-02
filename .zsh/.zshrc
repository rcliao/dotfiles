# Path to your oh-my-zsh installation.
export ZSH=~/.oh-my-zsh

# Zsh theme
ZSH_THEME=""

plugins=(
  vi-mode
)

source $ZSH/oh-my-zsh.sh

# Go Settings
export GOPATH="$HOME/dev/go"
export PATH=$PATH:$GOPATH/bin

export EDITOR=vim

# custom installed binary
export PATH=$PATH:~/bin

# Java & Gradle Settings
if [[ ! -a /usr/libexec/java_home ]]; then
    export JAVA_HOME=$(/usr/libexec/java_home)
fi

# fzf settings – enables fuzzy search with "**" like `nvim **`
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# for gpg
export GPG_TTY=$(tty)

# rust-lang cargo env
export PATH="$HOME/.cargo/bin:$PATH"

# aws CLI
export PATH=$PATH:~/.local/bin:~/Library/Python/3.7/bin

# use fd as default find command to traverse the file system while respecting .gitignore
export FZF_DEFAULT_COMMAND='fdfind --type f --hidden --follow --exclude .git'

# Load up ssh keys
ssh-add -A &> /dev/null

# jump for easier dir traversal
if [ -x "$(command -v jump)" ]; then
    eval "$(jump shell)"
fi

# tabtab source for serverless package
# uninstall by removing these lines or running `tabtab uninstall serverless`
[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh
# tabtab source for sls package
# uninstall by removing these lines or running `tabtab uninstall sls`
[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh
# tabtab source for slss package
# uninstall by removing these lines or running `tabtab uninstall slss`
[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/slss.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/slss.zsh

export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"
