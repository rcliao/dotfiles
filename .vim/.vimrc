" https://github.com/junegunn/vim-plug
call plug#begin('~/.local/share/nvim/plugged')

"" Common plugins {
    " NERDTree for file explorer
    Plug 'scrooloose/nerdtree'
    " show git gutter (indication on what has changed)
    Plug 'airblade/vim-gitgutter'
    " tmux integration
    Plug 'benmills/vimux'
    " EditorConfig integration
    Plug 'editorconfig/editorconfig-vim'
    " snippet integration
    Plug 'honza/vim-snippets'
    Plug 'sirver/ultisnips'
    " fast fuzzy finder
    Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
    Plug 'junegunn/fzf.vim'
    " Show mark location
    Plug 'kshenoy/vim-signature'
    " Colorscheme
    Plug 'chriskempson/base16-vim'
    Plug 'morhetz/gruvbox'
    "" tpope section
    " Git integration in vim like :Gstatus
    Plug 'tpope/vim-fugitive'
    " Easily change surrounding stuff
    Plug 'tpope/vim-surround'
    " More natural binding on navigations
    Plug 'tpope/vim-unimpaired'
    " Allow "." to repeat many plugin actions
    Plug 'tpope/vim-repeat'
    " Comment stuff out
    Plug 'tpope/vim-commentary'
    "" End of tpope section
    " Provide additional text object for Vim
    Plug 'wellle/targets.vim'
    " Async Linter
    Plug 'w0rp/ale'
"" }

"" Languages {
    " For writing
    Plug 'LanguageTool'
    Plug 'rhysd/vim-grammarous'
    " Haskell
    Plug 'eagletmt/neco-ghc'
    Plug 'neovimhaskell/haskell-vim'
    " Go
    Plug 'fatih/vim-go', { 'do': ':GoInstallBinaries' }
    " TypeScript
    Plug 'leafgarland/typescript-vim'
    Plug 'quramy/tsuquyomi'
        " Required for tsuquyomi
        Plug 'shougo/vimproc.vim', {'do' : 'make'}
    " Emmet for easier html code snippet
    Plug 'mattn/emmet-vim'
    " JavaScript
    Plug 'othree/yajs.vim'
    Plug 'pangloss/vim-javascript'
    " Ansible
    Plug 'pearofducks/ansible-vim'
    " Vue
    Plug 'posva/vim-vue'
    " Elm-lang
    Plug 'elmcast/elm-vim'
    " Markdown
    Plug 'plasticboy/vim-markdown'
    Plug 'mzlogin/vim-markdown-toc'
"" }

"" Initialize plugin system
call plug#end()

"" General Settings {
    " Use space as leader
    let g:mapleader=" "

    " To get Vim default fuzzy-finder (:find)
    set path+=**
    set wildmenu

    " highlight current line
    set cursorline

    " Enable foldable
    set foldenable
    set foldmethod=indent

    " incremental search
    set incsearch

    " Show invisibles
    set list
    set listchars=tab:>\ ,trail:-,extends:>,precedes:<,nbsp:+

    " show line number
    set relativenumber
    set number

    " show line width 80
    set colorcolumn=80,120
    au FileType gitcommit set cc=50,80

    " More expected split pane behavior
    set splitbelow
    set splitright

    " Auto reload file changes
    set autoread

    " To hide split character
    set fillchars+=vert:│

    set autoindent             " Usually does the right thing unless it doesnt
    set copyindent             " copy indent from the previous line
    set preserveindent         " preserve indent based on most of the indentation
    set smartindent            " Indent smartly
    set tabstop=4              " Set tab width to 4
    set softtabstop=4          " Tab key indents by 4 spaces.
    set shiftwidth=4           " >> indents by 4 spaces.
    set shiftround             " >> indents to next multiple of 'shiftwidth'.
    set expandtab              " default to use space rather than tab to indent

    " Change coloescheme conifiguration
    colorscheme base16-eighties
    if filereadable(expand("~/.vimrc_background"))
        let base16colorspace=256
        source ~/.vimrc_background
    endif
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

    " spell check on markdown and gitcommit file
    autocmd BufRead,BufNewFile *.md setlocal spell
    autocmd FileType gitcommit setlocal spell
    " auto complete words
    set complete+=kspell

    " The Silver Searcher
    if executable('ag')
        " Use ag over grep
        set grepprg=ag\ --nogroup\ --nocolor
    endif

    set statusline=                                  " clear the statusline for when vimrc is reloaded
    set statusline+=%#Pmenu#                         " Set color
    set statusline+=%-3.3n\                          " buffer number
    set statusline+=%f\                              " file name
    set statusline+=%h%m%r%w                         " flags
    set statusline+=[%{strlen(&ft)?&ft:'none'}]      " filetype
    set statusline+=\ \(%{fugitive#statusline()}\)\  " git branch name
    set statusline+=%#CursorLine#                    " SEt color
    set statusline+=%=                               " right align
    set statusline+=%#Pmenu#                         " Set color
    set statusline+=\ %b,0x%-8B\                     " current char
    set statusline+=%-14.(%l,%c%V%)\ %<%P            " offset
    hi Normal guibg=NONE ctermbg=NONE
"" }

"" Languages settings {
    " Writing related
    let g:languagetool_jar='$HOME/languagetool/languagetool-commandline.jar'

    " Freemarker to html
    au BufRead,BufNewFile *.ftl set filetype=html

    " Ale (linter settings)
    " JavaScript
    let g:ale_linters = {
        \ 'javascript': ['eslint'],
        \ 'html': [],
    \ }

    " VIM-go settings
    let g:go_highlight_functions = 1
    let g:go_highlight_methods = 1
    let g:go_highlight_fields = 1
    let g:go_highlight_types = 1
    let g:go_highlight_operators = 1
    let g:go_highlight_build_constraints = 1
    let g:go_fmt_command = "goimports"

    "" Vim-signature
    let g:SignatureMarkTextHLDynamic=1

    " GoTags configuration with Tagbar
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
"" }

"" Leader key bindings {
    map <leader>tsud :TsuDefinition<CR>
    " clear any trailing empty spaces
    map <leader>rts :%s/\s\+$//e<CR>
    " quick vimrc editing/reloading
    map <leader>vimrc :tabe ~/dotfiles/.vim/.vimrc<CR>
    map <leader>rvimrc :source ~/dotfiles/.vim/.vimrc<CR>

    map <leader>nt :NERDTreeToggle<CR>
    map <leader>nf :NERDTreeFind<CR>
    map <leader>nb :Bookmark<CR>

    " find bufer quickly
    nmap <leader>ls :ls<CR>:buffer<SPACE>

    " Vim-FZF settings
    set rtp+=/usr/local/opt/fzf
    map <c-p> :FZF<CR>
    map <c-t> :BTags<CR>

    " Vimux settings
    map <leader>tmuxb :VimuxRunLastCommand<CR>
    map <leader>tmuxc :VimuxPromptCommand<CR>
"" }
