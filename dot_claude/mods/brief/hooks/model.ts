// What the agent writes (brief_ask, brief_note), what the person answers, and what each sends back.
// Pure functions only: the hooks in register.tsx hold the state and the clock.
import type { Changes, Check, DoneItem, Question, SnapLine, Step } from '../types'
import { DEFAULT_MS, mins } from './band'

export const MAX_QUESTION = 60
export const MAX_SHORT = 24
export const MAX_OPTION = 12
export const MAX_OPTIONS = 4
export const MAX_ROW = 120
export const MAX_READ_LINES = 8

export const ASK_DESCRIPTION =
  "Queue a multiple-choice question without stopping. Put your default first; it applies if they don't answer in time."

// Eval 2026-10-17: without the brief_note sentence the agent never set a goal (0/3), and without "only they can do"
// a missing credential never blocked (0/3). docs/brief-v2-eval.md.
export const RULE =
  "Brief: when you start a task, brief_note a one-line goal and 2-8 done-when checks, and brief_note met: [...] as each is met. Ask with brief_ask and keep working on option 1, your default. Block only for steps that can't be undone, that others will see, or that only they can do (a key, an account, a manual step). Questions under 60 characters, options under 12. Call brief_read before you say you're done."

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Typographic punctuation folded to ASCII, so a dash or a curly quote is not a refused call and a retry. */
export const foldAscii = (s: string): string =>
  s
    .replace(/[\u2012-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u2192/g, '->')
    .replace(/[\u00a0\u2000-\u200b\u202f]/g, ' ')

/** A list field, also when a client sent it JSON-encoded. */
const listOf = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

export type AskInput = { question: string; short: string; options: string[]; blocking: boolean }

/** brief_ask's input, checked; each error names the limit so the agent can retry. */
export const validateAsk = (input: unknown): { ok: true; value: AskInput } | { ok: false; error: string } => {
  const o = (input ?? {}) as { question?: unknown; short?: unknown; options?: unknown; blocking?: unknown }
  if (typeof o.question !== 'string' || clean(o.question) === '') return { ok: false, error: 'question is required' }
  const question = clean(foldAscii(o.question))
  if (question.length > MAX_QUESTION) return { ok: false, error: `question is ${question.length} characters; keep it to ${MAX_QUESTION}` }
  if (typeof o.short !== 'string' || clean(o.short) === '') return { ok: false, error: `short is required: the question in at most ${MAX_SHORT} characters` }
  const short = clean(foldAscii(o.short))
  if (short.length > MAX_SHORT) return { ok: false, error: `short is ${short.length} characters; keep it to ${MAX_SHORT}` }
  const raw = listOf(o.options)
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_OPTIONS) {
    return { ok: false, error: `options must be a list of 2 to ${MAX_OPTIONS} choices, your default first` }
  }
  const options: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string' || clean(x) === '') return { ok: false, error: 'each option is a non-empty string' }
    const opt = clean(foldAscii(x))
    // Eval: on a bare limit error the agent swapped its preferred choice for a shorter one. Say to shorten the label.
    if (opt.length > MAX_OPTION) {
      return { ok: false, error: `option "${opt}" is ${opt.length} characters; keep each to ${MAX_OPTION}. Keep your choice and shorten its label (put the full name in the question)` }
    }
    if (options.includes(opt)) return { ok: false, error: `option "${opt}" is listed twice` }
    options.push(opt)
  }
  const all = [question, short, ...options]
  if (!all.every(s => /^[\x20-\x7e]*$/.test(s))) return { ok: false, error: 'use plain ASCII characters in the question, short and options' }
  return { ok: true, value: { question, short, options, blocking: o.blocking === true } }
}

export type NoteInput = { goal?: string; doneWhen?: DoneItem[]; met?: string[]; assumption?: string }

/** brief_note's input. doneWhen items are strings (`[x] ` marks one met) or `{ text, met }`; `met` ticks checks by name. */
export const validateNote = (input: unknown): { ok: true; value: NoteInput } | { ok: false; error: string } => {
  const o = (input ?? {}) as { goal?: unknown; doneWhen?: unknown; met?: unknown; assumption?: unknown }
  const out: NoteInput = {}
  if (o.goal !== undefined) {
    if (typeof o.goal !== 'string' || clean(o.goal) === '') return { ok: false, error: 'goal is one line' }
    out.goal = clean(o.goal).slice(0, 80)
  }
  if (o.doneWhen !== undefined) {
    const raw = listOf(o.doneWhen)
    if (!Array.isArray(raw) || raw.length > 8) return { ok: false, error: 'doneWhen is a list of at most 8 checks' }
    const items: DoneItem[] = []
    for (const x of raw) {
      if (typeof x === 'string') {
        const m = /^\s*\[( |x|X)\]\s*(.*)$/.exec(x)
        const text = clean(m === null ? x : (m[2] as string))
        if (text !== '') items.push({ text: text.slice(0, 40), met: m !== null && m[1] !== ' ' })
      } else if (x !== null && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string') {
        const text = clean((x as { text: string }).text)
        if (text !== '') items.push({ text: text.slice(0, 40), met: (x as { met?: unknown }).met === true })
      } else return { ok: false, error: 'each doneWhen item is a string or { text, met }' }
    }
    out.doneWhen = items
  }
  if (o.met !== undefined) {
    const raw = listOf(o.met)
    const list = typeof raw === 'string' ? [raw] : raw
    if (!Array.isArray(list) || !list.every(x => typeof x === 'string')) return { ok: false, error: 'met is a list of done-when checks, by their text' }
    out.met = list.map(x => clean(x)).filter(x => x !== '')
  }
  if (o.assumption !== undefined) {
    if (typeof o.assumption !== 'string' || clean(o.assumption) === '') return { ok: false, error: 'assumption is one line' }
    out.assumption = clean(o.assumption).slice(0, MAX_ROW)
  }
  if (out.goal === undefined && out.doneWhen === undefined && out.met === undefined && out.assumption === undefined) {
    return { ok: false, error: 'give at least one of goal, doneWhen, met, assumption' }
  }
  return { ok: true, value: out }
}

