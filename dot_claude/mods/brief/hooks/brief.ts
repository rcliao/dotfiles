// The narrative layer: the model's own status and what it waits on the person for.
// Pure functions only, so the replay eval (evals/replay) runs the same prompt and parser.
import type { Ask, AskKind, Brief, Decision } from '../types'

export const MAX_STATUS = 80
export const MAX_ASKS = 5
export const MAX_ASK = 120
export const ASK_KINDS: readonly AskKind[] = ['decision', 'approval', 'action', 'access', 'review', 'info']
/** A status older than this, while idle, shows its age. */
export const STALE_MS = 120_000
/** Other sessions' files older than this are not live (each live session rewrites its file every minute). */
export const LIVE_MS = 5 * 60_000

/** How much the band shows. */
export type BandMode = 'full' | 'min' | 'off'
export const BAND_MODES: readonly BandMode[] = ['full', 'min', 'off']

export type AskInput = { text: string; kind: AskKind }
export type DecisionInput = { text: string; alternatives?: string; reversible: boolean }
export type BriefInput = { status: string; asks: AskInput[]; decided: DecisionInput[] }
/** Open decisions kept; past that the oldest open ones fold into accepted. */
export const MAX_OPEN_DECISIONS = 12

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()
const norm = (s: string): string => clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, '')

/** The brief tool's input, checked. Errors name the limit so the model can retry. */
export const validateInput = (input: unknown): { ok: true; value: BriefInput } | { ok: false; error: string } => {
  const o = (input ?? {}) as { status?: unknown; asks?: unknown; decided?: unknown }
  if (typeof o.status !== 'string' || clean(o.status) === '') return { ok: false, error: 'status is required: one line on where the work stands' }
  const status = clean(o.status)
  if (status.length > MAX_STATUS) return { ok: false, error: `status is ${status.length} chars; keep it to ${MAX_STATUS}` }
  const raw = o.asks ?? []
  if (!Array.isArray(raw)) return { ok: false, error: 'asks must be a list (empty when you need nothing)' }
  if (raw.length > MAX_ASKS) return { ok: false, error: `${raw.length} asks; list at most ${MAX_ASKS}, the most blocking first` }
  const asks: AskInput[] = []
  for (const a of raw) {
    const item = (typeof a === 'string' ? { text: a } : (a ?? {})) as { text?: unknown; kind?: unknown }
    if (typeof item.text !== 'string' || clean(item.text) === '') return { ok: false, error: 'each ask needs text' }
    const text = clean(item.text)
    if (text.length > MAX_ASK) return { ok: false, error: `ask "${text.slice(0, 30)}…" is ${text.length} chars; keep each to ${MAX_ASK}` }
    const kind = ASK_KINDS.includes(item.kind as AskKind) ? (item.kind as AskKind) : 'decision'
    asks.push({ text, kind })
  }
  const rawDecided = o.decided ?? []
  if (!Array.isArray(rawDecided)) return { ok: false, error: 'decided must be a list (empty when you decided nothing new)' }
  if (rawDecided.length > MAX_ASKS) return { ok: false, error: `${rawDecided.length} decisions in one call; send at most ${MAX_ASKS}` }
  const decided: DecisionInput[] = []
  for (const d of rawDecided) {
    const item = (typeof d === 'string' ? { text: d } : (d ?? {})) as { text?: unknown; alternatives?: unknown; reversible?: unknown }
    if (typeof item.text !== 'string' || clean(item.text) === '') return { ok: false, error: 'each decision needs text: what you chose' }
    const text = clean(item.text)
    if (text.length > MAX_ASK) return { ok: false, error: `decision "${text.slice(0, 30)}…" is ${text.length} chars; keep each to ${MAX_ASK}` }
    const alt = typeof item.alternatives === 'string' && clean(item.alternatives) !== '' ? fit(clean(item.alternatives), MAX_ASK) : undefined
    decided.push(alt === undefined ? { text, reversible: item.reversible !== false } : { text, alternatives: alt, reversible: item.reversible !== false })
  }
  return { ok: true, value: { status, asks, decided } }
}

/** The whole list replaces the old one; an ask whose text is unchanged keeps its age. */
export const mergeAsks = (prev: readonly Ask[] | undefined, next: readonly AskInput[], now: number): Ask[] =>
  next.map(a => ({ ...a, since: (prev ?? []).find(p => norm(p.text) === norm(a.text))?.since ?? now }))

