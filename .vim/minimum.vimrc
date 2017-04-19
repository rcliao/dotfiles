" Minimum Vimrc file used when going to someone else machine?

syntax enable
filetype plugin indent on

let g:mapleader=" "

" To get Vim default "fuzzy-finder" finding files (:find)
set path+=**
set wildmenu

" Enable foldable
set foldenable
set foldmethod=indent

" highlight current line
set cursorline

" incremental search
set incsearch

" Show invisibles
set list

" Auto reload file changes
set autoread

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
