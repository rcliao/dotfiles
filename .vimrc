set nocompatible              " be iMproved, required
filetype off                  " required
set autowrite

call plug#begin('~/.local/share/nvim/plugged')

Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins' }
Plug 'zchee/deoplete-go', { 'do': 'make'}
Plug 'airblade/vim-gitgutter'
Plug 'bling/vim-airline'
Plug 'editorconfig/editorconfig-vim'
Plug 'fatih/vim-go', { 'do': ':GoInstallBinaries' }
Plug 'joshdick/onedark.vim'
Plug 'kien/ctrlp.vim'
Plug 'leafgarland/typescript-vim'
Plug 'mattn/emmet-vim'
Plug 'mhinz/vim-grepper'
Plug 'posva/vim-vue'
Plug 'scrooloose/nerdtree'
Plug 'scrooloose/syntastic'
Plug 'vim-airline/vim-airline-themes'

" Initialize plugin system
call plug#end()

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

" Change coloescheme conifiguration
colorscheme onedark
set background=dark

" Show invisibles
set list

let g:airline_theme='onedark'
let g:airline_powerline_fonts = 1

" Syntastic settings
set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*

let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0

" Javascript
let g:syntastic_javascript_checkers = ['eslint']

let g:syntastic_auto_loc_list = 1
let g:syntastic_go_checkers = ['go', 'golint', 'errcheck']

" VIM-go settings
let g:go_highlight_functions = 1
let g:go_highlight_methods = 1
let g:go_highlight_fields = 1
let g:go_highlight_types = 1
let g:go_highlight_operators = 1
let g:go_highlight_build_constraints = 1

let g:go_fmt_command = "goimports"

" show line number
set relativenumber
set number

" show line width 80
set colorcolumn=80,120
au FileType gitcommit set cc=50

let mapleader = ","
let g:mapleader = ","

map <leader>nn :NERDTreeToggle<cr>

tnoremap <Esc> <C-\><C-n>
set splitbelow
set splitright
