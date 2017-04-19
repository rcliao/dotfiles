"" https://github.com/junegunn/vim-plug
call plug#begin('~/.local/share/nvim/plugged')

"" Common {
    " NERDTree for file explorer
    Plug 'scrooloose/nerdtree'
    " show git gutter (indication on what changed)
    Plug 'airblade/vim-gitgutter'
    " lightweight statusline
    Plug 'itchyny/lightline.vim'
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
    " Tagbar shows tags
    Plug 'majutsushi/tagbar'
    " Colorscheme
    Plug 'morhetz/gruvbox'
    " Git integration in vim like :Gstatus
    Plug 'tpope/vim-fugitive'
    " Easily change surrounding stuff
    Plug 'tpope/vim-surround'
    " Async Linter
    Plug 'w0rp/ale'
    " Log coding time
    Plug 'wakatime/vim-wakatime'
"" }

"" Languages {
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
"" }

"" Initialize plugin system
call plug#end()

"" General Settings {

    " Use space as leader
    let mapleader = " "
    let g:mapleader = " "

    " To get Vim default fuzzy-finder (:find)
    set path+=**
    set wildmenu

    " highlight current line
    set cursorline

    " Enable foldable
    set foldenable
    set foldlevelstart=10
    set foldnestmax=10
    set foldmethod=indent

    "" Freemarker to html
    au BufRead,BufNewFile *.ftl set filetype=html

    " Show invisibles
    set list

    " show line number
    set relativenumber
    set number

    " show line width 80
    set colorcolumn=80,120
    au FileType gitcommit set cc=50,80

    " More expected split pane behavior
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

"" }

"" Vue
autocmd FileType vue syntax sync fromstart

"" lightline
let g:lightline = {
    \ 'colorscheme': 'solarized',
    \ 'active': {
    \   'left': [ [ 'mode', 'paste' ],
    \             [ 'fugitive', 'readonly', 'filename', 'modified' ] ]
    \ },
    \ 'component': {
    \   'readonly': '%{&filetype=="help"?"":&readonly?"\ue0a2":""}',
    \   'modified': '%{&filetype=="help"?"":&modified?"+":&modifiable?"":"-"}',
    \   'fugitive': '%{exists("*fugitive#head")?"\ue0a0 ".fugitive#head():""}'
    \ },
    \ 'component_visible_condition': {
    \   'readonly': '(&filetype!="help"&& &readonly)',
    \   'modified': '(&filetype!="help"&&(&modified||!&modifiable))',
    \   'fugitive': '(exists("*fugitive#head") && ""!=fugitive#head())'
    \ },
    \ 'separator': { 'left': "\ue0b0", 'right': "\ue0b2" },
    \ 'subseparator': { 'left': "\ue0b1", 'right': "\ue0b3" }
\ }

"" Ale (linter settings)
" JavaScript
let g:ale_linters = {
    \ 'javascript': ['eslint'],
\ }

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

"" Bindings
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
map <leader>build :VimuxRunLastCommand<CR>
map <leader>tmuxc :VimuxPromptCommand<CR>
