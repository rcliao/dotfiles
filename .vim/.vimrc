scriptencoding utf-8

" https://github.com/junegunn/vim-plug
call plug#begin('~/.local/share/nvim/plugged')
"" Common plugins {
    " lightweight file explorer
    Plug 'justinmk/vim-dirvish'
    " show git gutter (indication on what has changed)
    Plug 'airblade/vim-gitgutter'
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
    " Git integration in vim like :Gstatus => C (commit) => :Gpush
    Plug 'tpope/vim-fugitive'
    " Easily change surrounding stuff like cs'"
    Plug 'tpope/vim-surround'
    " More natural binding on navigations like q[
    Plug 'tpope/vim-unimpaired'
    " Allow "." to repeat many plugin actions
    Plug 'tpope/vim-repeat'
    " Comment stuff out by gcc
    Plug 'tpope/vim-commentary'
    " kicks off build/testing in tmux synchronous or asynchronously
    Plug 'tpope/vim-dispatch'
    "" End of tpope section
    " Provide additional text object for Vim like (b{B,t
    Plug 'wellle/targets.vim'
    " Async General Linter
    Plug 'w0rp/ale'
    " Start screen
    Plug 'mhinz/vim-startify'
    " Personal Wiki
    Plug 'vimwiki/vimwiki'
"" }

"" Languages {
    " For writing
    Plug 'rhysd/vim-grammarous', { 'for': 'markdown' }
    " Haskell
    Plug 'eagletmt/neco-ghc', { 'for': 'haskell' }
    Plug 'neovimhaskell/haskell-vim', { 'for': 'haskell' }
    " Go
    Plug 'fatih/vim-go', { 'do': ':GoInstallBinaries', 'for': 'go' }
    " TypeScript
    Plug 'leafgarland/typescript-vim', { 'for': 'typescript' }
    Plug 'quramy/tsuquyomi', { 'for': 'typescript' }
        " Required for tsuquyomi
        Plug 'shougo/vimproc.vim', {'do' : 'make', 'for': 'typescript' }
    " Emmet for easier html code snippet
    Plug 'mattn/emmet-vim'
    " JavaScript
    Plug 'othree/yajs.vim', { 'for': ['html', 'javascript'] }
    Plug 'pangloss/vim-javascript', { 'for': ['html', 'javascript'] }
    " JSX - React
    Plug 'mxw/vim-jsx', { 'for': ['jsx', 'javascript'] }
    " Ansible
    Plug 'pearofducks/ansible-vim', { 'for': 'ansible' }
    " Vue
    Plug 'posva/vim-vue', { 'for': 'vue' }
    " Elm-lang
    Plug 'elmcast/elm-vim', { 'for': 'elm' }
    " Markdown
    Plug 'plasticboy/vim-markdown', { 'for': 'markdown' }
    " Rust-lang
    Plug 'rust-lang/rust.vim', { 'for': 'rust' }
    " Tmux
    Plug 'tmux-plugins/vim-tmux'
"" }
"" Initialize plugin system
call plug#end()

