set nocompatible              " be iMproved, required
filetype off                  " required
set autowrite

"" Vim default fuzzy-finder (:find)
set path+=**
set wildmenu

"" Quick bindings
map <leader>ts :%s/\s\+$//e<CR>

"" Freemarker to html
au BufRead,BufNewFile *.ftl set filetype=html

"" Vue
" Need to put this configuration here because vim-vue will overwrite it
au BufNewFile,BufRead *.vue setf vue

"" https://github.com/junegunn/vim-plug
call plug#begin('~/.local/share/nvim/plugged')

"" Common
Plug 'airblade/vim-gitgutter'
Plug 'bling/vim-airline'
Plug 'editorconfig/editorconfig-vim'
Plug 'honza/vim-snippets'
Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
Plug 'junegunn/fzf.vim'
Plug 'kshenoy/vim-signature'
Plug 'majutsushi/tagbar'
Plug 'mhinz/vim-grepper'
Plug 'morhetz/gruvbox'
Plug 'scrooloose/nerdtree'
Plug 'sirver/ultisnips'
Plug 'chriskempson/base16-vim'
Plug 'tpope/vim-fugitive'
Plug 'tpope/vim-surround'
Plug 'vim-airline/vim-airline-themes'
Plug 'w0rp/ale'
Plug 'wakatime/vim-wakatime'
"" Languages
Plug 'eagletmt/neco-ghc'
Plug 'fatih/vim-go', { 'do': ':GoInstallBinaries' }
Plug 'leafgarland/typescript-vim'
Plug 'mattn/emmet-vim'
Plug 'neovimhaskell/haskell-vim'
Plug 'othree/yajs.vim'
Plug 'pangloss/vim-javascript'
Plug 'posva/vim-vue'

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
set smartindent            " Indent smartly
set tabstop=4              " Set tab width to 4
set softtabstop=4          " Tab key indents by 4 spaces.
set shiftwidth=4           " >> indents by 4 spaces.
set shiftround             " >> indents to next multiple of 'shiftwidth'.

set ttyfast                " Faster redrawing.
set lazyredraw             " Only redraw when necessary.

" Change coloescheme conifiguration
let g:gruvbox_italic=1
colorscheme gruvbox
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
let g:airline_powerline_fonts = 1

"" NerdTree shortcut
map <leader>nn :NERDTreeToggle<CR>
map <leader>nf :NERDTreeFind<CR>

"" Ale (linter settings)
" JavaScript
let g:ale_linters = {
\   'javascript': ['eslint'],
\}

"" VIM-go settings
let g:go_highlight_functions = 1
let g:go_highlight_methods = 1
let g:go_highlight_fields = 1
let g:go_highlight_types = 1
let g:go_highlight_operators = 1
let g:go_highlight_build_constraints = 1
let g:go_fmt_command = "goimports"

"" Vim-signature
let g:SignatureMarkTextHLDynamic=1

"" Vim-JavaScript settings
let g:javascript_plugin_jsdoc = 1

"" Vim-FZF settings
map <c-p> :FZF<CR>
map <c-t> :BTags<CR>

"" GoTags configuration with Tagbar
let g:tagbar_type_go = {
    \ 'ctagstype' : 'go',
    \ 'kinds'     : [
        \ 'p:package',
        \ 'i:imports:1',
        \ 'c:constants',
        \ 'v:variables',
        \ 't:types',
        \ 'n:interfaces',
        \ 'w:fields',
        \ 'e:embedded',
        \ 'm:methods',
        \ 'r:constructor',
        \ 'f:functions'
    \ ],
    \ 'sro' : '.',
    \ 'kind2scope' : {
        \ 't' : 'ctype',
        \ 'n' : 'ntype'
    \ },
    \ 'scope2kind' : {
        \ 'ctype' : 't',
        \ 'ntype' : 'n'
    \ },
    \ 'ctagsbin'  : 'gotags',
    \ 'ctagsargs' : '-sort -silent'
\ }