/** New decisions join the queue (an open one with the same text is not repeated); numbers only grow. */
export const appendDecisions = (prev: readonly Decision[] | undefined, add: readonly DecisionInput[], now: number): Decision[] => {
  const list = [...(prev ?? [])]
  let n = list.reduce((m, d) => Math.max(m, d.n), 0)
  for (const d of add) {
    if (list.some(x => x.status === 'open' && norm(x.text) === norm(d.text))) continue
    list.push({ ...d, n: ++n, at: now, status: 'open' })
  }
  const open = list.filter(d => d.status === 'open')
  const overflow = new Set(open.slice(0, Math.max(0, open.length - MAX_OPEN_DECISIONS)).map(d => d.n))
  return list.map(d => (overflow.has(d.n) ? { ...d, status: 'accepted' as const } : d)).slice(-40)
}

export const openDecisions = (list: readonly Decision[] | undefined): Decision[] => (list ?? []).filter(d => d.status === 'open')

export const nextBrief = (prev: Brief | null | undefined, input: BriefInput, source: Brief['source'], now: number): Brief => ({
  status: input.status,
  asks: mergeAsks(prev?.asks, input.asks, now),
  source,
  at: now,
})

export const glyph = (brief: Brief | null | undefined, isWorking: boolean): string =>
  isWorking ? '◐' : (brief?.asks.length ?? 0) > 0 ? '⚠' : '✓'

const ago = (ms: number): string => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : `${Math.round(ms / 3_600_000)}h`)

const fit = (s: string, width: number): string => (s.length <= width ? s : `${s.slice(0, Math.max(1, width - 1))}…`)

export type GlanceRow = { key: string; text: string; tone: 'status' | 'age' | 'ask' | 'ask-seen' | 'decided' }

/**
 * The two glance rows: status, then what the session needs from the person.
 * Asks written before the person's last prompt draw dim ("ask-seen"): they may be answered.
 */
export const glanceRows = (
  brief: Brief | null | undefined,
  isWorking: boolean,
  now: number,
  columns: number,
  lastPromptAt = 0,
  decisions: readonly Decision[] = [],
): GlanceRow[] => {
  if (brief === null || brief === undefined) return []
  const age = !isWorking && now - brief.at > STALE_MS ? `  ${ago(now - brief.at)} ago` : ''
  const rows: GlanceRow[] = [{ key: 'status', text: fit(`${glyph(brief, isWorking)} ${brief.status}`, columns - age.length), tone: 'status' }]
  if (age !== '') rows.push({ key: 'age', text: age, tone: 'age' })
  if (brief.asks.length > 0) {
    const head = `needs you (${brief.asks.length}): `
    rows.push({
      key: 'asks',
      text: fit(head + brief.asks.map(a => a.text).join(' · '), columns),
      tone: brief.at < lastPromptAt ? 'ask-seen' : 'ask',
    })
  }
  const open = openDecisions(decisions)
  if (open.length > 0) {
    const head = `decided for you (${open.length}): `
    const tail = '  /brief ok · /brief change N …'
    rows.push({ key: 'decided', text: fit(head + open.map(d => `${d.n}. ${d.text}`).join(' · ') + tail, columns), tone: 'decided' })
  }
  return rows
}

export const decisionsMarkdown = (decisions: readonly Decision[] | undefined): string[] => {
  const open = openDecisions(decisions)
  if (open.length === 0) return []
  return ['Decided for you (change if wrong; /brief ok [N] accepts, /brief change N <answer> sends Claude the change):', ...open.map(d => `${d.n}. ${d.text}${d.alternatives === undefined ? '' : `  (instead of: ${d.alternatives})`}${d.reversible ? '' : '  [costly to undo]'}`)]
}

export const briefMarkdown = (brief: Brief | null | undefined, now: number, decisions: readonly Decision[] = []): string => {
  if (brief === null || brief === undefined) return ['### Status\nNo brief yet.', ...decisionsMarkdown(decisions)].join('\n')
  const lines = [`### Status\n${brief.status}  (${brief.source === 'tool' ? 'from Claude' : 'summarized at turn end'}, ${ago(now - brief.at)} ago)`]
  lines.push('### Blocked on me')
  if (brief.asks.length === 0) lines.push('nothing')
  for (const a of brief.asks) lines.push(`- [${a.kind}] ${a.text}  (open ${ago(now - a.since)})`)
  lines.push(...decisionsMarkdown(decisions))
  return lines.join('\n')
}

// --- TurnFallback: haiku summarizes a turn's final answer when the model skipped the tool ---

export const FALLBACK_MAX_ANSWER = 6_000

