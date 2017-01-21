set nocompatible              " be iMproved, required
filetype off                  " required
set autowrite

au BufNewFile,BufRead *.vue setf vue

" https://github.com/junegunn/vim-plug
call plug#begin('~/.local/share/nvim/plugged')

Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins' }
Plug 'airblade/vim-gitgutter'
Plug 'bling/vim-airline'
Plug 'easymotion/vim-easymotion'
Plug 'benekastah/neomake'
Plug 'editorconfig/editorconfig-vim'
Plug 'fatih/vim-go', { 'do': ':GoInstallBinaries' }
Plug 'joshdick/onedark.vim'
Plug 'kien/ctrlp.vim'
Plug 'leafgarland/typescript-vim'
Plug 'mattn/emmet-vim'
Plug 'mhinz/vim-grepper'
Plug 'posva/vim-vue'
Plug 'scrooloose/nerdtree'
Plug 'vim-airline/vim-airline-themes'
Plug 'zchee/deoplete-go', { 'do': 'make' }

" Initialize plugin system
call plug#end()

" Change coloescheme conifiguration
colorscheme onedark
set background=dark

" Show invisibles
set list

" show line number
set relativenumber
set number

" show line width 80
set colorcolumn=80,120
au FileType gitcommit set cc=50,80

let mapleader = ","
let g:mapleader = ","

set splitbelow
set splitright

set tabstop=4
set shiftwidth=4

" For deoplete
let g:deoplete#enable_at_startup = 1

"Use 24-bit (true-color) mode in Vim/Neovim when outside tmux.
"If you're using tmux version 2.2 or later, you can remove the outermost $TMUX check and use tmux's 24-bit color support
"(see < http://sunaku.github.io/tmux-24bit-color.html#usage > for more information.)
if (empty($TMUX))
  if (has("nvim"))
    "For Neovim 0.1.3 and 0.1.4 < https://github.com/neovim/neovim/pull/2198 >
    let $NVIM_TUI_ENABLE_TRUE_COLOR=1
  endif
"For Neovim > 0.1.5 and Vim > patch 7.4.1799 < https://github.com/vim/vim/commit/61be73bb0f965a895bfb064ea3e55476ac175162 >
"Based on Vim patch 7.4.1770 (`guicolors` option) < https://github.com/vim/vim/commit/8a633e3427b47286869aa4b96f2bfc1fe65b25cd >
" < https://github.com/neovim/neovim/wiki/Following-HEAD#20160511 >
  if (has("termguicolors"))
    set termguicolors
  endif
endif


"" Airline settings
let g:airline_theme='onedark'
let g:airline_powerline_fonts = 1

"" NerdTree shortcut
map <leader>nn :NERDTreeToggle<cr>

"" Neomake settings
autocmd! BufWritePost,BufEnter * Neomake

" VueJS
let g:neomake_vue_eslint_maker = {
    \ 'args': ['--format', 'compact', '--plugin', 'vue'],
	\ 'errorformat': '%E%f: line %l\, col %c\, Error - %m,' .
	\ '%W%f: line %l\, col %c\, Warning - %m'
    \ }

" Javascript
let g:neomake_javascript_enabled_makers = ['eslint']
let g:neomake_auto_loc_list = 1
let g:neomake_go_enabled_makers = ['go', 'golint', 'errcheck']
" For Java gradle https://github.com/Scuilion/gradle-neomake-plugin
let g:neomake_java_enabled_makers=['javac']
let g:neomake_java_javac_config_file_enabled = 1

" VIM-go settings
let g:go_highlight_functions = 1
let g:go_highlight_methods = 1
let g:go_highlight_fields = 1
let g:go_highlight_types = 1
let g:go_highlight_operators = 1
let g:go_highlight_build_constraints = 1
let g:go_fmt_command = "goimports"

" CtrlP settings
let g:ctrlp_max_files=0
let g:ctrlp_max_depth=40
" Tell ctrlp to skip anything that is being ignored by git
let g:ctrlp_user_command = ['.git/', 'git --git-dir=%s/.git ls-files -oc --exclude-standard']