const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Ticks the checks `met` names: the same text, or one containing the other, case and punctuation aside. */
export const applyMet = (items: readonly DoneItem[], met: readonly string[]): { items: DoneItem[]; unmatched: string[] } => {
  const unmatched: string[] = []
  const out = items.map(d => ({ ...d }))
  for (const m of met) {
    const k = key(m)
    const hit = out.find(d => key(d.text) === k) ?? out.find(d => k !== '' && (key(d.text).includes(k) || k.includes(key(d.text))))
    if (hit === undefined) unmatched.push(m)
    else hit.met = true
  }
  return { items: out, unmatched }
}

export const openQuestions = (qs: readonly Question[]): Question[] => qs.filter(q => q.status === 'open')

/**
 * The armed ask: the one already armed while it is open, so hotkeys never renumber under the person;
 * else a blocking ask, else the oldest.
 */
export const pickArmed = (qs: readonly Question[], armed: string | null): string | null => {
  const open = openQuestions(qs)
  if (armed !== null && open.some(q => q.id === armed)) return armed
  const next = open.find(q => q.blocking) ?? open[0]
  return next?.id ?? null
}

/** Non-blocking agent asks whose default has applied by `now`. */
export const expired = (qs: readonly Question[], now: number): Question[] =>
  openQuestions(qs).filter(q => q.kind === 'agent' && !q.blocking && now - q.at >= DEFAULT_MS)

export const cutRow = (s: string): string => (s.length <= MAX_ROW ? s : s.slice(0, MAX_ROW))

