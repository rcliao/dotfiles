" Minimum Vimrc file without any plugin
syntax enable
filetype plugin indent on

let g:mapleader=' '

" To get Vim default "fuzzy-finder" finding files (:find)
set path+=**
set wildmenu

" Enable foldable
set foldenable
set foldmethod=indent
set foldlevel=2

" incremental search
set incsearch

" Show invisibles
set list
set listchars=tab:>\ ,trail:-,extends:>,precedes:<,nbsp:+

" show line number
set number
set relativenumber

" Auto reload file changes
set autoread

" More expected split pane behavior
set splitbelow
set splitright

" Set up :grep with The Silver Searcher
if executable('ag')
    " Use ag over grep
    set grepprg=ag\ --nogroup\ --nocolor
endif

" Netrw - vim built-in file explorer
let g:netrw_banner = 0
let g:netrw_liststyle = 3
let g:netrw_browse_split = 4
let g:netrw_altv = 1
let g:netrw_winsize = 25

set autoindent             " Indent according to previous line.
set smartindent            " Indent smartly
set tabstop=4              " Set tab width to 4
set softtabstop=4          " Tab key indents by 4 spaces.
set shiftwidth=4           " >> indents by 4 spaces.
set shiftround             " >> indents to next multiple of 'shiftwidth'.
