-- Neovim 0.12+. Plugins are managed by the built-in vim.pack, so there is no
-- plugin manager to bootstrap: the first start clones everything below into
-- stdpath('data')/site/pack/core/opt and later starts just load it.
--   :lua vim.pack.update()   review and apply plugin updates
--   :lua vim.pack.del({'x'}) remove a plugin after deleting it from the list

vim.g.mapleader = ' '

-- Plugins --------------------------------------------------------------------
local gh = function(repo) return 'https://github.com/' .. repo end

vim.pack.add({
  -- the repo is literally called "vim", so give it a name worth reading
  { src = gh('nordtheme/vim'), name = 'nord' },
  -- git: gutter signs and :Git. `git review` in ~/.gitconfig drives both, via
  -- :Gdiffsplit and g:gitgutter_diff_base, so neither is swappable on its own.
  gh('airblade/vim-gitgutter'),
  gh('tpope/vim-fugitive'),
  -- fuzzy finder; the fzf binary itself comes from Homebrew
  gh('junegunn/fzf'),
  gh('junegunn/fzf.vim'),
  -- editing: cs'" / [q ]q style pairs / "." for plugin actions / extra text objects
  gh('tpope/vim-surround'),
  gh('tpope/vim-unimpaired'),
  gh('tpope/vim-repeat'),
  gh('wellle/targets.vim'),
  -- server definitions for vim.lsp.enable(); no setup() call needed
  gh('neovim/nvim-lspconfig'),
  -- parser installer. Highlighting itself is built in, see Treesitter below.
  { src = gh('nvim-treesitter/nvim-treesitter'), version = 'main' },
}, { confirm = false })

-- General --------------------------------------------------------------------
local opt = vim.opt

opt.scrolloff = 4 -- keep context visible when scrolling

opt.tabstop = 4
opt.softtabstop = 4
opt.shiftwidth = 4
opt.expandtab = true

opt.updatetime = 300 -- faster gitgutter refresh

opt.foldenable = true
opt.foldmethod = 'indent'
opt.foldlevel = 2

opt.list = true
opt.listchars = { tab = '> ', trail = '-', extends = '>', precedes = '<', nbsp = '+' }

opt.colorcolumn = { '80', '120' }

-- new panes open to the right and below
opt.splitbelow = true
opt.splitright = true

-- hide the pane split character
opt.fillchars = { vert = ' ', stl = ' ', stlnc = ' ' }

opt.complete:append('kspell')
opt.completeopt = { 'menuone', 'noselect', 'popup' }

if vim.fn.executable('rg') == 1 then
  opt.grepprg = 'rg --vimgrep'
end

-- Hand-rolled status line: buffer number, file, flags, type | line:col / total
opt.laststatus = 2
opt.statusline = '   %-2.2n  %f  %h%m%r%w%y %=  %-7.(%l:%c%V%) / %-4.L  '

local augroup = vim.api.nvim_create_augroup('dotfiles', { clear = true })
local autocmd = function(event, pattern, callback)
  vim.api.nvim_create_autocmd(event, { group = augroup, pattern = pattern, callback = callback })
end

autocmd('FileType', {
  'javascript', 'javascriptreact', 'typescript', 'typescriptreact',
  'json', 'yaml', 'css', 'html', 'lua', 'terraform', 'hcl',
}, function()
  vim.bo.tabstop = 2
  vim.bo.softtabstop = 2
  vim.bo.shiftwidth = 2
end)

autocmd('FileType', 'gitcommit', function()
  vim.wo.colorcolumn = '50,80'
  vim.wo.spell = true
end)
autocmd('FileType', 'markdown', function()
  vim.wo.colorcolumn = '80'
  vim.wo.spell = true
end)

-- Colours --------------------------------------------------------------------
-- Let the terminal background show through. Reapplied on every ColorScheme
-- event, otherwise switching schemes mid-session paints the background back.
autocmd('ColorScheme', '*', function()
  for _, group in ipairs({
    'Normal', 'NormalNC', 'VertSplit', 'WinSeparator', 'LineNr', 'SignColumn', 'EndOfBuffer',
    'GitGutterAdd', 'GitGutterChange', 'GitGutterDelete', 'GitGutterChangeDelete',
  }) do
    vim.cmd.highlight(group .. ' guibg=NONE ctermbg=NONE')
  end
end)
-- pcall: on a machine with no network the first start has no nord to load, and
-- a missing colour scheme should not take the rest of the config down with it.
pcall(vim.cmd.colorscheme, 'nord')