/** What the agent reads when the person answers; undefined when nothing needs saying. */
export const answerRow = (q: Question, option: string): string | undefined => {
  if (q.kind === 'agent') {
    const first = q.options[0] as string
    const follow = q.blocking ? `Resume with ${option}.` : option === first ? `Keep going with ${option}.` : `Switch from ${first} to ${option}.`
    return cutRow(`[brief] ${q.id} -> ${option} (you). ${follow}`)
  }
  if (q.kind === 'drift') {
    const what = q.question.replace(/ isn't in done-when$/, '')
    return option === 'keep'
      ? cutRow(`[brief] ${q.id} -> keep (you). "${what}" is now in done-when.`)
      : cutRow(`[brief] ${q.id} -> drop (you). Stop work on "${what}"; it isn't in done-when.`)
  }
  // A default that applied: keeping it needs no word; dropping it does.
  if (option === 'keep') return undefined
  return cutRow(`[brief] ${q.ref ?? q.id} -> drop default (you). Undo "${q.answer ?? ''}" and ask again if it matters.`)
}

/** Several events in one step become one row, one line each. */
export const mergeRows = (rows: readonly string[]): string => rows.join('\n')

/** At most `n` characters, cut at a word boundary where one is near. */
export const cutWords = (s: string, n: number): string => {
  if (s.length <= n) return s
  const at = s.lastIndexOf(' ', n)
  return at >= n / 2 ? s.slice(0, at) : s.slice(0, n)
}

export const driftQuestion = (id: string, what: string, turn: number, now: number): Question => {
  const w = what.slice(0, MAX_QUESTION - 20)
  return { id, kind: 'drift', question: `${w} isn't in done-when`, short: `${cutWords(w, MAX_SHORT - 1)}?`, options: ['keep', 'drop'], blocking: false, at: now, status: 'open', turn }
}

export const defaultQuestion = (id: string, from: Question, now: number): Question => {
  const first = from.options[0] as string
  return {
    id,
    kind: 'default',
    question: `${from.short}: went with ${first}`.slice(0, MAX_QUESTION),
    short: `Went with ${first}`.slice(0, MAX_SHORT),
    options: ['keep', 'drop'],
    blocking: false,
    at: now,
    status: 'open',
    answer: first,
    ref: from.id,
  }
}

// --- the direction check ---

export const checkPrompt = (goal: string, doneWhen: readonly DoneItem[]): string =>
  [
    'A direction check for the person running this session; do not continue the task.',
    `Goal: ${goal}`,
    `Done when: ${doneWhen.map(d => d.text).join('; ') || '(none)'}`,
    'Did your last turn do work that serves none of the done-when checks? Reply with JSON only:',
    '{"onTrack": true|false, "unplanned": ["<at most 30 characters each>"]}',
    'List only real unplanned work (a new feature, an unrequested change), not setup, tests or fixes for a check.',
  ].join('\n')

export const parseCheck = (reply: string, turn: number): Check | undefined => {
  const m = /\{[\s\S]*\}/.exec(reply)
  if (m === null) return undefined
  try {
    const o = JSON.parse(m[0]) as { onTrack?: unknown; unplanned?: unknown }
    const unplanned = Array.isArray(o.unplanned)
      ? o.unplanned.filter((x): x is string => typeof x === 'string' && clean(x) !== '').map(x => clean(x).replace(/[^\x20-\x7e]/g, '').slice(0, 30)).slice(0, 3)
      : []
    return { turn, onTrack: o.onTrack !== false && unplanned.length === 0, unplanned }
  } catch {
    return undefined
  }
}

// --- the /brief snapshot and brief_read ---

export type BriefView = {
  goal: string | null
  doneWhen: readonly DoneItem[]
  questions: readonly Question[]
  steps: readonly Step[]
  check: Check | null
  changes: Changes
  ctxPercent: number | undefined
  assumptions: readonly string[]
  now: number
}

const doneWhenText = (items: readonly DoneItem[]): string => items.map(d => `[${d.met ? 'x' : ' '}] ${d.text}`).join('  ')

const questionText = (q: Question, now: number): string => {
  const time = q.kind === 'drift' ? `after turn ${q.turn ?? 0}` : q.blocking ? mins(now - q.at) : q.kind === 'default' ? `${mins(now - q.at)} ago` : `default in ${mins(q.at + DEFAULT_MS - now)}`
  return `${q.blocking ? '!' : '?'} ${q.question}  ${q.options.join(' / ')}  ${time}`
}

const changesText = (c: Changes, now: number): string | undefined => {
  const parts = [...c.done]
  if (c.asks > 0) parts.push(`${c.asks} ask${c.asks === 1 ? '' : 's'}`)
  if (c.answers > 0) parts.push(`${c.answers} answer${c.answers === 1 ? '' : 's'}`)
  if (c.edits > 0) parts.push(`${c.edits} file edit${c.edits === 1 ? '' : 's'}`)
  if (parts.length === 0) return undefined
  return `since ${mins(now - c.since)}  ${parts.join(', ')}`
}

const healthText = (v: BriefView): string | undefined => {
  const parts: string[] = []
  if (v.check !== null) {
    parts.push(v.check.onTrack ? `on track after turn ${v.check.turn}` : `drift after turn ${v.check.turn}`)
    if (v.check.unplanned.length > 0) parts.push(`unplanned: ${v.check.unplanned.join(', ')}`)
  }
  if (v.ctxPercent !== undefined) parts.push(`ctx ${Math.round(v.ctxPercent)}%`)
  return parts.length === 0 ? undefined : parts.join('  ')
}

/** The /brief snapshot: goal, done-when, every open ask, what changed, health; no frame, empty lines left out. */
export const snapshot = (v: BriefView): SnapLine[] => {
  const lines: SnapLine[] = []
  lines.push({ text: v.goal ?? 'No goal set (brief_note).', tone: v.goal === null ? 'dim' : 'goal' })
  if (v.doneWhen.length > 0) lines.push({ text: `done when  ${doneWhenText(v.doneWhen)}`, tone: 'dim' })
  for (const q of openQuestions(v.questions)) lines.push({ text: questionText(q, v.now), tone: q.blocking ? 'warning' : 'plain' })
  const changed = changesText(v.changes, v.now)
  if (changed !== undefined) lines.push({ text: changed, tone: 'dim' })
  const health = healthText(v)
  if (health !== undefined) lines.push({ text: health, tone: 'dim' })
  return lines
}

/** brief_read: at most 8 plain lines, for the agent before it says it is done. */
export const readText = (v: BriefView): string => {
  const lines: string[] = []
  lines.push(`goal: ${v.goal ?? '(none; set it with brief_note)'}`)
  if (v.doneWhen.length > 0) lines.push(`done when: ${doneWhenText(v.doneWhen)}`)
  const open = openQuestions(v.questions)
  for (const q of open.slice(0, 3)) lines.push(`open ${q.id}${q.blocking ? ' (blocking)' : ''}: ${q.question} [${q.options.join(' / ')}]`)
  if (open.length > 3) lines.push(`+${open.length - 3} more open asks`)
  const answered = v.questions.filter(q => q.status === 'answered' || q.status === 'defaulted').slice(-2)
  for (const q of answered) lines.push(`${q.id}: ${q.status === 'defaulted' ? 'default applied' : 'answered'} ${q.answer ?? ''}`)
  if (v.assumptions.length > 0) lines.push(`assumed: ${v.assumptions.slice(-2).join('; ')}`)
  const health = healthText(v)
  if (health !== undefined) lines.push(health)
  return lines.slice(0, MAX_READ_LINES).map(l => cutRow(l)).join('\n')
}