"" General Settings {
    " Use space as leader
    let g:mapleader=' '

    " To get Vim default fuzzy-finder (:find)
    set path+=**
    set wildmenu

    " Enable foldable
    set foldenable
    set foldmethod=indent
    set foldlevel=2

    " Dirvish settings
    let g:dirvish_mode = ':sort ,^.*[\/],' " sort folder at top

    " incremental search
    set incsearch

    " Show invisibles
    set list
    set listchars=tab:>\ ,trail:-,extends:>,precedes:<,nbsp:+

    " show line number
    set number
    set relativenumber

    " show line width 80
    set colorcolumn=80,120
    augroup git
        au FileType gitcommit set cc=50,80
    augroup END

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
    set tabstop=4              " Set tab width to 4
    set softtabstop=4          " Tab key indents by 4 spaces.
    set shiftwidth=4           " >> indents by 4 spaces.
    set shiftround             " >> indents to next multiple of 'shiftwidth'.
    set expandtab              " default to use space rather than tab to indent

    " Change coloescheme conifiguration
    colorscheme gruvbox
    let g:gruvbox_contrast_dark = 'soft'
    let g:gruvbox_contrast_light = 'hard'
    let g:gruvbox_italic = 1
    set background=dark

    " True color support
    set termguicolors

    " spell check on markdown and gitcommit file
    augroup spellchecker
        autocmd BufRead,BufNewFile *.md setlocal spell
        autocmd FileType gitcommit setlocal spell
    augroup END
    " auto complete words
    set complete+=kspell

    " Set up :grep with The Silver Searcher
    if executable('ag')
        " Use ag over grep
        set grepprg=ag\ --nogroup\ --nocolor
    endif
    if executable('rg')
        " Use rg over grep
        set grepprg=rg\ --vimgrep
    endif

    " Custom status line for better performance
    set statusline=                                  " clear the statusline for when vimrc is reloaded
    set statusline+=\ \ \ %-2.2n\                    " buffer number
    set statusline+=\ %f\                            " file name
    set statusline+=\ %h%m%r%w                       " flags
    set statusline+=%y\                              " file name
    set statusline+=%=                               " right align
    set statusline+=\ \ %-7.(%l:%c%V%)               " offset
    set statusline+=\ /\ %-4.L\ \                    " total lines
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
        \ 'rust': ['rustc'],
        \ 'typescript': ['tslint']
    \ }
    " ale update that doesn't read from $CLASSPATH environment vars anymore,
    " this line assign environment variable to ale path for javac linter
    let g:ale_java_javac_classpath=$CLASSPATH

    " vim-JavaScript
    let g:javascript_plugin_jsdoc = 1
    " vim-jsx
    let g:jsx_ext_required = 0

    " VIM-go settings
    let g:go_highlight_functions = 1
    let g:go_highlight_methods = 1
    let g:go_highlight_fields = 1
    let g:go_highlight_types = 1
    let g:go_highlight_operators = 1
    let g:go_highlight_build_constraints = 1
    let g:go_fmt_command = 'goimports'

    " Vim-signature
    let g:SignatureMarkTextHLDynamic=1

    " RipGrep settings
    " --column: Show column number
    " --line-number: Show line number
    " --no-heading: Do not show file headings in results
    " --fixed-strings: Search term as a literal string
    " --ignore-case: Case insensitive search
    " --no-ignore: Do not respect .gitignore, etc...
    " --hidden: Search hidden files and folders
    " --follow: Follow symlinks
    " --glob: Additional conditions for search (in this case ignore everything in the .git/ folder)
    " --color: Search color options
    command! -bang -nargs=* Find call fzf#vim#grep('rg --column --line-number --no-heading --fixed-strings --ignore-case --no-ignore --hidden --follow --glob "!.git/*" --color "always" '.shellescape(<q-args>), 1, <bang>0)
"" }

"" Leader key bindings {
    " find bufer quickly
    nmap <leader>ls :ls<CR>:buffer<SPACE>
    " clear any trailing empty spaces
    map <leader>rts :%s/\s\+$//e<CR>
    " quick vimrc editing/reloading
    map <leader>vimrc :tabe ~/dotfiles/.vim/.vimrc<CR>
    map <leader>rvimrc :source ~/dotfiles/.vim/.vimrc<CR>

    " fugitive shortcuts
    map <leader>gs :Gstatus<CR>
    map <leader>gp :Gpush<CR>

    " Dirvish shortcuts
    map <leader>de :Dirvish %<CR>
    map <leader>dr :Dirvish<CR>

    " Vim-FZF settings
    set runtimepath+=/usr/local/opt/fzf
    map <leader>fb :Buffers<CR>
    map <leader>fl :BLines<CR>
    map <leader>fp :FZF<CR>
    map <leader>ft :Tags<CR>
    map <leader>fct :BTags<CR>
    map <leader>fm :Marks<CR>

    " shortcuts for folding levels
    nmap <leader>z0 :set foldlevel=0<CR>
    nmap <leader>z1 :set foldlevel=1<CR>
    nmap <leader>z2 :set foldlevel=2<CR>
    nmap <leader>z3 :set foldlevel=3<CR>
    nmap <leader>z4 :set foldlevel=4<CR>
    nmap <leader>z5 :set foldlevel=5<CR>
    nmap <leader>z9 :set foldlevel=999<CR>

    " shortcuts for Go related files
    function! s:build_go_files()
        let l:file = expand('%')
        if l:file =~# '^\f\+_test\.go$'
            call go#test#Test(0, 1)
        elseif l:file =~# '^\f\+\.go$'
            call go#cmd#Build(0)
        endif
    endfunction

    augroup goshortcuts
        autocmd FileType go nmap <leader>r <Plug>(go-run)
        autocmd FileType go nmap <leader>t <Plug>(go-test)
        autocmd FileType go nmap <leader>b :<C-u>call <SID>build_go_files()<CR>
        autocmd FileType go nmap <leader>c <Plug>(go-coverage-toggle)
    augroup END
"" }
