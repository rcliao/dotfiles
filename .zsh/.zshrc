# Path to your oh-my-zsh installation.
export ZSH=~/.oh-my-zsh

# Zsh theme
ZSH_THEME="ys"

source $ZSH/oh-my-zsh.sh

# for Vimr under bin folder
export PATH=$PATH:~/bin

# Go Settings
export GOPATH="~/dev/go"
export PATH=$PATH:$GOPATH/bin

# Java & Gradle Settings
if [[ ! -a ~/usr/libexec/java_home ]]; then
    export JAVA_HOME=$(/usr/libexec/java_home)
    export PATH=$PATH:~/.local/bin
fi

# fzf settings
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# Use nvim if local env and vim for ssh connection
if [[ -n $SSH_CONNECTION ]]; then
  export EDITOR='vim'
else
  export EDITOR='nvim'
fi

# for gpg
export GPG_TTY=$(tty)
export GPG_TTY

# Gruvbox colorscheme
source  ~/.local/share/nvim/plugged/gruvbox/gruvbox_256palette.sh

# rust-lang cargo env
export PATH="$HOME/.cargo/bin:$PATH"

# RipGrep settings
# --files: List files that would be searched but do not search
# --no-ignore: Do not respect .gitignore, etc...
# --hidden: Search hidden files and folders
# --follow: Follow symlinks
# --glob: Additional conditions for search (in this case ignore everything in the .git/ folder)
export FZF_DEFAULT_COMMAND='rg --files --no-ignore --hidden --follow --glob "!.git/*"'
