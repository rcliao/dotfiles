import type { Channel, Recall, TraceRow, Verdict } from '../types'

// Ghost keys are kebab/snake slugs, sometimes with ':' or '.'; the hook headers
// ("[Ghost Memory — Relevant]", "[End Ghost Memory]") contain spaces and never match.
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const LINE = /^\[([^\]]+)\] (.+)$/

// Tokens specific enough that seeing one in the agent's own output means the
// memory's content was acted on, not just that the topic came up.
const TOKEN_PATTERNS = [
  /[\w./-]*\w\.(?:go|tsx?|jsx?|mjs|cjs|md|sh|json|ya?ml|sql|py|rs|toml|css|html|env|Dockerfile)\b/g, // file names and paths
  /--[a-z][\w-]{2,}/g, // CLI flags
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/g, // ENV_VARS
  /\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g, // camelCase
  /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g, // PascalCase
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, // snake_case
]

/** Distinct identifier-like tokens in a memory body, at most 40. */
export function distinctiveTokens(text: string): string[] {
  const found = new Set<string>()
  for (const pattern of TOKEN_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      if (m[0].length >= 5) found.add(m[0])
      if (found.size >= 40) return [...found]
    }
  }
  return [...found]
}

export type Injected = { key: string; content: string; score?: number; via?: string }

/** The channel a ghost hook's injected block came from, by its header; undefined when it is not ghost's. */
export function hookChannel(text: string): Channel | undefined {
  if (text.includes('[Ghost Memory — Session Start]')) return 'session-start'
  if (text.includes('[Ghost Memory — Relevant]')) return 'prompt'
  return undefined
}

/** `[key] content` lines from a ghost hook's injected text. */
export function parseInjected(text: string): Injected[] {
  const out: Injected[] = []
  for (const line of text.split('\n')) {
    const m = LINE.exec(line.trim())
    const key = m?.[1]
    if (key === undefined || !KEY.test(key)) continue
    out.push({ key, content: m?.[2] ?? '' })
  }
  return out
}

/** Memories in a ghost_context / ghost_search tool result (JSON). */
export function parseToolMemories(text: string): (Injected & { ns?: string })[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { memories?: unknown })?.memories)
      ? (parsed as { memories: unknown[] }).memories
      : []
  const out: (Injected & { ns?: string })[] = []
  for (const item of list) {
    const m = item as { key?: unknown; content?: unknown; ns?: unknown; score?: unknown; via?: unknown }
    if (typeof m.key !== 'string' || !KEY.test(m.key)) continue
    out.push({
      key: m.key,
      content: typeof m.content === 'string' ? m.content : '',
      ns: typeof m.ns === 'string' ? m.ns : undefined,
      score: typeof m.score === 'number' ? m.score : undefined,
      via: typeof m.via === 'string' ? m.via : undefined,
    })
  }
  return out
}

export function newRecall(i: Injected, ns: string, channel: Channel, turn: number, at: number): Recall {
  return {
    key: i.key,
    ns,
    channel,
    snippet: (i.content.split('\n')[0] ?? '').slice(0, 160),
    content: i.content.slice(0, 800),
    tokens: distinctiveTokens(i.content),
    score: i.score,
    via: i.via,
    tok: Math.ceil(i.content.length / 4),
    shownTurn: turn,
    shownAt: at,
    verdict: 'pending',
  }
}

/**
 * Adds recalls not already tracked (same ns+key), keeping the first sighting.
 * A `prior` row (loaded from the log on resume) is an earlier exposure: when
 * ghost injects that memory again it is replaced, so the new exposure is judged.
 */
export function addRecalls(prev: Recall[], next: Recall[]): Recall[] {
  const id = (r: Recall): string => `${r.ns}\u0000${r.key}`
  const incoming = new Map<string, Recall>()
  for (const r of next) if (!incoming.has(id(r))) incoming.set(id(r), r)
  let changed = false
  const kept = prev.filter(r => {
    if (!incoming.has(id(r))) return true
    if (r.prior === true) {
      changed = true
      return false // replaced below by the fresh sighting
    }
    incoming.delete(id(r)) // already tracked this session: first sighting wins
    return true
  })
  if (incoming.size === 0 && !changed) return prev
  return [...kept, ...incoming.values()].slice(-500)
}

