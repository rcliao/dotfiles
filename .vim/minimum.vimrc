" Minimum Vimrc file without any plugin
syntax enable
filetype plugin indent on

" To get Vim default "fuzzy-finder" finding files (:find)
set path+=**
set wildmenu

" backspace behavior
set backspace=indent,eol,start

" To avoid buffer needing to write to disk when abandoned
set hidden

" Enable foldable
set foldenable
set foldmethod=indent
set foldlevel=2

" searches
set incsearch
set hlsearch

" Show invisibles
set list
set listchars=tab:>\ ,trail:-,extends:>,precedes:<,nbsp:+

" More expected split pane behavior
set splitbelow
set splitright

" Netrw - vim built-in file explorer
let g:netrw_banner = 0

" Indentation settings
set tabstop=4              " Set tab width to 4
set softtabstop=4          " Tab key indents by 4 spaces.
set shiftwidth=4           " >> indents by 4 spaces.

" To set space key as leader
let g:mapleader=' '

" quick jump through buffer
nmap <leader>b :ls<CR>:buffer<SPACE>
" switch to last buffer
nmap <leader>q :b#<cr>

" shortcuts for folding levels
nmap <leader>z0 :set foldlevel=0<CR>
nmap <leader>z1 :set foldlevel=1<CR>
nmap <leader>z2 :set foldlevel=2<CR>
nmap <leader>z3 :set foldlevel=3<CR>
