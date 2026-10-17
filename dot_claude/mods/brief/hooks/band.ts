// The band's two lines, laid out by hand: flex layout wraps a line it cannot fit, so each line's length is
// computed here and the first form that fits bodyColumns is drawn. Pure functions only, for the fit tests.
import type { Cron, DoneItem, Job, Question, Step } from '../types'

/** A non-blocking ask's default applies after this long without an answer. */
export const DEFAULT_MS = 10 * 60_000
/** An answer is held this long, undoable, before it goes to the agent. */
export const UNDO_MS = 3_000

export const isAscii = (s: string): boolean => /^[\x20-\x7e]*$/.test(s)

/** Elapsed time as a job shows it: 45s, 1m12s, 22m, 1h05. */
export const duration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 600) return s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** A coarse time for meta: 30s, 4m, 2h. */
export const mins = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`
}

const optionsWidth = (options: readonly string[]): number => options.reduce((n, o, i) => n + 2 + `${i + 1}: ${o}`.length, 0)

export type AskSpec = {
  sigil: '!' | '?'
  question: string
  short: string
  options: readonly string[]
  /** the other open asks, drawn as `+n` */
  plus: number
  /** meta's time part, full and short (`default in 4m`, `4m`) */
  time: string
  timeShort: string
}

export type AskFit = { form: 1 | 2 | 3 | 4 | 5 | 6; question: string; meta: string }

const join = (parts: readonly string[], sep: string): string => parts.filter(p => p !== '').join(sep)

export const askLength = (question: string, options: readonly string[], meta: string): number =>
  2 + question.length + optionsWidth(options) + (meta === '' ? 0 : 2 + meta.length)

/** The first form that fits `columns`; past the fifth, the short question alone, cut by Claude Code. */
export const fitAsk = (spec: AskSpec, columns: number): AskFit => {
  const plus = spec.plus > 0 ? `+${spec.plus}` : ''
  const full = join([plus, spec.time], '  ')
  const short = join([plus, spec.timeShort], ' ')
  const forms: [AskFit['form'], string, string][] = [
    [1, spec.question, full],
    [2, spec.question, short],
    [3, spec.short, short],
    [4, spec.short, plus],
    [5, spec.short, ''],
  ]
  for (const [form, question, meta] of forms) {
    if (askLength(question, spec.options, meta) <= columns) return { form, question, meta }
  }
  return { form: 6, question: spec.short, meta: '' }
}

/** Plain text of a fitted ask line, meta flush right at `columns`, as the reference captures read. */
export const askText = (spec: AskSpec, fit: AskFit, columns: number): string => {
  const head = [`${spec.sigil} ${fit.question}`, ...spec.options.map((o, i) => `${i + 1}: ${o}`)].join('  ')
  if (fit.meta === '') return head
  return head + ' '.repeat(Math.max(2, columns - head.length - fit.meta.length)) + fit.meta
}

/** The ask line's spec for one question; `plus` counts the other open ones. */
export const askSpec = (q: Question, plus: number, now: number): AskSpec => {
  const base = { question: q.question, short: q.short, options: q.options, plus }
  if (q.kind === 'drift') return { ...base, sigil: '?', time: `after turn ${q.turn ?? 0}`, timeShort: `t${q.turn ?? 0}` }
  if (q.blocking) return { ...base, sigil: '!', time: mins(now - q.at), timeShort: mins(now - q.at) }
  if (q.kind === 'default') return { ...base, sigil: '?', time: `${mins(now - q.at)} ago`, timeShort: mins(now - q.at) }
  const left = mins(q.at + DEFAULT_MS - now)
  return { ...base, sigil: '?', time: `default in ${left}`, timeShort: left }
}

// --- the activity line ---

export type Count = { k: number; n: number; step: string | undefined }

/** Steps from the agent's task list when it has one, else the done-when count. */
export const stepCount = (steps: readonly Step[], doneWhen: readonly DoneItem[]): Count | undefined => {
  if (steps.length > 0) {
    const done = steps.filter(s => s.status === 'completed').length
    const current = steps.find(s => s.status === 'in_progress')
    const next = current ?? steps.find(s => s.status === 'pending')
    return { k: Math.min(steps.length, done + (current === undefined ? 0 : 1)), n: steps.length, step: next?.subject }
  }
  if (doneWhen.length > 0) {
    return { k: doneWhen.filter(d => d.met).length, n: doneWhen.length, step: doneWhen.find(d => !d.met)?.text }
  }
  return undefined
}

export const isDone = (steps: readonly Step[], doneWhen: readonly DoneItem[]): boolean =>
  steps.length > 0 ? steps.every(s => s.status === 'completed') : doneWhen.length > 0 && doneWhen.every(d => d.met)

export type Activity =
  | { kind: 'progress'; count: string; step: string; state: string }
  | { kind: 'done'; count: string; doneWhen: string; time: string }

export type ActivityInput = {
  steps: readonly Step[]
  doneWhen: readonly DoneItem[]
  jobs: readonly Job[]
  crons: readonly Cron[]
  startedAt: number
  endedAt: number
  now: number
}

/** Between turns only: where the work stands and what the session waits on. */
export const activity = (a: ActivityInput, columns: number): Activity | undefined => {
  const count = stepCount(a.steps, a.doneWhen)
  if (count !== undefined && isDone(a.steps, a.doneWhen) && a.jobs.length === 0) {
    const met = a.doneWhen.filter(d => d.met).length
    return {
      kind: 'done',
      count: `${count.n}/${count.n}`,
      doneWhen: a.doneWhen.length === 0 ? '' : `${met}/${a.doneWhen.length} done-when met`,
      time: a.startedAt > 0 ? mins(a.now - a.startedAt) : '',
    }
  }
  let state = ''
  const job = a.jobs[0]
  if (job !== undefined) state = `waiting on ${job.label} ${duration(a.now - job.since)}`
  else if (a.crons.length > 0) {
    const at = Math.min(...a.crons.map(c => nextFire(c.schedule, a.now) ?? Infinity))
    state = Number.isFinite(at) ? `wakes in ${mins(at - a.now)}` : 'wakes later'
  } else if (a.endedAt > 0) state = `ended ${mins(a.now - a.endedAt)} ago`
  if (count === undefined && job === undefined && a.crons.length === 0) return undefined
  const head = count === undefined ? '' : `${count.k}/${count.n}`
  // The step gives way first: the count and the state are what a glance needs.
  const room = columns - head.length - 1 - (state === '' ? 0 : 2 + state.length)
  const step = count?.step === undefined || room < 4 ? '' : count.step.slice(0, room)
  return { kind: 'progress', count: head, step, state }
}

export const activityText = (a: Activity): string =>
  a.kind === 'done'
    ? join([`${a.count} done`, a.doneWhen, a.time], '  ')
    : join([join([a.count, a.step], ' '), a.state], '  ')

// --- cron: when a session cron fires next ---

const field = (spec: string, min: number, max: number): Set<number> | undefined => {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (m === null) return undefined
    const step = m[2] === undefined ? 1 : Number(m[2])
    let lo = min
    let hi = max
    if (m[1] !== '*') {
      const [a, b] = (m[1] as string).split('-').map(Number)
      lo = a as number
      hi = b ?? (m[2] === undefined ? (a as number) : max)
    }
    if (step < 1 || lo < min || hi > max) return undefined
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/** The next minute after `now` a five-field cron expression matches, in local time; undefined if none in 8 days. */
export const nextFire = (schedule: string, now: number): number | undefined => {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return undefined
  const [mi, ho, dom, mon, dow] = parts as [string, string, string, string, string]
  const sets = [field(mi, 0, 59), field(ho, 0, 23), field(dom, 1, 31), field(mon, 1, 12), field(dow.replace(/7/g, '0'), 0, 6)]
  if (sets.some(s => s === undefined)) return undefined
  const [M, H, D, Mo, W] = sets as Set<number>[]
  const t = new Date(now)
  t.setSeconds(0, 0)
  for (let i = 0; i < 8 * 24 * 60; i++) {
    t.setMinutes(t.getMinutes() + 1)
    const domOk = (D as Set<number>).has(t.getDate())
    const dowOk = (W as Set<number>).has(t.getDay())
    // Cron's rule: when both day fields are restricted, either may match.
    const dayOk = dom === '*' || dow === '*' ? domOk && dowOk : domOk || dowOk
    if ((M as Set<number>).has(t.getMinutes()) && (H as Set<number>).has(t.getHours()) && (Mo as Set<number>).has(t.getMonth() + 1) && dayOk) {
      return t.getTime()
    }
  }
  return undefined
}
