#! /bin/bash

vimrc=~/dotfiles/.vim/.vimrc
vimrc_dest=~/.config/nvim/init.vim
tmux_conf=~/dotfiles/.tmux/.tmux.conf
tmux_conf_dest=~/.tmux.conf
zshrc=~/dotfiles/.zsh/.zshrc
zshrc_dest=~/.zshrc

echo "Setting up $vimrc => $vimrc_dest"
ln -sf $vimrc $vimrc_dest
echo "Setting up $tmux_conf => $tmux_conf_dest"
ln -sf $tmux_conf $tmux_conf_dest
echo "Setting up $zshrc => $zshrc_dest"
ln -sf $zshrc $zshrc_dest
