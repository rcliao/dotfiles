scriptencoding utf-8

" Auto install vim-plug if not installed {
    let data_dir = has('nvim') ? stdpath('data') . '/site' : '~/.vim'
    if empty(glob(data_dir . '/autoload/plug.vim'))
        silent execute '!curl -fLo '.data_dir.'/autoload/plug.vim --create-dirs  https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'
        autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
    endif
"" }

" https://github.com/junegunn/vim-plug
call plug#begin(data_dir)
"" Common plugins {
    " show git gutter (indication on what has changed)
    Plug 'airblade/vim-gitgutter'
    " fast fuzzy finder
    Plug '/usr/local/opt/fzf'
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
    Plug 'tpope/vim-fugitive'
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
    " Emmet for easier html code snippet
    Plug 'mattn/emmet-vim'
    " JavaScript
    Plug 'othree/yajs.vim', { 'for': ['html', 'javascript'] }
    Plug 'pangloss/vim-javascript', { 'for': ['html', 'javascript'] }
    " JSX - React
    Plug 'mxw/vim-jsx', { 'for': ['jsx', 'javascript'] }
    Plug 'peitalin/vim-jsx-typescript'
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
    " GraphQL
    Plug 'jparise/vim-graphql'
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
    autocmd Filetype javascript.jsx setlocal tabstop=2 softtabstop=2 shiftwidth=2
    autocmd Filetype typescript setlocal tabstop=2 softtabstop=2 shiftwidth=2
    autocmd Filetype yaml setlocal tabstop=2 softtabstop=2 shiftwidth=2
    autocmd Filetype css setlocal tabstop=2 softtabstop=2 shiftwidth=2

    " update time faster for gitgutter
    set updatetime=300

    " Enable foldable
    set foldenable
    set foldmethod=indent
    set foldlevel=2

    " incremental search
    set incsearch
    set hlsearch

    " set backspace behavior to be more expected
    set bs=2

    " Show invisibles characters like space or tabs
    set list
    set listchars=tab:>\ ,trail:-,extends:>,precedes:<,nbsp:+

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
    colorscheme nord

    " Transparent background
    hi vertsplit ctermbg=NONE guibg=NONE
    hi clear SignColumn
    hi LineNr ctermbg=NONE guibg=NONE
    hi SignColumn ctermbg=NONE guibg=NONE
    hi GitGutterAdd ctermbg=NONE guibg=NONE
    hi GitGutterChange ctermbg=NONE guibg=NONE
    hi GitGutterDelete ctermbg=NONE guibg=NONE
    hi GitGutterChangeDelete ctermbg=NONE guibg=NONE
    hi EndOfBuffer guibg=NONE ctermbg=NONE
    " transparent background
    highlight Normal guibg=NONE ctermbg=NONE

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
    set laststatus=2                                 " always show status
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
    let g:vimwiki_list = [{'path': '~/Dropbox/journals',
                \ 'syntax': 'markdown', 'ext': '.md'}]
    " to avoid vimwiki on every single markdown
    let g:vimwiki_global_ext=0
    " to allow ultisnip use tab to expand snippets
    let g:vimwiki_table_mappings = 0
    " to enable fold in vimwiki (note: might be bad performance for big file)
    let g:vimwiki_folding = 'expr'

    " Freemarker to html for syntax highlight without plugin
    au BufRead,BufNewFile *.ftl set filetype=html

    " Ale (linter settings)
    let g:ale_linters = {
        \ 'javascript': ['eslint'],
        \ 'html': [],
        \ 'rust': ['rustc'],
        \ 'typescript': ['tsserver', 'eslint']
    \ }
    " Equivalent to the above.
    let g:ale_fixers = {'typescript': ['prettier', 'eslint']}
    " Set this variable to 1 to fix files when you save them.
    let g:ale_fix_on_save = 1

    " VIM-go settings
    let g:go_fmt_command = 'goimports'

    " ultisnip configurations
    let g:UltiSnipsExpandTrigger = '<tab>'
    let g:UltiSnipsJumpForwardTrigger = '<c-j>'
    let g:UltiSnipsJumpBackwardTrigger = '<c-k>'
    let g:UltiSnipsSnippetsDir = $HOME.'/dotfiles/UltiSnips'
    let g:UltiSnipsSnippetDirectories = ['UltiSnips', $HOME.'/dotfiles/UltiSnips']
    let g:UltiSnipsEditSplit = 'vertical'

    " disalbe tsuquyomi check in favor of ALE
    let g:tsuquyomi_disable_quickfix = 1
"" }

"" Leader key bindings {
    " quick jump through buffer
    nmap <leader>b :ls<CR>:buffer<SPACE>

    " insert current date (mostly used for the journal)
    map <leader>cd "=strftime("%Y-%m-%d")<CR>p
    map <leader>ct "=strftime("%c")<CR>p

    " <c-l> to remove highlighting of hlsearch
    if maparg('<C-L>', 'n') ==# ''
        nnoremap <silent> <C-L> :nohlsearch<C-R>=has('diff')?'<Bar>diffupdate':''<CR><CR><C-L>
    endif

    " Vim-FZF settings
    set runtimepath+=/usr/local/opt/fzf
    map <leader>fb  :Buffers<CR>
    map <leader>fp  :FZF<CR>
    map <leader>ft  :BTags<CR>
    map <leader>fm  :Marks<CR>
    " Search for vimwiki files
    map <leader>fd  :Files ~/Dropbox/wiki<CR>

    " tsuquyomi mappings
    " disable <c-^> mapping for references
    nmap <Space><C-]> <Plug>(TsuquyomiReferences)

    " Goyo settings
    map <leader>gy :Goyo<CR>

    " shortcuts for folding levels
    nmap <leader>z0 :set foldlevel=0<CR>
    nmap <leader>z1 :set foldlevel=1<CR>
    nmap <leader>z2 :set foldlevel=2<CR>
    nmap <leader>z3 :set foldlevel=3<CR>
    nmap <leader>z9 :set foldlevel=999<CR>

    " ALE custom map
    nmap <leader>ln :ALENext<CR>
    nmap <leader>lp :ALEPrevious<CR>
"" }

