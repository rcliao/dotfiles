# Dotfiles

My personal dotfiles containing configurations for NeoVim, Tmux and Zshrc.

## Get started

### Runtime Dependencies

* Install NeoVim – https://github.com/neovim/neovim/wiki/Installing-Neovim
    * Install Vim-Plug – https://github.com/junegunn/vim-plug
* Install Oh My Zsh – https://github.com/robbyrussell/oh-my-zsh
    * Install spaceship-primpt – https://github.com/denysdovhan/spaceship-prompt
* Install Tmux – https://github.com/tmux/tmux

### Optional Dependencies

* Install RipGrep – https://github.com/BurntSushi/ripgrep
* Install fd – https://github.com/sharkdp/fd
* Install fzf – https://github.com/junegunn/fzf

### OSX Window Manager

* Install Chunkwm – https://github.com/koekeishiya/chunkwm

### Custom Firefox Theme

* Find "Profile folder" under Application data for Firefox and place `chrome/userChrome.css` under the "Profile folder".
* Install https://addons.mozilla.org/en-US/firefox/addon/tree-style-tab/
    * Copy the firefox/treetabs/style.css content over as custom CSS
    * In appearance, select "No Decoration"

### Set up

Run `setup.sh` to set up all the soft linking files at the right place. And you
are ready to go!
