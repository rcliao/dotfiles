// Pure helpers: classify tool calls into ledger entries and format the ledger. No `$`.
import type { CtxLimits, CtxSample, LedgerEntry, LedgerKind, TurnSample } from '../types'

export const MAX_ENTRIES = 300
export const MAX_SAMPLES = 60
export const CTX_WARN = 70
export const CTX_HOT = 85

const firstMatch = (re: RegExp, text: string): string | undefined => re.exec(text)?.[1]

// One Bash command can do several things (`git commit … && git push`), so return a list.
// Called on errored commands too: a chain can fail after its commit or charge already landed,
// so anything outward is recorded only on evidence in the output (SHA, PR url, "Paid", "[new tag]").
export const classifyBash = (command: string, output: string, at: number, isError = false): LedgerEntry[] => {
  const out: LedgerEntry[] = []
  const add = (kind: LedgerKind, label: string, detail?: string) =>
    out.push(detail === undefined ? { kind, label, at } : { kind, label, at, detail })
  // Each command of a chain, so a flag or token is read only from the command it belongs to.
  const segments = command.split(/&&|\|\||;|\|/).map(seg => seg.trim())
  const has = (re: RegExp) => segments.some(seg => re.test(seg))
  const seg = (re: RegExp) => segments.find(x => re.test(x))

  if (has(/^git\b.*\bcommit\b/)) {
    for (const m of output.matchAll(/\[[^\]\s]+(?: \([^)]*\))? ([0-9a-f]{7,40})\]/g)) if (m[1]) add('commit', m[1])
  }
  if (has(/^gh pr create\b/)) {
    const url = firstMatch(/(https:\/\/github\.com\/\S+\/pull\/\d+)/, output)
    if (url !== undefined) add('pr', `PR #${url.split('/').pop()}`, url)
  }

  const push = seg(/^git push\b/)
  if (push !== undefined) {
    const tags = [...output.matchAll(/\* \[new tag\]\s+(\S+)/g)].map(m => m[1] ?? '')
    for (const tag of tags) add('tag', tag)
    const isForced = /\(forced update\)/.test(output) || /(--force\b|--force-with-lease\b|\s-f\b)/.test(push)
    const branch = firstMatch(/(?:\* \[new branch\]|[0-9a-f]+\.\.\.?[0-9a-f]+)\s+\S+\s+->\s+(\S+)/, output)
    if (branch !== undefined) add(isForced ? 'force-push' : 'push', branch)
  }

  // A payment CLI's own receipt line. Commands that only display text (grep, cat, echo…) can print one too.
  const isDisplayOnly = has(/^(grep|rg|cat|bat|sed|awk|head|tail|less|echo|printf|jq)\b/)
  if (!isDisplayOnly) for (const m of output.matchAll(/^Paid ([\d.]+ [A-Z][A-Z0-9]{1,9}) via \S+/gm)) add('paid', `${m[1]}${isError ? ' (call errored)' : ''}`)
  // Live finding: inline scripts (heredocs, python -, node -e) carry these commands as text,
  // so kinds with no output evidence are recorded only for real, successful commands.
  if (isError || /<<|\bpython3? -|\bnode -e\b|\bcat >/.test(command)) return out
  if (has(/^tempo request\b/)) add('paid', 'tempo request')

  const merged = seg(/^gh pr merge\b/)
  if (merged !== undefined && /merged pull request/i.test(output)) add('merge', `merge${firstMatch(/merge\s+#?(\d+)/, merged)?.replace(/^/, ' #') ?? ''}`)
  const commented = /^gh (pr|issue) (comment|review)\b\s*#?(\d+)?/.exec(seg(/^gh (pr|issue) (comment|review)\b/) ?? '')
  if (commented && /#(issuecomment|pullrequestreview)-\d+/.test(output)) add('comment', `gh ${commented[1]} ${commented[2]}${commented[3] ? ` #${commented[3]}` : ''}`)
  const published = firstMatch(/^\+ (\S+@\d\S*)/m, output)
  if (has(/^(npm|pnpm|yarn) publish\b/) && published !== undefined) add('publish', published)
  const deploy = seg(/^(wrangler (deploy|publish)|gcloud functions deploy|render deploy|kubectl apply)\b/)
  if (deploy !== undefined) add('deploy', deploy.split(/\s+/).slice(0, 3).join(' '))
  const secret = seg(/^doppler secrets set\b.*(-c|--config)[ =]prd\b/)
  if (secret !== undefined) add('prod-secret', `doppler prd: ${firstMatch(/\s([A-Z][A-Z0-9_]+)=/, secret) ?? 'secret'}`)
  return out
}