export const SUMMARIZE_SYSTEM = `You keep a glance view for a developer who runs many coding-agent sessions at once and checks each one for a few seconds. Read the agent's latest message and reply with JSON only:
{"status": "<one line>", "asks": [{"text": "<one line>", "kind": "decision|approval|action|access|review|info"}]}

status: under 70 characters (count them). Where the work stands right now, concretely: what is done, what is next, or what it is waiting on. No filler ("Working on the task"), no praise.

asks: what the agent is waiting on the developer for before it goes on: a question it asked, a choice between options, approval for a risky or outward action (push, merge, deploy, delete, spend), a step it handed to the developer to do (merge a PR, sign in, change a setting and retry, run a command: kind action), a credential or access, a review it asked for.
- How the message closes counts: when it ends by proposing the next step and waiting for a go ("Shall I go ahead?", "Say the word if you want me to commit it", "If you want, I can write the one-pager and start on #1–#3", "Want me to file those?"), that is an ask ("Say whether to commit the config change").
- Skip asides: options mentioned in passing ("a cheaper option is…"), offers in the middle of the message, contingencies ("if X is missing, we could…"), and steps that wait on nobody (a later apply, a deploy that follows a merge).
- One ask per decision: if one reply settles several items (run the script and approve its spend), write one ask.
- Each at most ${MAX_ASK} characters, starting with a verb, naming the exact options or the exact thing, the agent's recommended option first ("Pick key name: timeoutMs (recommended) or requestTimeoutMs", "Approve force-push to feat/x").
- A "Blocked on me: nothing" section, or a message that needs nothing, gives []. At most ${MAX_ASKS}, most blocking first.

The new message is the source of truth. A previous glance view, if given, only helps you word things: keep a previous ask only if the new message still treats it as open. Drop every previous ask the new message does not raise again.`

export const summarizePrompt = (prev: Brief | null | undefined, answer: string): string => {
  const body = answer.length > FALLBACK_MAX_ANSWER ? `…${answer.slice(-FALLBACK_MAX_ANSWER)}` : answer
  const before =
    prev === null || prev === undefined
      ? 'Previous glance view: none.'
      : `Previous glance view: ${JSON.stringify({ status: prev.status, asks: prev.asks.map(a => ({ text: a.text, kind: a.kind })) })}`
  return `${before}\n\nThe agent's latest message:\n<message>\n${body}\n</message>`
}

/** The reply's JSON, held to the tool's limits (clamped, not refused); undefined when there is none. */
export const parseSummary = (reply: string): BriefInput | undefined => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let o: { status?: unknown; asks?: unknown }
  try {
    o = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof o.status !== 'string' || clean(o.status) === '') return undefined
  const asks = (Array.isArray(o.asks) ? o.asks : [])
    .map(a => (typeof a === 'string' ? { text: a } : (a ?? {})) as { text?: unknown; kind?: unknown })
    .filter(a => typeof a.text === 'string' && clean(a.text) !== '')
    .slice(0, MAX_ASKS)
    .map(a => ({
      text: fit(clean(a.text as string), MAX_ASK),
      kind: ASK_KINDS.includes(a.kind as AskKind) ? (a.kind as AskKind) : ('decision' as AskKind),
    }))
  return { status: fit(clean(o.status), MAX_STATUS), asks, decided: [] }
}

// --- SessionFile / AllView ---

export type SessionRecord = {
  sessionId: string
  label: string
  cwd: string
  status: string
  asks: { text: string; kind: AskKind; since: number }[]
  isWorking: boolean
  /** when the session last wrote this file (heartbeat) */
  at: number
  /** when the brief itself was written */
  briefAt?: number
}

export const allViewRows = (records: readonly SessionRecord[], self: string, now: number): SessionRecord[] =>
  records
    .filter(r => now - r.at < LIVE_MS)
    .sort((a, b) => b.asks.length - a.asks.length || (a.sessionId === self ? 1 : 0) - (b.sessionId === self ? 1 : 0) || b.at - a.at)

export const allViewText = (records: readonly SessionRecord[], self: string, now: number): string => {
  const rows = allViewRows(records, self, now)
  if (rows.length === 0) return 'No live sessions with a brief.'
  return rows
    .map(r => {
      const head = `${r.isWorking ? '◐' : r.asks.length > 0 ? '⚠' : '✓'} ${r.label}${r.sessionId === self ? ' (this)' : ''}  ${r.status}  · ${ago(now - (r.briefAt ?? r.at))} ago`
      return [head, ...r.asks.map(a => `    needs you: ${a.text}`)].join('\n')
    })
    .join('\n')
}