-- Treesitter -----------------------------------------------------------------
-- Replaces a dozen per-language syntax plugins. nvim-treesitter (main branch)
-- only installs parsers, which needs the `tree-sitter` CLI from the Brewfile;
-- install() is a no-op for parsers already present.
local parsers = {
  'bash', 'css', 'diff', 'dockerfile', 'go', 'gomod', 'gosum', 'graphql', 'hcl', 'html',
  'javascript', 'json', 'kotlin', 'lua', 'markdown', 'markdown_inline', 'proto', 'python',
  'rust', 'sql', 'terraform', 'toml', 'tsx', 'typescript', 'vim', 'vimdoc', 'yaml',
}
local ok, treesitter = pcall(require, 'nvim-treesitter')
if ok and vim.fn.executable('tree-sitter') == 1 then
  treesitter.install(parsers)
end
-- pcall: start() throws when the filetype has no parser installed, and falling
-- back to regex syntax is the right outcome there.
autocmd('FileType', '*', function(args) pcall(vim.treesitter.start, args.buf) end)

-- LSP ------------------------------------------------------------------------
-- Replaces ALE, vim-go and rust.vim. Servers come from the Brewfile; only the
-- ones actually on PATH are enabled so a machine missing one stays quiet.
for server, binary in pairs({
  ts_ls = 'typescript-language-server',
  gopls = 'gopls',
  rust_analyzer = 'rust-analyzer',
  basedpyright = 'basedpyright-langserver',
  ruff = 'ruff',
  terraformls = 'terraform-ls',
}) do
  if vim.fn.executable(binary) == 1 then
    vim.lsp.enable(server)
  end
end

-- Where the server's formatter is the ecosystem's formatter, run it on save.
-- TypeScript is deliberately absent: projects pin prettier/eslint, and ts_ls
-- formatting would fight them.
local format_on_save = { gopls = true, rust_analyzer = true, ruff = true, terraformls = true }

autocmd('LspAttach', '*', function(args)
  local client = assert(vim.lsp.get_client_by_id(args.data.client_id))
  if client:supports_method('textDocument/completion') then
    vim.lsp.completion.enable(true, client.id, args.buf, { autotrigger = true })
  end
  if format_on_save[client.name] and client:supports_method('textDocument/formatting') then
    vim.api.nvim_create_autocmd('BufWritePre', {
      group = augroup,
      buffer = args.buf,
      callback = function()
        vim.lsp.buf.format({ bufnr = args.buf, id = client.id, timeout_ms = 2000 })
      end,
    })
  end
end)

vim.diagnostic.config({ virtual_text = true, severity_sort = true })

-- Key bindings ---------------------------------------------------------------
-- Built in since 0.11 and worth knowing: grn rename, gra code action,
-- grr references, gri implementation, gO symbols, K hover, ]d / [d diagnostics.
local map = vim.keymap.set

map('n', '<leader>b', ':ls<CR>:buffer<Space>', { desc = 'pick buffer by number' })

map('n', '<leader>cd', function() vim.api.nvim_put({ os.date('%Y-%m-%d') }, 'c', true, true) end,
  { desc = 'insert date' })
map('n', '<leader>ct', function() vim.api.nvim_put({ os.date('%c') }, 'c', true, true) end,
  { desc = 'insert timestamp' })

map('n', '<leader>fb', '<Cmd>Buffers<CR>')
map('n', '<leader>fp', '<Cmd>Files<CR>')
map('n', '<leader>ft', '<Cmd>BTags<CR>')
map('n', '<leader>fm', '<Cmd>Marks<CR>')
map('n', '<leader>fg', '<Cmd>Rg<CR>', { desc = 'grep project' })

for _, level in ipairs({ 0, 1, 2, 3 }) do
  map('n', '<leader>z' .. level, function() vim.wo.foldlevel = level end)
end
map('n', '<leader>z9', function() vim.wo.foldlevel = 999 end)

-- same keys ALE had
map('n', '<leader>ln', function() vim.diagnostic.jump({ count = 1, float = true }) end,
  { desc = 'next diagnostic' })
map('n', '<leader>lp', function() vim.diagnostic.jump({ count = -1, float = true }) end,
  { desc = 'previous diagnostic' })