const MCP_KINDS: ReadonlyArray<[RegExp, LedgerKind]> = [
  [/^mcp__linear-server__(save_issue|save_comment|save_status_update|save_document|save_project)$/, 'linear'],
  [/^mcp__plugin_slack_slack__slack_(send_message|schedule_message|update_canvas|create_canvas)$/, 'slack'],
  [/^mcp__notion__notion-(create-pages|update-page|create-comment)$/, 'notion'],
]

export const classifyMcp = (tool: string, at: number): LedgerEntry | undefined => {
  for (const [re, kind] of MCP_KINDS) {
    if (re.test(tool)) return { kind, label: tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, ''), at }
  }
  return undefined
}

export const FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export const appendEntries = (prev: readonly LedgerEntry[] | undefined, add: readonly LedgerEntry[]) => {
  const next = [...(prev ?? [])]
  for (const entry of add) {
    if (entry.kind === 'file' && next.some(x => x.kind === 'file' && x.label === entry.label)) continue
    next.push(entry)
  }
  return next.slice(-MAX_ENTRIES)
}

export const appendSample = (prev: readonly CtxSample[] | undefined, s: CtxSample) => {
  const list = [...(prev ?? [])]
  const last = list[list.length - 1]
  // Keep one sample per whole-percent change; refresh cost on the last one otherwise.
  if (last !== undefined && last.percent === s.percent) list[list.length - 1] = { ...last, usd: s.usd, at: s.at }
  else list.push(s)
  return list.slice(-MAX_SAMPLES)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const countBy = (entries: readonly LedgerEntry[]) => {
  const counts = new Map<LedgerKind, number>()
  for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  return counts
}

export const OUTWARD: ReadonlySet<LedgerKind> = new Set([
  'merge', 'force-push', 'tag', 'publish', 'deploy', 'paid', 'comment', 'linear', 'slack', 'notion', 'prod-secret',
])

export const MAX_TURNS = 40
// Turns-to-compact thresholds for the context figure's color.
export const TURNS_WARN = 15
export const TURNS_HOT = 5

export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${Number((n / 1_000_000).toFixed(1))}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const appendTurn = (prev: readonly TurnSample[] | undefined, t: TurnSample) => [...(prev ?? []), t].slice(-MAX_TURNS)

// Mean growth over the last 5 turns since the last compaction (a drop starts the series over).
export const growthPerTurn = (turns: readonly TurnSample[]): number | undefined => {
  let start = 0
  for (let i = 1; i < turns.length; i++) if ((turns[i]?.tokens ?? 0) < (turns[i - 1]?.tokens ?? 0)) start = i
  const since = turns.slice(start).slice(-6)
  if (since.length < 2) return undefined
  const first = since[0]
  const last = since[since.length - 1]
  if (first === undefined || last === undefined) return undefined
  return Math.max(0, (last.tokens - first.tokens) / (since.length - 1))
}

export type CtxView = { text: string; level: 'ok' | 'warn' | 'hot' }

export const ctxView = (
  samples: readonly CtxSample[],
  turns: readonly TurnSample[],
  limits: CtxLimits | null,
): CtxView | undefined => {
  const last = samples[samples.length - 1]
  if (last === undefined) return undefined
  const window = limits?.window
  const parts = [window ? `ctx ${fmtTokens(last.tokens)}/${fmtTokens(window)}  ${last.percent}%` : `ctx ${last.percent}%`]
  const growth = growthPerTurn(turns)
  let level: CtxView['level'] = last.percent >= CTX_HOT ? 'hot' : last.percent >= CTX_WARN ? 'warn' : 'ok'
  if (growth !== undefined && growth > 0) {
    parts.push(`+${fmtTokens(Math.round(growth))}/turn`)
    const limit = limits?.isAutoCompact && limits.threshold ? limits.threshold : window
    if (limit !== undefined) {
      const left = Math.max(0, Math.floor((limit - last.tokens) / growth))
      parts.push(`~${left} turns to ${limits?.isAutoCompact && limits.threshold ? 'compact' : 'full'}`)
      level = left <= TURNS_HOT ? 'hot' : left <= TURNS_WARN ? 'warn' : level
    }
  }
  // Cost stays in /ledger: not worth a constant place in the band.
  return { text: parts.join('  '), level }
}

const NOTABLE: Partial<Record<LedgerKind, (label: string) => string>> = {
  pr: l => l,
  merge: l => l,
  tag: l => l,
  'force-push': l => `force-push ${l}`,
  publish: l => `published ${l}`,
  deploy: () => 'deploy',
  // paid: kept in /ledger only, too routine for the band
  comment: l => l,
  linear: () => 'linear write',
  slack: () => 'slack message',
  notion: () => 'notion write',
  'prod-secret': l => l,
}

// The rest of the band: the latest outward actions by name, then files edited. Failures stay in /ledger.
export const summaryLine = (entries: readonly LedgerEntry[]): string => {
  const named = entries.flatMap(e => {
    const f = NOTABLE[e.kind]
    return f === undefined ? [] : [f(e.label)]
  })
  const parts: string[] = []
  if (named.length > 0) parts.push(named.slice(-3).reverse().join(' · ') + (named.length > 3 ? ` +${named.length - 3}` : ''))
  const files = countBy(entries).get('file') ?? 0
  if (files > 0) parts.push(plural(files, 'file'))
  return parts.join('   ')
}

const LABELS: Record<LedgerKind, string> = {
  pr: 'PRs opened',
  merge: 'PRs merged',
  commit: 'Commits',
  push: 'Pushes',
  'force-push': 'Force pushes',
  tag: 'Tags pushed',
  publish: 'Packages published',
  deploy: 'Deploys',
  paid: 'Paid calls',
  comment: 'GitHub comments/reviews',
  linear: 'Linear writes',
  slack: 'Slack writes',
  notion: 'Notion writes',
  'prod-secret': 'Prod secret writes',
  file: 'Files edited',
}

const section = (title: string, kinds: readonly LedgerKind[], entries: readonly LedgerEntry[]) => {
  const lines: string[] = []
  for (const kind of kinds) {
    const of = entries.filter(e => e.kind === kind)
    if (of.length === 0) continue
    const items = of.map(e => (e.detail ? `${e.label} (${e.detail})` : e.label))
    lines.push(`- ${LABELS[kind]} (${of.length}): ${items.slice(-12).join(', ')}${of.length > 12 ? ', …' : ''}`)
  }
  return lines.length === 0 ? [] : [`### ${title}`, ...lines, '']
}

export const ledgerMarkdown = (
  entries: readonly LedgerEntry[],
  samples: readonly CtxSample[],
  fails: number,
  turns: readonly TurnSample[] = [],
  limits: CtxLimits | null = null,
) => {
  const last = samples[samples.length - 1]
  const peak = samples.reduce((m, s) => Math.max(m, s.percent), 0)
  const ctx =
    last === undefined
      ? ['Context: no API response yet this window.']
      : [
          `Context: ${last.percent}% (${Math.round(last.tokens / 1000)}k tokens), peak ${peak}%` +
            (last.usd === undefined ? '' : `, session cost $${last.usd.toFixed(2)}`),
          `Outlook: ${ctxView(samples, turns, limits)?.text ?? 'n/a'}`,
        ]
  const body = [
    ...section('Changed', ['pr', 'commit', 'push', 'file'], entries),
    ...section('Outward-facing', ['merge', 'tag', 'force-push', 'publish', 'deploy', 'comment', 'linear', 'slack', 'notion', 'prod-secret', 'paid'], entries),
  ]
  return [
    '## Run ledger',
    ...ctx,
    '',
    ...(body.length === 0 ? ['Nothing changed or sent out yet.', ''] : body),
    `Failed Bash calls: ${fails}`,
  ].join('\n')
}
