set nocompatible              " be iMproved, required
filetype off                  " required
set autowrite

"" Freemarker
au BufRead,BufNewFile *.ftl set filetype=html

"" Vue
" Need to put this configuration here because vim-vue will overwrite it
au BufNewFile,BufRead *.vue setf vue

"" https://github.com/junegunn/vim-plug
call plug#begin('~/.local/share/nvim/plugged')

Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins' }
Plug 'airblade/vim-gitgutter'
Plug 'bling/vim-airline'
Plug 'easymotion/vim-easymotion'
Plug 'editorconfig/editorconfig-vim'
Plug 'fatih/vim-go', { 'do': ':GoInstallBinaries' }
Plug 'joshdick/onedark.vim'
Plug 'kien/ctrlp.vim'
Plug 'kshenoy/vim-signature'
Plug 'leafgarland/typescript-vim'
Plug 'majutsushi/tagbar'
Plug 'mattn/emmet-vim'
Plug 'mhinz/vim-grepper'
Plug 'posva/vim-vue'
Plug 'scrooloose/nerdtree'
Plug 'scrooloose/syntastic'
Plug 'vim-airline/vim-airline-themes'
Plug 'wakatime/vim-wakatime'
Plug 'zchee/deoplete-go', { 'do': 'make' }

"" Initialize plugin system
call plug#end()

"" General Settings
" Show invisibles
set list

" show line number
set relativenumber
set number

" show line width 80
set colorcolumn=80,120
au FileType gitcommit set cc=50,80

let mapleader = " "
let g:mapleader = " "

set splitbelow
set splitright

set autoindent             " Indent according to previous line.
set tabstop=4              " Set tab width to 4
set softtabstop=4          " Tab key indents by 4 spaces.
set shiftwidth=4           " >> indents by 4 spaces.
set shiftround             " >> indents to next multiple of 'shiftwidth'.

set ttyfast                " Faster redrawing.
set lazyredraw             " Only redraw when necessary.

"" Deoplete
let g:deoplete#enable_at_startup = 1

" Change coloescheme conifiguration
colorscheme onedark
set background=dark

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

" Change cursor shape between insert and normal mode in neovim
if (has("nvim"))
  let $NVIM_TUI_ENABLE_CURSOR_SHAPE=2
endif

"" Airline settings
let g:airline_theme='onedark'
let g:airline_powerline_fonts = 1

"" NerdTree shortcut
map <leader>nn :NERDTreeToggle<cr>

"" Syntastic
set statusline+=%#warningmsg#
set statusline+=%{SyntasticStatuslineFlag()}
set statusline+=%*
let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 1
let g:syntastic_check_on_open = 0
let g:syntastic_check_on_wq = 0
" Javascript
let g:syntastic_javascript_checkers = ['eslint']
let g:syntastic_auto_loc_list = 1
" GoLang
let g:syntastic_go_makers = ['go', 'golint', 'errcheck']
" For Java gradle https://github.com/Scuilion/gradle-syntastic-plugin
let g:syntastic_java_makers=['javac']
let g:syntastic_java_javac_config_file_enabled = 1

"" VIM-go settings
let g:go_highlight_functions = 1
let g:go_highlight_methods = 1
let g:go_highlight_fields = 1
let g:go_highlight_types = 1
let g:go_highlight_operators = 1
let g:go_highlight_build_constraints = 1
let g:go_fmt_command = "goimports"

"" CtrlP settings
let g:ctrlp_max_files=0
let g:ctrlp_max_depth=40
" Tell ctrlp to skip anything that is being ignored by git
let g:ctrlp_user_command = ['.git/', 'git --git-dir=%s/.git ls-files -oc --exclude-standard']