export type TurnEvidence = {
  /** What the agent wrote and did this turn: final answer plus tool inputs. */
  corpus: string
  /** What the person typed; tokens shared with it prove nothing (retrieval matched on them). */
  prompt: string
  /** Keys the agent fetched directly with ghost_get / ghost_expand. */
  fetched: Set<string>
}

const KEY_CHAR = '[A-Za-z0-9_.:-]'

/** The key as a whole token: "auth" does not match "author", "ghost" not "mcp__ghost__ghost_get". */
export function mentionsKey(corpus: string, key: string): boolean {
  if (key.length < 6) return false
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<!${KEY_CHAR})${escaped}(?!${KEY_CHAR}*[A-Za-z0-9])`).test(corpus)
}

/** Tool inputs that are about ghost itself (curate, edge, put, ...) name keys without using them. */
export function isGhostTool(tool: string): boolean {
  return tool.startsWith('mcp__ghost__')
}

/** A tool call's own arguments as evidence text: no tool name, ids or loop ids. */
export function inputText(input: Record<string, unknown>): string {
  const { tool: _tool, tool_use_id: _id, agentId: _agent, ...args } = input
  return JSON.stringify(args).slice(0, 20_000)
}

/** Why a recall counts as used this turn, or undefined. */
export function usedEvidence(r: Recall, ev: TurnEvidence): string | undefined {
  if (ev.fetched.has(r.key)) return 'fetched with ghost_get'
  if (mentionsKey(ev.corpus, r.key)) return 'key named'
  const hits = r.tokens.filter(t => ev.corpus.includes(t) && !ev.prompt.includes(t))
  if (hits.length >= 2) return `tokens: ${hits.slice(0, 3).join(', ')}`
  return undefined
}

/**
 * Judges pending recalls at the end of main-loop turn `turn`. Prompt and
 * explicit recalls get the turn they were shown plus one more; session-start
 * recalls stay pending until used or the session ends.
 */
export function judge(recalls: Recall[], ev: TurnEvidence, turn: number): { recalls: Recall[]; changed: Recall[] } {
  const changed: Recall[] = []
  const out = recalls.map(r => {
    // Prior rows belong to an earlier process: no tokens kept, no turn of this one to judge against.
    if (r.verdict !== 'pending' || r.prior === true) return r
    const why = usedEvidence(r, ev)
    if (why !== undefined) {
      const done = { ...r, verdict: 'used' as const, evidence: why, judgedTurn: turn }
      changed.push(done)
      return done
    }
    if (r.channel !== 'session-start' && turn - r.shownTurn >= 1) {
      const done = { ...r, verdict: 'unused' as const, judgedTurn: turn }
      changed.push(done)
      return done
    }
    return r
  })
  return { recalls: changed.length === 0 ? recalls : out, changed }
}

/** At session end every recall still pending is unused. */
export function closeOut(recalls: Recall[]): Recall[] {
  return recalls.map(r => (r.verdict === 'pending' ? { ...r, verdict: 'unused' as const } : r))
}

export type Summary = {
  recalled: number
  used: number
  unused: number
  pending: number
  /** Auto verdicts the person confirmed, out of those they reviewed. */
  agreed: number
  reviewed: number
  /** Estimated context tokens all recalls cost, and the part spent on unused ones. */
  tok: number
  wastedTok: number
  stale: number
  risky: number
}

/** The verdict that counts: the person's correction over the mod's own. */
export function finalVerdict(r: Recall): Verdict {
  return r.corrected ?? r.verdict
}

export function summarize(recalls: Recall[]): Summary {
  const s: Summary = { recalled: recalls.length, used: 0, unused: 0, pending: 0, agreed: 0, reviewed: 0, tok: 0, wastedTok: 0, stale: 0, risky: 0 }
  for (const r of recalls) {
    const v = finalVerdict(r)
    s[v] += 1
    // Recalls kept in $.state from v0.1 (before token estimates) have no tok.
    const tok = r.tok ?? 0
    s.tok += tok
    if (v === 'unused') s.wastedTok += tok
    if ((r.stale?.length ?? 0) > 0) s.stale += 1
    if (r.risk !== undefined) s.risky += 1
    if (r.corrected !== undefined && r.verdict !== 'pending') {
      s.reviewed += 1
      if (r.corrected === r.verdict) s.agreed += 1
    }
  }
  return s
}

export function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export function statusText(s: Summary): string | undefined {
  if (s.recalled === 0) return undefined
  const extra = [s.stale > 0 ? `${s.stale} stale` : '', s.risky > 0 ? `${s.risky} to check` : ''].filter(x => x !== '')
  return [`ghost ${s.recalled} in`, `${s.used} used`, ...extra, `${fmtTok(s.tok)} tok`].join(' · ')
}

// ---- Hook trace (/tmp/ghost-trace-<session>.jsonl, written by the ghost hooks) ----

type TraceMemory = { key?: unknown; score?: unknown; tok?: unknown; via?: unknown }
type TraceEvent = {
  at?: unknown
  hook?: unknown
  outcome?: unknown
  reason?: unknown
  query?: unknown
  floor?: unknown
  injected?: unknown
  injected_tok?: unknown
  phases?: { memories?: TraceMemory[]; budget?: unknown; used?: unknown }[]
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Trace rows from the lines past `seen`; a partial last line waits for the next read. */
export function parseTrace(text: string, seen: number, turn: number): { rows: TraceRow[]; seen: number } {
  const lines = text.split('\n')
  // The last element is '' after a trailing newline, or a line still being written.
  const complete = lines.length - 1
  // Fewer lines than already read: a new file (new session id after /clear, or /tmp cleaned).
  const from = seen > complete ? 0 : seen
  const rows: TraceRow[] = []
  for (let i = from; i < complete; i++) {
    let ev: TraceEvent
    try {
      ev = JSON.parse(lines[i] ?? '') as TraceEvent
    } catch {
      continue
    }
    const byKey = new Map<string, { score?: number; tok: number; via?: string }>()
    for (const phase of ev.phases ?? []) {
      for (const m of phase.memories ?? []) {
        if (typeof m.key !== 'string' || byKey.has(m.key)) continue
        byKey.set(m.key, {
          score: typeof m.score === 'number' ? m.score : undefined,
          tok: typeof m.tok === 'number' ? m.tok : 0,
          via: typeof m.via === 'string' ? m.via : undefined,
        })
      }
    }
    const keys = Array.isArray(ev.injected) ? ev.injected.filter((k): k is string => typeof k === 'string') : []
    const injected = keys.map(key => ({ key, score: byKey.get(key)?.score, tok: byKey.get(key)?.tok ?? 0, via: byKey.get(key)?.via }))
    rows.push({
      at: typeof ev.at === 'string' ? ev.at : '',
      turn,
      hook: typeof ev.hook === 'string' ? ev.hook : '?',
      outcome: typeof ev.outcome === 'string' ? ev.outcome : '?',
      reason: typeof ev.reason === 'string' ? ev.reason : undefined,
      query: typeof ev.query === 'string' ? ev.query : '',
      floor: typeof ev.floor === 'number' ? ev.floor : undefined,
      injected,
      tok: typeof ev.injected_tok === 'number' ? ev.injected_tok : injected.reduce((n, i) => n + i.tok, 0),
      budget: (ev.phases ?? []).reduce((n, p) => n + num(p.budget), 0),
      used: (ev.phases ?? []).reduce((n, p) => n + num(p.used), 0),
    })
  }
  return { rows, seen: complete }
}

/** Where ghost's tokens went this session, by channel, against the prompt hook's session cap. */
export type Ledger = {
  start: number
  prompt: number
  explicit: number
  total: number
  /** The prompt hook's GHOST_SESSION_TOKEN_CAP; 0 = no cap. */
  cap: number
  /** Injected tokens the agent did not use (final verdicts). */
  unused: number
}

export function ledger(traces: TraceRow[], recalls: Recall[], cap: number): Ledger {
  let start = 0
  let prompt = 0
  for (const t of traces) {
    if (t.hook === 'session-start') start += t.tok ?? 0
    else if (t.hook === 'prompt') prompt += t.tok ?? 0
  }
  const explicit = recalls.filter(r => r.channel === 'explicit').reduce((n, r) => n + (r.tok ?? 0), 0)
  const unused = recalls.filter(r => finalVerdict(r) === 'unused').reduce((n, r) => n + (r.tok ?? 0), 0)
  return { start, prompt, explicit, total: start + prompt + explicit, cap, unused }
}

/** One line: per-channel tokens, cap, share of the context window. */
export function ledgerText(l: Ledger, window?: number): string {
  const share = window !== undefined && window > 0 ? ` (${((l.total / window) * 100).toFixed(1)}% of context)` : ''
  const promptPart = l.cap > 0 ? `prompt ${fmtTok(l.prompt)}/${fmtTok(l.cap)} cap` : `prompt ${fmtTok(l.prompt)}`
  return `tokens: start ${fmtTok(l.start)} · ${promptPart} · ask ${fmtTok(l.explicit)} · total ${fmtTok(l.total)}${share} · unused ${fmtTok(l.unused)}`
}

/** Fills score, tokens, floor and query on recalls the trace explains. */
export function enrich(recalls: Recall[], rows: TraceRow[]): Recall[] {
  const info = new Map<string, { score?: number; tok: number; floor?: number; query: string; via?: string }>()
  for (const row of rows) for (const i of row.injected) info.set(i.key, { score: i.score, tok: i.tok, floor: row.floor, query: row.query, via: i.via })
  if (info.size === 0) return recalls
  return recalls.map(r => {
    const i = r.channel === 'explicit' ? undefined : info.get(r.key)
    if (i === undefined || r.query !== undefined) return r
    return { ...r, score: i.score ?? r.score, tok: i.tok > 0 ? i.tok : r.tok, floor: i.floor, query: i.query, via: i.via ?? r.via }
  })
}

/** Loaded although it scored under the floor: it came in by an edge or the relevance rescue. */
export function belowFloor(r: { score?: number; floor?: number }): boolean {
  return r.score !== undefined && r.floor !== undefined && r.score < r.floor
}

export function shortKey(key: string, max: number): string {
  return key.length <= max ? key : `${key.slice(0, Math.max(1, max - 1))}…`
}

/** The band's lines for the latest prompt-hook run. */
export function bandLines(row: TraceRow | undefined, width: number, l?: Ledger): string[] {
  if (row === undefined) return []
  // The session's running total rides at the end of the first line.
  const session = l === undefined ? '' : `  · session ${fmtTok(l.total)}${l.cap > 0 ? `, prompt ${fmtTok(l.prompt)}/${fmtTok(l.cap)}` : ''}`
  if (row.outcome === 'injected') {
    const budget = (row.budget ?? 0) > 0 ? ` of ${fmtTok(row.budget)} budget` : ''
    const head = `ghost  loaded ${row.injected.length} for this prompt · ${fmtTok(row.tok)} tok${budget}  `
    let line = head
    for (const i of row.injected) {
      const part = `  ${i.score === undefined ? '—' : i.score.toFixed(2)} ${shortKey(i.key, 34)}`
      if (line.length + part.length + session.length > width) break
      line += part
    }
    line += session
    const under = row.injected.filter(i => belowFloor({ score: i.score, floor: row.floor }))
    const lines = [line.slice(0, width)]
    if (under.length > 0) {
      // ghost's own `via` names the path; older binaries leave it out.
      const how = (i: { via?: string }): string => (i.via !== undefined ? ` (${i.via})` : '')
      lines.push(`       ${under.length} under the ${row.floor} floor got in: ${under.map(i => `${i.score?.toFixed(2)} ${shortKey(i.key, 30)}${how(i)}`).join(', ')}`.slice(0, width))
    }
    return lines
  }
  return [`ghost  nothing loaded: ${row.reason ?? row.outcome}${session}`.slice(0, width)]
}

/**
 * Path tokens a memory names under a top-level directory that exists here,
 * as `[path, topDir]`. Paths into other repos are skipped: their top directory
 * is absent, so their absence says nothing.
 */
export function pathTokens(tokens: string[]): { path: string; top: string }[] {
  const out: { path: string; top: string }[] = []
  for (const t of tokens) {
    if (!t.includes('/') || t.startsWith('/') || t.startsWith('~') || t.includes('://')) continue
    const top = t.split('/')[0] ?? ''
    if (top === '' || top === '.' || top === '..') continue
    out.push({ path: t, top })
  }
  return out.slice(0, 8)
}

const CORRECTION = /^\s*(no\b|nope\b|wrong\b|that'?s (not|wrong)|not (that|what)|actually\b|stop\b|don'?t\b|undo\b|revert\b)/i

/** The person pushing back on the last turn. */
export function isCorrection(text: string): boolean {
  return CORRECTION.test(text)
}

/** Marks recalls judged used on `turn` for review after the person corrected that turn. */
export function flagRisk(recalls: Recall[], turn: number): Recall[] {
  let changed = false
  const out = recalls.map(r => {
    if (r.verdict !== 'used' || r.judgedTurn !== turn || r.risk !== undefined) return r
    changed = true
    return { ...r, risk: 'used, then your next prompt pushed back' }
  })
  return changed ? out : recalls
}

/**
 * Recalls back from a shadow log, for a resumed session whose $.state started
 * empty: without this the first rewrite would drop every earlier verdict.
 * The log keeps no memory text, so detail views of these show the key only.
 */
export function recallsFromLog(text: string): Recall[] {
  const out: Recall[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let v: Record<string, unknown>
    try {
      v = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (typeof v.key !== 'string' || typeof v.ns !== 'string') continue
    const channel = v.channel === 'session-start' || v.channel === 'prompt' || v.channel === 'explicit' ? v.channel : 'prompt'
    const verdict = v.verdict === 'used' || v.verdict === 'unused' ? v.verdict : 'pending'
    out.push({
      key: v.key,
      ns: v.ns,
      channel,
      snippet: '',
      content: '',
      tokens: [],
      score: typeof v.score === 'number' ? v.score : undefined,
      floor: typeof v.floor === 'number' ? v.floor : undefined,
      tok: typeof v.tok === 'number' ? v.tok : 0,
      shownTurn: 0,
      shownAt: typeof v.shownAt === 'number' ? v.shownAt : 0,
      verdict,
      evidence: typeof v.evidence === 'string' ? v.evidence : undefined,
      corrected: v.corrected === 'used' || v.corrected === 'unused' ? v.corrected : undefined,
      stale: Array.isArray(v.stale) ? v.stale.filter((s): s is string => typeof s === 'string') : undefined,
      risk: typeof v.risk === 'string' ? v.risk : undefined,
      via: typeof v.via === 'string' ? v.via : undefined,
      prior: true,
    })
  }
  return out
}

/** The shadow log: one JSON line per recall, rewritten whole on each change. */
export function logLines(session: string, recalls: Recall[]): string {
  return recalls
    .map(r =>
      JSON.stringify({
        session,
        ns: r.ns,
        key: r.key,
        channel: r.channel,
        shownAt: r.shownAt,
        score: r.score,
        floor: r.floor,
        tok: r.tok,
        verdict: r.verdict,
        evidence: r.evidence,
        via: r.via,
        corrected: r.corrected,
        stale: r.stale,
        risk: r.risk,
      }),
    )
    .join('\n')
    .concat(recalls.length > 0 ? '\n' : '')
}
