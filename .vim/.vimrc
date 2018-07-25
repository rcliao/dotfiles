scriptencoding utf-8

"" Set up for Vim-Plug {
    let s:plugpath = '~/.local/share/nvim/plugged'
    let s:plugvim = '~/.local/share/nvim/site/autoload/plug.vim'

    if !has('nvim')
        let s:plugpath = '~/.vim/plugged'
        let s:plugvim = '~/.vim/autoload/plug.vim'
    endif
""  }
" Auto install vim-plug if not installed {
    if empty(glob(s:plugvim))
        silent !curl -fLo s:plugvim --create-dirs
            \ https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
        augroup AutoInstallPlug
            autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
        augroup END
    endif
"" }
" https://github.com/junegunn/vim-plug
call plug#begin(s:plugpath)
"" Common plugins {
    " show git gutter (indication on what has changed)
    Plug 'airblade/vim-gitgutter'
    " fast fuzzy finder
    Plug 'junegunn/fzf', { 'dir': '~/.fzf', 'do': './install --all' }
    Plug 'junegunn/fzf.vim'
    " Colorscheme
    Plug 'arcticicestudio/nord-vim'
    "" tpope section
    " Easily change surrounding stuff like cs'"
    Plug 'tpope/vim-surround'
    " More natural binding on navigations like q[
    Plug 'tpope/vim-unimpaired'
    " Allowing "." command to repat various plugin actions
    Plug 'tpope/vim-repeat'
    "" End of tpope section
    " Async General Linter
    Plug 'w0rp/ale'
    " Provide additional text object for Vim like (b{B,t
    Plug 'wellle/targets.vim'
    "" Optional fun plugins
    " Start screen
    Plug 'mhinz/vim-startify'
    " Personal Wiki
    Plug 'vimwiki/vimwiki'
    " UltiSnip for snippet management
    Plug 'SirVer/ultisnips' | Plug 'honza/vim-snippets'
    "" Experimental area
    Plug 'junegunn/goyo.vim'
"" }
"" Language specific {
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
    " Kotlin
    Plug 'udalov/kotlin-vim'
"" }
"" Initialize plugin system
call plug#end()

"" General Settings {
    " Use space as leader
    let g:mapleader=' '

    " To avoid buffer needing to write to disk when abandoned
    set hidden

    " when scroll up and down, apply "margin" so easier to see context
    set scrolloff=4

    " Indentation settings
    set tabstop=4              " Set tab width to 4
    set softtabstop=4          " Tab key indents by 4 spaces.
    set shiftwidth=4           " >> indents by 4 spaces.
    set expandtab              " space over tab

    " update time faster for gitgutter
    set updatetime=100

    " Enable foldable
    set foldenable
    set foldmethod=indent
    set foldlevel=2

    " incremental search
    set incsearch

    " Show invisibles characters like space or tabs
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

    " To hide pane split character
    set fillchars=vert:\ ,stl:\ ,stlnc:\ 

    " True color support for nvim
    if has('nvim-0.1.5')        " True color in neovim wasn't added until 0.1.5
        set termguicolors
    endif

    " Change colorscheme and its conifiguration
    let g:nord_comment_brightness = 12
    let g:nord_cursor_line_number_background = 1
    colorscheme nord

    " Transparent background
    hi vertsplit ctermbg=None guibg=None
    hi clear SignColumn
    hi LineNr ctermbg=None guibg=None
    hi SignColumn ctermbg=None guibg=None
    hi GitGutterAdd ctermbg=None guibg=None
    hi GitGutterChange ctermbg=None guibg=None
    hi GitGutterDelete ctermbg=None guibg=None
    hi GitGutterChangeDelete ctermbg=None guibg=None
    hi EndOfBuffer guibg=None ctermbg=None
    " transparent background
    highlight Normal guibg=None ctermbg=None

    " highlight the active pane using cursorline
    set cursorline
    augroup BgHighlight
        autocmd!
        autocmd WinEnter * set cursorline
        autocmd WinLeave * set nocursorline
    augroup END

    " spell check on markdown and gitcommit file
    augroup spellchecker
        autocmd BufRead,BufNewFile *.md setlocal spell
        autocmd FileType gitcommit setlocal spell
    augroup END
    " auto complete words
    set complete+=kspell

    " Set up :grep with The Silver Searcher or ripgrep
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
    " VimWiki settings
    let g:vimwiki_list = [{'path': '~/vimwiki',
                \ 'syntax': 'markdown', 'ext': '.md'}]
    " to avoid vimwiki on every single markdown
    let g:vimwiki_global_ext=0
    " to allow ultisnip use tab to expand snippets
    let g:vimwiki_table_mappings = 0
    " to enable fold in vimwiki (note: might be bad performance for big file)
    let g:vimwiki_folding = 'expr'

    " Freemarker to html for syntax highlight without plugin
    au BufRead,BufNewFile *.ftl set filetype=html

    " Dirvish settings
    let g:dirvish_mode = ':sort ,^.*[\/],' " sort folder at top

    " Ale (linter settings)
    let g:ale_linters = {
        \ 'javascript': ['eslint'],
        \ 'html': [],
        \ 'rust': ['rustc'],
        \ 'typescript': ['tslint']
    \ }

    " VIM-go settings
    let g:go_fmt_command = 'goimports'

    " ultisnip configurations
    let g:UltiSnipsExpandTrigger = '<tab>'
    let g:UltiSnipsJumpForwardTrigger = '<c-j>'
    let g:UltiSnipsJumpBackwardTrigger = '<c-k>'
    let g:UltiSnipsSnippetsDir = $HOME.'/dotfiles/UltiSnips'
    let g:UltiSnipsSnippetDirectories = ['UltiSnips', $HOME.'/dotfiles/UltiSnips']
    let g:UltiSnipsEditSplit = 'vertical'
"" }

"" Leader key bindings {
    " quick jump through buffer
    nmap <leader>b :ls<CR>:buffer<SPACE>
    " switch to last buffer
    nmap <leader>q :b#<cr>

    " insert current date (mostly used for the journal)
    map <leader>td "=strftime("%Y-%m-%d")<CR>p

    " <c-l> to remove highlighting of hlsearch
    if maparg('<C-L>', 'n') ==# ''
        nnoremap <silent> <C-L> :nohlsearch<C-R>=has('diff')?'<Bar>diffupdate':''<CR><CR><C-L>
    endif

    " Vim-FZF settings
    set runtimepath+=/usr/local/opt/fzf
    map <leader>fb  :Buffers<CR>
    map <leader>fp  :FZF<CR>
    map <leader>ft  :BTags<CR>
    " Search for vimwiki files
    map <leader>fd  :Files ~/Dropbox/wiki<CR>

    " Goyo settings
    map <leader>gy :Goyo<CR>

    " shortcuts for folding levels
    nmap <leader>z0 :set foldlevel=0<CR>
    nmap <leader>z1 :set foldlevel=1<CR>
    nmap <leader>z2 :set foldlevel=2<CR>
    nmap <leader>z3 :set foldlevel=3<CR>
    nmap <leader>z9 :set foldlevel=999<CR>
"" }

