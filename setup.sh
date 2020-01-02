#! /bin/bash

vimrc=~/dotfiles/.vim/.vimrc
vimrc_dest=~/.vimrc
tmux_conf=~/dotfiles/.tmux/.tmux.conf
tmux_conf_dest=~/.tmux.conf
zshrc=~/dotfiles/.zsh/.zshrc
zshrc_dest=~/.zshrc
yabairc=~/dotfiles/yabai/yabairc
yabairc_dest=~/.yabairc
skhdrc=~/dotfiles/chunkwm/.skhdrc
skhdrc_dest=~/.skhdrc
ranger_config=~/dotfiles/ranger
ranger_config_dest=~/.config/ranger
alacritty_config=~/dotfiles/alacritty/alacritty.yml
alacritty_config_dest=~/.config/alacritty/alacritty.yml
mpd_conf=~/dotfiles/mpd/mpd.conf
mpd_conf_dest=~/.mpd/mpd.conf
ncmpcpp_bindings=~/dotfiles/ncmpcpp/bindings
ncmpcpp_bindings_dest=~/.ncmpcpp/bindings
ncmpcpp_config=~/dotfiles/ncmpcpp/config
ncmpcpp_config_dest=~/.ncmpcpp/config

mkdir -p ~/.mpd && touch ~/.mpd/mpd{.db,.log,.pid,state}
echo "Setting up $vimrc => $vimrc_dest"
ln -sf $vimrc $vimrc_dest
echo "Setting up $tmux_conf => $tmux_conf_dest"
ln -sf $tmux_conf $tmux_conf_dest
echo "Setting up $zshrc => $zshrc_dest"
ln -sf $zshrc $zshrc_dest
echo "Setting up $yabairc => $yabairc_dest"
ln -sf $yabairc $yabairc_dest
echo "Setting up $skhdrc => $skhdrc_dest"
ln -sf $skhdrc $skhdrc_dest
echo "Setting up $ranger_config => $ranger_config_dest"
ln -sf $ranger_config $ranger_config_dest
echo "Setting up $alacritty_config => $alacritty_config_dest"
ln -sf $alacritty_config $alacritty_config_dest
echo "Setting up $mpd_conf => $mpd_conf_dest"
ln -sf $mpd_conf $mpd_conf_dest
echo "Setting up $ncmpcpp_bindings => $ncmpcpp_bindings_dest"
ln -sf $ncmpcpp_bindings $ncmpcpp_bindings_dest
echo "Setting up $ncmpcpp_config => $ncmpcpp_config_dest"
ln -sf $ncmpcpp_config $ncmpcpp_config_dest
