scriptencoding utf-8

let s:plugpath = '~/.local/share/nvim/plugged'
let s:plugvim = '~/.local/share/nvim/site/autoload/plug.vim'

if !has('nvim')
    let s:plugpath = '~/.vim/plugged'
    let s:plugvim = '~/.vim/autoload/plug.vim'
endif

" Auto install vim-plug if not installed
if empty(glob(s:plugvim))
    silent !curl -fLo s:plugvim --create-dirs
        \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
    augroup AutoInstallPlug
        autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
    augroup END
endif

" https://github.com/junegunn/vim-plug
call plug#begin(s:plugpath)
"" Common plugins {
    " show git gutter (indication on what has changed)
    Plug 'airblade/vim-gitgutter'
    " lightweight file explorer (netrw is buggy with bunch of trash buffer)
    Plug 'justinmk/vim-dirvish'
    " fast fuzzy finder
    Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
    Plug 'junegunn/fzf.vim'
    " Colorscheme
    Plug 'chriskempson/base16-vim'
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
    "" End of tpope section
    " Async General Linter
    Plug 'w0rp/ale'
    " Provide additional text object for Vim like (b{B,t
    Plug 'wellle/targets.vim'
    "" Rarely used plugins
    " Easy motion `<leader><leader>f` to jump anywhere
    Plug 'easymotion/vim-easymotion'
    " EditorConfig integration
    Plug 'editorconfig/editorconfig-vim'
    "" Optional fun plugins
    " Start screen
    Plug 'mhinz/vim-startify'
    " Personal Wiki
    Plug 'vimwiki/vimwiki'
    "" Experimental area
    " For generating tags automatically and seamlessly with ctags
    Plug 'ludovicchabant/vim-gutentags'
    " For aligning text
    Plug 'tommcdo/vim-lion'
"" }

"" Languages {
    " For writing
    Plug 'rhysd/vim-grammarous', { 'for': ['markdown', 'gitcommit', 'vimwiki'] }
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
    " Tmux (for syntax highlight)
    Plug 'tmux-plugins/vim-tmux', { 'for': 'tmux' }
"" }
"" Initialize plugin system
call plug#end()

"" General Settings {
    " Use space as leader
    let g:mapleader=' '

    " Enable recursive search with `*find`
    set path+=**
    " Allow command to open menu
    set wildmenu

    " hide netre banner
    let g:netrw_banner = 0

    " Indentation settings
    set autoindent             " Usually does the right thing unless it doesnt
    set copyindent             " copy indent from the previous line
    set preserveindent         " preserve indent based on most of the indentation
    set tabstop=4              " Set tab width to 4
    set softtabstop=4          " Tab key indents by 4 spaces.
    set shiftwidth=4           " >> indents by 4 spaces.
    set shiftround             " >> indents to next multiple of 'shiftwidth'.
    set expandtab            " default to use hard tab rather than space to indent

    " Enable foldable
    set foldenable
    set foldmethod=indent
    set foldlevel=2
    " incremental search
    set incsearch

    " Show invisibles
    set list
    set listchars=tab:>\ ,trail:-,extends:>,precedes:<,nbsp:+

    " show line number and relative number
    set number
    set relativenumber

    " show line width 80
    set colorcolumn=80,120
    augroup AutoWrap
        au FileType gitcommit set cc=50,80
        au FileType markdown set cc=80
    augroup END

    " Expected split pane behavior (new pane to the right and the bottom)
    set splitbelow
    set splitright

    " To hide split character
    set fillchars+=vert:│

    " Change coloescheme and its conifiguration
    if filereadable(expand('~/.vimrc_background'))
        let g:base16colorspace=256
        source ~/.vimrc_background
    endif

    " color highlight of the current cursor number
    hi CursorLineNr   term=bold ctermfg=1 gui=bold guifg=#f99157

    " highlight the active pane using cursorline
    set cursorline
    augroup BgHighlight
        autocmd!
        autocmd WinEnter * set cursorline
        autocmd WinLeave * set nocursorline
    augroup END

    " True color support for neovim and only for neovim
    if has('nvim')
        set termguicolors
    endif

    " spell check on markdown and gitcommit file
    augroup spellchecker
        autocmd BufRead,BufNewFile *.md setlocal spell
        autocmd FileType gitcommit setlocal spell
    augroup END
    " auto complete words
    set complete+=kspell

    " Set up :grep with The Silver Searcher or ripgrep
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
    set statusline+=%y\                              " file type
    set statusline+=%=                               " right align
    set statusline+=\ \ %-7.(%l:%c%V%)               " offset
    set statusline+=\ /\ %-4.L\ \                    " total lines
"" }

"" Languages/Plugin settings {
    " Freemarker to html for syntax highlight without plugin
    au BufRead,BufNewFile *.ftl set filetype=html

    " Dirvish settings
    let g:dirvish_mode = ':sort ,^.*[\/],' " sort folder at top

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
    " quick jump through buffer
    nmap <leader>ls :ls<CR>:buffer<SPACE>
    " built-in fuzzy search
    nmap <leader>e :e **/
    " Buffer jumb
    nmap <leader>b :b <C-d>
    " include search
    nmap <leader>i :ilist<space>
    " quick jump on tags (if generated)
    nmap <leader>j :tjump /
    nmap <leader>p :ptjump /
    nmap <leader>d :dlist /
    " switch to last buffer
    nmap <leader>q :b#<cr>
    " clear any trailing empty spaces
    map <leader>rts :%s/\s\+$//e<CR>
    " quick vimrc editing/reloading
    map <leader>vimrc :tabe ~/dotfiles/.vim/.vimrc<CR>
    map <leader>rvimrc :source ~/dotfiles/.vim/.vimrc<CR>

    " fugitive shortcuts
    map <leader>gs :Gstatus<CR>
    map <leader>gp :Gpush<CR>

    " Netrw shortcuts
    map <leader>- :Rex<CR>
    map <leader>de :Ex<CR>
    map <leader>ds :Vex<CR>

    " Vim-FZF settings
    set runtimepath+=/usr/local/opt/fzf
    map <leader>fat :Tags<CR>
    map <leader>fb  :Buffers<CR>
    map <leader>fc  :Commits<CR>
    map <leader>fl  :BLines<CR>
    map <leader>fm  :Marks<CR>
    map <leader>fp  :FZF<CR>
    map <leader>ft  :BTags<CR>

    " shortcuts for folding levels
    nmap <leader>z0 :set foldlevel=0<CR>
    nmap <leader>z1 :set foldlevel=1<CR>
    nmap <leader>z2 :set foldlevel=2<CR>
    nmap <leader>z3 :set foldlevel=3<CR>
    nmap <leader>z4 :set foldlevel=4<CR>
    nmap <leader>z5 :set foldlevel=5<CR>
    nmap <leader>z9 :set foldlevel=999<CR>
"" }
