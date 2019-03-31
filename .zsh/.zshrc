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
PROMPT='%(1j.[%j] .)%(?.%F{magenta}.%F{red})${PURE_PROMPT_SYMBOL:-❯}%f '

# Go Settings
export GOPATH="$HOME/dev/go"
export PATH=$PATH:$GOPATH/bin

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
export FZF_DEFAULT_COMMAND='fd --type f --hidden --follow --exclude .git'

# Load up ssh keys
ssh-add -A &> /dev/null

# jump for easier dir traversal
if [ -x "$(command -v jump)" ]; then
    eval "$(jump shell)"
fi

export NVM_DIR="$HOME/.nvm"
[ -s "/usr/local/opt/nvm/nvm.sh" ] && . "/usr/local/opt/nvm/nvm.sh"  # This loads nvm
[ -s "/usr/local/opt/nvm/etc/bash_completion" ] && . "/usr/local/opt/nvm/etc/bash_completion"  # This loads nvm bash_completion

# tabtab source for serverless package
# uninstall by removing these lines or running `tabtab uninstall serverless`
[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh
# tabtab source for sls package
# uninstall by removing these lines or running `tabtab uninstall sls`
[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh
# tabtab source for slss package
# uninstall by removing these lines or running `tabtab uninstall slss`
[[ -f /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/slss.zsh ]] && . /usr/local/lib/node_modules/serverless/node_modules/tabtab/.completions/slss.zsh
