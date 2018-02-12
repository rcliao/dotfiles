#! /bin/bash

vimrc=~/dotfiles/.vim/.vimrc
vimrc_dest=~/.config/nvim/init.vim
tmux_conf=~/dotfiles/.tmux/.tmux.conf
tmux_conf_dest=~/.tmux.conf
zshrc=~/dotfiles/.zsh/.zshrc
zshrc_dest=~/.zshrc
chunkwmrc=~/dotfiles/chunkwm/.chunkwmrc
chunkwmrc_dest=~/.chunkwmrc
skhdrc=~/dotfiles/chunkwm/.skhdrc
skhdrc_dest=~/.skhdrc

echo "Setting up $vimrc => $vimrc_dest"
ln -sf $vimrc $vimrc_dest
echo "Setting up $tmux_conf => $tmux_conf_dest"
ln -sf $tmux_conf $tmux_conf_dest
echo "Setting up $zshrc => $zshrc_dest"
ln -sf $zshrc $zshrc_dest
echo "Setting up $chunkwmrc => $chunkwmrc_dest"
ln -sf $chunkwmrc $chunkwmrc_dest
echo "Setting up $skhdrc => $skhdrc_dest"
ln -sf $skhdrc $skhdrc_dest
