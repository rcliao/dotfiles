" https://github.com/junegunn/vim-plug
call plug#begin('~/.local/share/nvim/plugged')

"" Common plugins {
    " show git gutter (indication on what has changed)
    Plug 'airblade/vim-gitgutter'
    " tmux integration
    Plug 'benmills/vimux'
    " EditorConfig integration
    Plug 'editorconfig/editorconfig-vim'
    " fast fuzzy finder
    Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
    Plug 'junegunn/fzf.vim'
    " Show mark location
    Plug 'kshenoy/vim-signature'
    " Easy motion
    Plug 'easymotion/vim-easymotion'
    " Colorscheme
    Plug 'morhetz/gruvbox'
    "" tpope section
    " Enhance Netrw (% to add file, ! to execute command on selected file)
    Plug 'tpope/vim-vinegar'
    " Git integration in vim like :Gstatus => C (commit) => :Gpush
    Plug 'tpope/vim-fugitive'
    " Easily change surrounding stuff like cs'"
    Plug 'tpope/vim-surround'
    " More natural binding on navigations
    Plug 'tpope/vim-unimpaired'
    " Allow "." to repeat many plugin actions
    Plug 'tpope/vim-repeat'
    " Comment stuff out by gc
    Plug 'tpope/vim-commentary'
    "" End of tpope section
    " Provide additional text object for Vim
    Plug 'wellle/targets.vim'
    " Async Linter
    Plug 'w0rp/ale'
    " Start screen
    Plug 'mhinz/vim-startify'
    " Personal Wiki
    Plug 'vimwiki/vimwiki'
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

    " Enable foldable
    set foldenable
    set foldmethod=indent
    set foldlevel=2

    " Netrw settings
    let g:netrw_banner = 0   " hide informative banner
    let g:netrw_altv = 1     " Open at right
    " Delete all the netrw related buffer so that it doesn't prevent vim from
    " closing
    autocmd FileType netrw setl bufhidden=delete

    " incremental search
    set incsearch

    " Show invisibles
    set list
    set listchars=tab:>\ ,trail:-,extends:>,precedes:<,nbsp:+

    " show line number
    set relativenumber

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
    colorscheme gruvbox
    let g:gruvbox_contrast_dark = "soft"
    let g:gruvbox_italic = 1
    set background=dark

    " True color support
    set termguicolors

    " spell check on markdown and gitcommit file
    autocmd BufRead,BufNewFile *.md setlocal spell
    autocmd FileType gitcommit setlocal spell
    " auto complete words
    set complete+=kspell

    " Set up :grep with The Silver Searcher
    if executable('ag')
        " Use ag over grep
        set grepprg=ag\ --nogroup\ --nocolor
    endif

    set statusline=                                  " clear the statusline for when vimrc is reloaded
    set statusline+=\ \ %-3.3n\                          " buffer number
    set statusline+=%f\                              " file name
    set statusline+=%h%m%r%w                         " flags
    set statusline+=%y\                              " file name
    set statusline+=%=                               " right align
    set statusline+=%-14.(%l,%c%V%)                  " offset
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
        \ 'html': []
    \ }

    " ale update that doesn't read from $CLASSPATH environment vars anymore,
    " this line assign environment variable to ale path for javac linter
    let g:ale_java_javac_classpath=$CLASSPATH

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
"" }

"" Leader key bindings {
    map <leader>tsud :TsuDefinition<CR>
    " clear any trailing empty spaces
    map <leader>rts :%s/\s\+$//e<CR>
    " quick vimrc editing/reloading
    map <leader>vimrc :tabe ~/dotfiles/.vim/.vimrc<CR>
    map <leader>rvimrc :source ~/dotfiles/.vim/.vimrc<CR>

    " quick shortcut to insert current datetime
    map <leader>cdt :put =strftime('%c')<CR>

    " Netrw shortcuts
    map <leader>e :Explore<CR>
    map <leader>ve :Vexplore<CR>

    " find bufer quickly
    nmap <leader>ls :ls<CR>:buffer<SPACE>

    " Vim-FZF settings
    set rtp+=/usr/local/opt/fzf
    map <c-p> :FZF<CR>
    map <c-t> :BTags<CR>

    " Vimux settings
    map <leader>tmuxb :VimuxRunLastCommand<CR>
    map <leader>tmuxc :VimuxPromptCommand<CR>

    " shortcuts for Go related files
    function! s:build_go_files()
        let l:file = expand('%')
        if l:file =~# '^\f\+_test\.go$'
            call go#test#Test(0, 1)
        elseif l:file =~# '^\f\+\.go$'
            call go#cmd#Build(0)
        endif
    endfunction

    autocmd FileType go nmap <leader>r <Plug>(go-run)
    autocmd FileType go nmap <leader>t <Plug>(go-test)
    autocmd FileType go nmap <leader>b :<C-u>call <SID>build_go_files()<CR>
    autocmd FileType go nmap <leader>c <Plug>(go-coverage-toggle)
"" }
