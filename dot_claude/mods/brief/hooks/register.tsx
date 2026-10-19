// The brief: a band of at most two lines above the prompt (activity between turns, the armed ask nearest the
// prompt), a step count on the spinner, a /brief snapshot in the transcript, and a notification for blocking
// asks. The agent writes through brief_ask, brief_note and brief_read; everything else is observed by hooks.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Changes, Check, Cron, DoneItem, Job, Pending, Question, SnapLine, Step } from '../types'
import { activity, askSpec, fitAsk, stepCount, UNDO_MS } from './band'
import {
  APPROVAL_HINT,
  ASK_DESCRIPTION,
  answerRow,
  applyMet,
  parseAnswerRows,
  checkPrompt,
  defaultQuestion,
  driftQuestion,
  expired,
  mergeRows,
  NEEDS_APPROVAL,
  openQuestions,
  parseCheck,
  pickArmed,
  MAX_CHECK,
  readText,
  RULE,
  snapshot,
  validateAsk,
  validateNote,
} from './model'
import type { BriefView } from './model'

const goalAtom = atom({ plugin: 'brief', key: 'goal' } as const, null as string | null)
const doneWhenAtom = atom({ plugin: 'brief', key: 'doneWhen' } as const, [] as DoneItem[])
const assumptionsAtom = atom({ plugin: 'brief', key: 'assumptions' } as const, [] as string[])
const questionsAtom = atom({ plugin: 'brief', key: 'questions' } as const, [] as Question[])
const armedAtom = atom({ plugin: 'brief', key: 'armed' } as const, null as string | null)
const pendingAtom = atom({ plugin: 'brief', key: 'pending' } as const, null as Pending | null)
const nextIdAtom = atom({ plugin: 'brief', key: 'nextId' } as const, 1)
const stepsAtom = atom({ plugin: 'brief', key: 'steps' } as const, [] as Step[])
const hasTaskToolAtom = atom({ plugin: 'brief', key: 'hasTaskTool' } as const, false)
const jobsAtom = atom({ plugin: 'brief', key: 'jobs' } as const, [] as Job[])
const cronsAtom = atom({ plugin: 'brief', key: 'crons' } as const, [] as Cron[])
const workingAtom = atom({ plugin: 'brief', key: 'isWorking' } as const, false)
const startedAtom = atom({ plugin: 'brief', key: 'startedAt' } as const, 0)
const endedAtom = atom({ plugin: 'brief', key: 'endedAt' } as const, 0)
const turnAtom = atom({ plugin: 'brief', key: 'turn' } as const, 0)
const checkAtom = atom({ plugin: 'brief', key: 'check' } as const, null as Check | null)
const changesAtom = atom({ plugin: 'brief', key: 'changes' } as const, { since: 0, done: [], asks: 0, answers: 0, edits: 0 } as Changes)
const outboxAtom = atom({ plugin: 'brief', key: 'outbox' } as const, [] as string[])
const snapshotAtom = atom({ plugin: 'brief', key: 'snapshot' } as const, [] as SnapLine[])
const unreadAtom = atom({ plugin: 'brief', key: 'unread' } as const, null as string | null)
const keptAtom = atom({ plugin: 'brief', key: 'kept' } as const, [] as string[])
const sidAtom = atom({ plugin: 'brief', key: 'sid' } as const, null as string | null)

const ASK_TOOL = 'mcp__brief__brief_ask'
const NOTE_TOOL = 'mcp__brief__brief_note'
const READ_TOOL = 'mcp__brief__brief_read'
const TICK_MS = 15_000
const FLUSH_MS = 300
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const SAVE_MS = 500
// One file per session, not the plugin store: the store is one JSON file every session writes, so panes saving
// at once could drop each other's keys. A session only ever writes its own file.
const SAVE_DIR = '/.claude/mods-data/brief/sessions'
const SAVE_TTL_MS = 14 * 86_400_000
// Typed at the terminal, Remote Control, and an SDK host's turn (claude -p, the eval harness).
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

// Module variables reset on a hot reload; each only skips one check or merges one row less.
let toolsThisTurn = false
let checking = false
let flushTimer: { cancel: () => void } | undefined
let undoTimer: { cancel: () => void } | undefined
let saveTimer: { cancel: () => void } | undefined
// The last save written, so the 15 s tick's redraw does not rewrite an unchanged brief.
let lastSaved = ''
// sid after session.end: the next entry point loads the new id's save. null means never set (a fresh process,
// or a hot reload from before sid existed).
const ENDED = '(ended)'

// Every change redraws; the same moment schedules the session's save, so a resume finds the brief as it was.
const redraw = ($: EngineInterface): void => {
  $.ui.invalidate('ui.render')
  saveTimer?.cancel()
  saveTimer = $.clock.after(SAVE_MS, () => {
    void save($).catch(() => undefined)
  })
}

// --- the brief across a resume: what the person has yet to answer, one file per session ---

async function saveDir($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  return home === undefined ? undefined : `${home}${SAVE_DIR}`
}

// Session ids are UUIDs; anything else is not used in a path.
const savePath = (dir: string, sid: string): string | undefined => (/^[A-Za-z0-9-]{1,80}$/.test(sid) ? `${dir}/${sid}.json` : undefined)

/** What a resumed session gets back. Jobs, steps and the turn's flags are re-observed; an answer in its undo window is not kept. */
type Saved = {
  at: number
  goal: string | null
  doneWhen: DoneItem[]
  assumptions: string[]
  questions: Question[]
  armed: string | null
  nextId: number
  kept: string[]
  startedAt: number
  check: Check | null
  turn: number
  outbox: string[]
}

async function save($: EngineInterface): Promise<void> {
  const sid = await read($, sidAtom)
  if (sid === null || sid === ENDED) return
  const pending = await read($, pendingAtom)
  // An answer still undoable did not go out: on a resume its ask is open again.
  const questions = (await read($, questionsAtom)).map(q => (pending !== null && q.id === pending.id ? { ...q, status: 'open' as const, answer: undefined } : q))
  const saved: Saved = {
    at: await $.clock.now(),
    goal: await read($, goalAtom),
    doneWhen: await read($, doneWhenAtom),
    assumptions: await read($, assumptionsAtom),
    questions: questions.slice(-40),
    armed: await read($, armedAtom),
    nextId: await read($, nextIdAtom),
    kept: await read($, keptAtom),
    startedAt: await read($, startedAtom),
    check: await read($, checkAtom),
    turn: await read($, turnAtom),
    outbox: await read($, outboxAtom),
  }
  // Nothing to keep: no file, so idle sessions leave nothing behind.
  if (saved.goal === null && saved.doneWhen.length === 0 && saved.questions.length === 0 && saved.outbox.length === 0) return
  const body = JSON.stringify({ ...saved, at: 0 })
  if (body === lastSaved) return
  // The session may have ended while this was reading: never write one session's state under another.
  if ((await read($, sidAtom)) !== sid) return
  const dir = await saveDir($)
  const path = dir === undefined ? undefined : savePath(dir, sid)
  if (path === undefined) return
  await $.fs.write(path, JSON.stringify(saved))
  lastSaved = body
}

async function load($: EngineInterface, sid: string): Promise<void> {
  const dir = await saveDir($)
  const path = dir === undefined ? undefined : savePath(dir, sid)
  if (path === undefined || !(await $.fs.exists(path))) return
  let v: Partial<Saved> | undefined
  try {
    v = JSON.parse(await $.fs.read(path)) as Partial<Saved>
  } catch {
    return
  }
  if (v === undefined || v === null || typeof v !== 'object' || !Array.isArray(v.questions)) return
  await update($, goalAtom, () => (typeof v.goal === 'string' ? v.goal : null))
  await update($, doneWhenAtom, () => (Array.isArray(v.doneWhen) ? v.doneWhen : []))
  await update($, assumptionsAtom, () => (Array.isArray(v.assumptions) ? v.assumptions : []))
  await update($, questionsAtom, () => v.questions as Question[])
  await update($, nextIdAtom, () => (typeof v.nextId === 'number' ? v.nextId : 1))
  await update($, keptAtom, () => (Array.isArray(v.kept) ? v.kept : []))
  await update($, checkAtom, () => v.check ?? null)
  await update($, turnAtom, () => (typeof v.turn === 'number' ? v.turn : 0))
  if (typeof v.startedAt === 'number' && v.startedAt > 0) await update($, startedAtom, () => v.startedAt as number)
  if (Array.isArray(v.outbox) && v.outbox.length > 0) {
    await update($, outboxAtom, () => v.outbox as string[])
    flushTimer = $.clock.after(FLUSH_MS, () => {
      void flush($)
    })
  }
  const qs = v.questions as Question[]
  await update($, armedAtom, () => pickArmed(qs, typeof v.armed === 'string' ? v.armed : null))
}

/**
 * The state belongs to one session id. A /clear or a resume moves the process to another id without a
 * session.start, so each entry point checks: a new id resets the state and loads that session's save.
 */
async function ensureSession($: EngineInterface): Promise<void> {
  const sid = await $.session.id()
  const held = await read($, sidAtom)
  if (held === sid) return
  // A mod loaded over a running session (a deploy) finds state but no sid: it is this session's, keep it.
  if (held === null && (await read($, startedAtom)) !== 0) {
    await update($, sidAtom, () => sid)
    return
  }
  lastSaved = ''
  await resetSession($)
  await update($, sidAtom, () => sid)
  await load($, sid)
}

async function sweepSaves($: EngineInterface): Promise<void> {
  const dir = await saveDir($)
  if (dir === undefined || !(await $.fs.exists(dir))) return
  const now = await $.clock.now()
  for (const f of await $.fs.list(dir)) {
    if (f.kind === 'file' && f.name.endsWith('.json') && now - f.mtimeMs > SAVE_TTL_MS) await removeSave($, `${dir}/${f.name}`)
  }
}

async function removeSave($: EngineInterface, path: string): Promise<void> {
  await $.process.run(['rm', '-f', path], { timeoutMs: 3_000 }).catch(() => undefined)
}

const freshChanges = (since: number): Changes => ({ since, done: [], asks: 0, answers: 0, edits: 0 })

async function newId($: EngineInterface): Promise<string> {
  // One update, so two callers at once never share an id.
  const n = await update($, nextIdAtom, v => v + 1)
  return `D${n - 1}`
}

async function rearm($: EngineInterface): Promise<void> {
  const qs = await read($, questionsAtom)
  await update($, armedAtom, prev => pickArmed(qs, prev ?? null))
}

async function noteDone($: EngineInterface, texts: readonly string[]): Promise<void> {
  if (texts.length > 0) await update($, changesAtom, c => ({ ...(c ?? freshChanges(0)), done: [...(c?.done ?? []), ...texts].slice(-6) }))
}

// --- delivery: one row per step, mid-turn as a user row, idle as a prompt ---

async function flush($: EngineInterface): Promise<void> {
  flushTimer = undefined
  const rows = await read($, outboxAtom)
  if (rows.length === 0) return
  await update($, outboxAtom, () => [])
  const text = mergeRows(rows)
  try {
    if (await read($, workingAtom)) {
      const sent = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
      if ('deny' in sent && sent.deny !== undefined) $.ui.log(`brief: answer not delivered (${sent.deny})`)
      // Read at the agent's next request; if the turn ends first, turn.complete sends it again as a prompt.
      else await update($, unreadAtom, prev => (prev === null || prev === undefined ? text : `${prev}\n${text}`))
    } else {
      await $.prompt.submit({ text })
    }
  } catch (err) {
    $.ui.log(`brief: answer not delivered (${String(err)})`)
  }
}

async function send($: EngineInterface, row: string): Promise<void> {
  await update($, outboxAtom, prev => [...(prev ?? []), row])
  // Rows that land together go as one; a timer, so a press or a command never submits from inside its own hook.
  flushTimer?.cancel()
  flushTimer = $.clock.after(FLUSH_MS, () => {
    void flush($)
  })
}

// --- answers: held UNDO_MS, then sent ---

async function commit($: EngineInterface, id: string): Promise<void> {
  undoTimer = undefined
  const pending = await read($, pendingAtom)
  if (pending === null || pending.id !== id) return
  await update($, pendingAtom, () => null)
  const q = (await read($, questionsAtom)).find(x => x.id === id)
  if (q !== undefined) {
    await settle($, q, pending.option)
    const row = answerRow(q, pending.option)
    if (row !== undefined) await send($, row)
  }
  await rearm($)
  redraw($)
}

/** What an answer does to the brief, however it arrived (a band press or a row from another channel). */
async function settle($: EngineInterface, q: Question, option: string): Promise<void> {
  // A kept drift becomes a done-when check of its own.
  if (q.kind === 'drift' && option === 'keep') {
    const what = q.question.replace(/ isn't in done-when$/, '')
    await update($, doneWhenAtom, prev => [...(prev ?? []), { text: what.slice(0, MAX_CHECK), met: false }])
    await update($, keptAtom, prev => [...(prev ?? []), what.toLowerCase()])
  }
  await update($, questionsAtom, prev => (prev ?? []).map(x => (x.id === q.id ? { ...x, status: 'answered' as const, answer: option } : x)))
  await update($, changesAtom, c => ({ ...(c ?? freshChanges(0)), answers: (c?.answers ?? 0) + 1 }))
}

async function answer($: EngineInterface, id: string, option: string): Promise<void> {
  const now = await $.clock.now()
  // A press that lands after the ask closed (a default applied a moment ago) answers nothing.
  if (!openQuestions(await read($, questionsAtom)).some(q => q.id === id) || (await read($, pendingAtom)) !== null) return
  await update($, questionsAtom, prev => (prev ?? []).map(q => (q.id === id && q.status === 'open' ? { ...q, status: 'answered' as const, answer: option } : q)))
  await update($, pendingAtom, () => ({ id, option, at: now }))
  undoTimer?.cancel()
  undoTimer = $.clock.after(UNDO_MS, () => {
    void commit($, id)
  })
  redraw($)
}

async function undo($: EngineInterface): Promise<void> {
  const pending = await read($, pendingAtom)
  if (pending === null) return
  undoTimer?.cancel()
  undoTimer = undefined
  await update($, pendingAtom, () => null)
  await update($, questionsAtom, prev => (prev ?? []).map(q => (q.id === pending.id ? { ...q, status: 'open' as const, answer: undefined } : q)))
  // The same ask, the same hotkeys.
  await update($, armedAtom, () => pending.id)
  redraw($)
}

// --- the clock: defaults apply; meta times move ---

async function tick($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const due = expired(await read($, questionsAtom), now)
  if (due.length > 0) {
    const raised: Question[] = []
    for (const q of due) raised.push(defaultQuestion(await newId($), q, now))
    await update($, questionsAtom, prev => [
      ...(prev ?? []).map(q => (due.some(d => d.id === q.id) ? { ...q, status: 'defaulted' as const, answer: q.options[0] } : q)),
      ...raised,
    ])
    await rearm($)
  }
  redraw($)
}

// --- the direction check: one forked completion over the session's own transcript ---

async function directionCheck($: EngineInterface, turn: number): Promise<void> {
  const goal = await read($, goalAtom)
  const doneWhen = await read($, doneWhenAtom)
  // Nothing to judge against without done-when checks: no fork.
  if (goal === null || doneWhen.length === 0 || checking) return
  if (openQuestions(await read($, questionsAtom)).some(q => q.kind === 'drift')) return
  checking = true
  try {
    const session = await read($, startedAtom)
    const reply = await $.model.fork({ prompt: checkPrompt(goal, doneWhen) })
    // A /clear while the fork ran: the verdict is the old conversation's.
    if (!reply.isAnswered || (await read($, startedAtom)) !== session) return
    const check = parseCheck(reply.text, turn)
    if (check === undefined) return
    await update($, checkAtom, () => check)
    const kept = await read($, keptAtom)
    const what = check.unplanned.find(u => !doneWhen.some(d => d.text.toLowerCase() === u.toLowerCase()) && !kept.includes(u.toLowerCase()))
    if (what !== undefined) {
      const q = driftQuestion(await newId($), what, turn, await $.clock.now())
      await update($, questionsAtom, prev => [...(prev ?? []), q])
      await rearm($)
    }
    redraw($)
  } finally {
    checking = false
  }
}

// --- the views ---

async function view($: EngineInterface): Promise<BriefView> {
  const usage = await $.session.usage().catch(() => undefined)
  return {
    goal: await read($, goalAtom),
    doneWhen: await read($, doneWhenAtom),
    questions: await read($, questionsAtom),
    steps: await read($, stepsAtom),
    check: await read($, checkAtom),
    changes: await read($, changesAtom),
    ctxPercent: usage?.context.percent,
    assumptions: await read($, assumptionsAtom),
    now: await $.clock.now(),
  }
}

async function resetSession($: EngineInterface): Promise<void> {
  undoTimer?.cancel()
  flushTimer?.cancel()
  const now = await $.clock.now()
  await update($, goalAtom, () => null)
  await update($, doneWhenAtom, () => [])
  await update($, assumptionsAtom, () => [])
  await update($, questionsAtom, () => [])
  await update($, armedAtom, () => null)
  await update($, pendingAtom, () => null)
  await update($, stepsAtom, () => [])
  await update($, jobsAtom, () => [])
  await update($, cronsAtom, () => [])
  await update($, checkAtom, () => null)
  await update($, outboxAtom, () => [])
  await update($, unreadAtom, () => null)
  await update($, keptAtom, () => [])
  await update($, snapshotAtom, () => [])
  await update($, turnAtom, () => 0)
  await update($, endedAtom, () => 0)
  await update($, startedAtom, () => now)
  await update($, changesAtom, () => freshChanges(now))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Tools first, each on its own: a refused registration (a taken name) must not skip the others.
    const tools = [
      {
        name: 'brief_ask',
        description: ASK_DESCRIPTION,
        isDeferred: false,
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'At most 60 characters' },
            short: { type: 'string', description: 'The question in at most 24 characters, for narrow screens' },
            options: { type: 'array', items: { type: 'string' }, description: '2 to 4 choices of at most 12 characters; your default (or the safe choice, when blocking) first' },
            blocking: { type: 'boolean', description: "true only when you stop until they answer: a step that can't be undone or that others will see" },
          },
          required: ['question', 'short', 'options'],
        },
      },
      {
        name: 'brief_note',
        description: 'Record the goal and 2-8 done-when checks when you start (the list replaces the last; "[x] text" marks one met), tick checks with met as you finish them, or note an assumption you made.',
        isDeferred: true,
        inputSchema: {
          type: 'object',
          properties: {
            goal: { type: 'string' },
            doneWhen: { type: 'array', items: { type: 'string' } },
            met: { type: 'array', items: { type: 'string' }, description: 'Done-when checks now met, by their text' },
            assumption: { type: 'string' },
          },
        },
      },
      {
        name: 'brief_read',
        description: 'The brief as the person sees it: goal, status, done-when (one check per line), open asks, recent answers, health.',
        isDeferred: true,
        inputSchema: { type: 'object', properties: {} },
      },
    ]
    for (const spec of tools) await $.tool.register(spec).catch(err => $.ui.log(`brief: could not register ${spec.name} (${String(err)})`))
    await $.command
      .register({ name: 'brief', description: 'Show the brief: goal, done-when, open asks, what changed, health', immediate: true })
      .catch(err => $.ui.log(`brief: could not register /brief (${String(err)})`))
    // A hot reload keeps the state (same id); a fresh process or a resume loads the session's save.
    await ensureSession($)
    await sweepSaves($).catch(() => undefined)
    // A reload drops timers: an answer still in its undo window goes out when the window would have closed.
    const pending = await read($, pendingAtom)
    if (pending !== null) {
      const left = Math.max(0, pending.at + UNDO_MS - (await $.clock.now()))
      undoTimer = $.clock.after(left, () => {
        void commit($, pending.id)
      })
    }
    // ...and rows queued for the agent go out.
    if ((await read($, outboxAtom)).length > 0) {
      flushTimer = $.clock.after(FLUSH_MS, () => {
        void flush($)
      })
    }
    $.clock.every(TICK_MS, () => {
      void tick($)
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // Save what is open before the state goes: a resume of this session gets it back. /clear starts over.
    saveTimer?.cancel()
    if (e.reason === 'clear') {
      const dir = await saveDir($)
      const path = dir === undefined ? undefined : savePath(dir, e.sessionId)
      if (path !== undefined) await removeSave($, path)
    }
    else {
      // Always write: another session's sweep may have removed a long-idle file whose body never changed.
      lastSaved = ''
      await save($).catch(() => undefined)
    }
    await update($, sidAtom, () => ENDED)
    await resetSession($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await ensureSession($)
      toolsThisTurn = false
      await update($, workingAtom, () => true)
      redraw($)
    }
    return next(e)
  })

  // A model request of the main loop reads every row appended before it.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await update($, unreadAtom, () => null)
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    await update($, workingAtom, () => false)
    const ended = await $.clock.now()
    await update($, endedAtom, () => ended)
    // An answer appended after the turn's last request would wait for the person's next prompt: send it now.
    const unread = await read($, unreadAtom)
    if (unread !== null) {
      await update($, unreadAtom, () => null)
      $.clock.after(FLUSH_MS, () => {
        void $.prompt.submit({ text: unread }).catch(err => $.ui.log(`brief: answer not delivered (${String(err)})`))
      })
    }
    const turn = (await read($, turnAtom)) + 1
    await update($, turnAtom, () => turn)
    if (toolsThisTurn && !e.isAborted) void directionCheck($, turn).catch(err => $.ui.log(`brief: direction check failed (${String(err)})`))
    redraw($)
    return done
  })

  // Jobs and wakeups, as Claude Code reports them when the main loop stops.
  on('classic.Stop', async ($, e, next) => {
    const now = await $.clock.now()
    const tasks = (e.background_tasks ?? []).filter(t => t.status === 'running' || t.status === 'pending')
    await update($, jobsAtom, prev =>
      tasks.map(t => ({ id: t.id, label: (t.description || t.command || t.type).slice(0, 30), since: (prev ?? []).find(j => j.id === t.id)?.since ?? now })),
    )
    await update($, cronsAtom, prev =>
      (e.session_crons ?? []).map(c => ({ id: c.id, schedule: c.schedule, recurring: c.recurring, seenAt: (prev ?? []).find(x => x.id === c.id)?.seenAt ?? now })),
    )
    redraw($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // A plain string: the laid MCP types list a fixed set of names, so comparing e.tool narrows e to never.
    const name: string = e.tool
    if ([ASK_TOOL, NOTE_TOOL, READ_TOOL].includes(name)) await ensureSession($)
    if (name === ASK_TOOL) {
      if (e.agentId !== undefined) return { result: 'Not queued: only the main session asks the person.' }
      const checked = validateAsk(e)
      if (!checked.ok) return { isError: true, result: checked.error, text: checked.error }
      const id = await newId($)
      const q: Question = { id, kind: 'agent', ...checked.value, at: await $.clock.now(), status: 'open' }
      await update($, questionsAtom, prev => [...(prev ?? []), q])
      await update($, changesAtom, c => ({ ...(c ?? freshChanges(0)), asks: (c?.asks ?? 0) + 1 }))
      await rearm($)
      redraw($)
      if (q.blocking) {
        const sent = await $.ui.notify(`${q.question}  ${q.options.join(' / ')}`).catch(() => undefined)
        if (sent !== undefined && !sent.isSent) $.ui.log(`brief: notification not sent (${sent.reason})`)
      }
      return { result: JSON.stringify({ id }) }
    }
    if (name === NOTE_TOOL) {
      const checked = validateNote(e)
      if (!checked.ok) return { isError: true, result: checked.error, text: checked.error }
      const { goal, doneWhen, met, assumption } = checked.value
      if (goal !== undefined) {
        if ((await read($, goalAtom)) === null) {
          const started = await $.clock.now()
          await update($, startedAtom, () => started)
        }
        await update($, goalAtom, () => goal)
      }
      if (doneWhen !== undefined) {
        const prev = await read($, doneWhenAtom)
        await noteDone($, doneWhen.filter(d => d.met && !prev.some(p => p.text === d.text && p.met)).map(d => d.text))
        await update($, doneWhenAtom, () => doneWhen)
      }
      if (met !== undefined) {
        const prev = await read($, doneWhenAtom)
        const { items, unmatched } = applyMet(prev, met)
        if (unmatched.length > 0) {
          const error = prev.length === 0 ? 'no done-when checks yet: brief_note doneWhen first' : `no check matches ${unmatched.map(u => `"${u}"`).join(', ')}; the checks are: ${prev.map(d => d.text).join('; ')}`
          return { isError: true, result: error, text: error }
        }
        await noteDone($, items.filter((d, i) => d.met && !(prev[i] as DoneItem).met).map(d => d.text))
        await update($, doneWhenAtom, () => items)
      }
      if (assumption !== undefined) await update($, assumptionsAtom, prev => [...(prev ?? []), assumption].slice(-5))
      redraw($)
      // The current checks, so the agent knows what is left without a brief_read.
      const list = await read($, doneWhenAtom)
      return { result: list.length === 0 ? 'ok' : `ok; done when ${list.map(d => `[${d.met ? 'x' : ' '}] ${d.text}`).join('  ')}` }
    }
    if (name === READ_TOOL) return { result: readText(await view($)) }

    if (e.agentId === undefined) toolsThisTurn = true
    const ran = await next(e)
    if (ran.isError === true && e.agentId === undefined && NEEDS_APPROVAL.test(ran.text ?? '')) return { ...ran, context: [...(ran.context ?? []), APPROVAL_HINT] }
    if (ran.deny !== undefined || ran.isError === true || e.agentId !== undefined) return ran

    // Steps, from the agent's own task list.
    if (e.tool === 'TaskCreate') {
      const task = (ran.result as { task?: { id?: string; subject?: string } } | undefined)?.task
      if (task?.id !== undefined) await update($, stepsAtom, prev => [...(prev ?? []), { id: task.id as string, subject: task.subject ?? e.subject, status: 'pending' as const }])
    } else if (e.tool === 'TaskUpdate') {
      const steps = await read($, stepsAtom)
      const was = steps.find(s => s.id === e.taskId)
      if (e.status === 'completed' && was !== undefined && was.status !== 'completed') await noteDone($, [was.subject])
      await update($, stepsAtom, prev =>
        e.status === 'deleted'
          ? (prev ?? []).filter(s => s.id !== e.taskId)
          : (prev ?? []).map(s => (s.id === e.taskId ? { ...s, subject: e.subject ?? s.subject, status: (e.status as Step['status'] | undefined) ?? s.status } : s)),
      )
    } else if (e.tool === 'TodoWrite') {
      const prev = await read($, stepsAtom)
      const steps = e.todos.map((t, i) => ({ id: `todo${i}`, subject: t.content, status: t.status }))
      await noteDone($, steps.filter(s => s.status === 'completed' && !prev.some(p => p.subject === s.subject && p.status === 'completed')).map(s => s.subject))
      await update($, stepsAtom, () => steps)
    } else if (EDIT_TOOLS.has(String(e.tool))) {
      await update($, changesAtom, c => ({ ...(c ?? freshChanges(0)), edits: (c?.edits ?? 0) + 1 }))
    }
    if (e.tool === 'TaskCreate' || e.tool === 'TaskUpdate' || e.tool === 'TodoWrite') redraw($)
    return ran
  }).catch(($, e, next) => next(e))

  // A `[brief]` answer row that reaches the agent by another way than the band (a remote client, the eval
  // harness): the ask it answers closes here too, so brief_read and the band agree with what the agent was told.
  // Only the person's own channels: a task notification, a peer or a channel message is model- or other-written
  // and must never answer for them (ids also repeat across sessions).
  on('prompt.submit', async ($, e, next) => {
    const answers = PERSON_ORIGINS.has(e.origin.kind) ? parseAnswerRows(e.text) : []
    if (answers.length > 0) {
      await ensureSession($)
      let closed = 0
      for (const a of answers) {
        const q = openQuestions(await read($, questionsAtom)).find(x => x.id === a.id)
        if (q === undefined || !q.options.includes(a.option)) continue
        await settle($, q, a.option)
        closed++
      }
      if (closed > 0) {
        await rearm($)
        redraw($)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // One fixed section, added last, never edited mid-session.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    await update($, hasTaskToolAtom, () => e.tools.includes('TaskCreate') || e.tools.includes('TodoWrite'))
    if (!e.tools.includes(ASK_TOOL)) return composed
    return { sections: [...composed.sections, { id: 'brief:rule', text: RULE, scope: 'session' as const }] }
  })

  // /brief: the model reads 'Brief shown.'; the row draws the snapshot taken now.
  on('command.run', { command: 'brief' }, async ($, e) => {
    await ensureSession($)
    const lines = snapshot(await view($))
    await update($, snapshotAtom, () => lines)
    const now = await $.clock.now()
    await update($, changesAtom, () => freshChanges(now))
    return { text: 'Brief shown.' }
  }).catch(() => ({ text: 'Brief shown.' }))

  on('ui.render', { component: 'CommandOutput', props: { command: 'brief' } }, async ($, e, next) => {
    const lines = await read($, snapshotAtom)
    if (lines.length === 0 || e.props.isErrored) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {lines.map((l, i) =>
          l.tone === 'warning' ? (
            <Text key={`s${i}`} color="warning" wrap="truncate-end">{l.text}</Text>
          ) : l.tone === 'dim' ? (
            <Text key={`s${i}`} dimColor wrap="truncate-end">{l.text}</Text>
          ) : (
            <Text key={`s${i}`} wrap="truncate-end">{l.text}</Text>
          ),
        )}
      </Box>
    )
  })

  // The spinner: the step count after Claude Code's own ellipsis; its word and message stay Claude Code's.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const count = stepCount(await read($, stepsAtom), await read($, doneWhenAtom))
    if (count === undefined) return next(e)
    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} ${count.k}/${count.n}` } })
  })

  // The band: activity between turns, then the armed ask (or its undo window) nearest the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await $.clock.now()
    const columns = e.props.bodyColumns
    const act = e.props.isWorking
      ? undefined
      : activity(
          {
            steps: await read($, stepsAtom),
            doneWhen: await read($, doneWhenAtom),
            jobs: await read($, jobsAtom),
            crons: await read($, cronsAtom),
            startedAt: await read($, startedAtom),
            endedAt: await read($, endedAtom),
            now,
          },
          columns,
        )
    const pending = await read($, pendingAtom)
    const qs = await read($, questionsAtom)
    const open = openQuestions(qs)
    const armedId = await read($, armedAtom)
    const armed = pending === null ? open.find(q => q.id === armedId) ?? open.find(q => q.id === pickArmed(qs, armedId)) : undefined
    if (act === undefined && pending === null && armed === undefined) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const actRow =
      act === undefined ? null : act.kind === 'done' ? (
        <Box key="act" flexDirection="row">
          <Text>{`${act.count} `}</Text>
          <Text color="success">done</Text>
          {act.doneWhen === '' ? null : <Text>{`  ${act.doneWhen}`}</Text>}
          {act.time === '' ? null : <Text dimColor>{`  ${act.time}`}</Text>}
        </Box>
      ) : (
        <Box key="act" flexDirection="row">
          <Text wrap="truncate-end">{[act.count, act.step].filter(s => s !== '').join(' ')}</Text>
          {act.state === '' ? null : <Text dimColor>{`${act.count === '' && act.step === '' ? '' : '  '}${act.state}`}</Text>}
        </Box>
      )
    let askRow = null
    if (pending !== null) {
      askRow = (
        <Box key="ask" flexDirection="row" gap={2}>
          <Box flexDirection="row" flexShrink={0}>
            <Text dimColor>sent: </Text>
            <Text>{pending.option}</Text>
          </Box>
          <Box flexShrink={0}>
            <Button plain hotkey="0" label="undo" onPress={() => undo($)} />
          </Box>
        </Box>
      )
    } else if (armed !== undefined) {
      const spec = askSpec(armed, open.length - 1, now)
      const fit = fitAsk(spec, columns)
      const tone = armed.blocking ? 'warning' : undefined
      askRow = (
        <Box key="ask" flexDirection="row">
          <Text color={tone} wrap="truncate-end">{`${spec.sigil} ${fit.question}`}</Text>
          <Box flexShrink={0} gap={2} marginLeft={2}>
            {armed.options.map((o, i) => (
              <Button key={`${armed.id}:${i + 1}`} plain hotkey={String(i + 1)} label={o} onPress={() => answer($, armed.id, o)} />
            ))}
          </Box>
          <Box flexGrow={1} />
          {fit.meta === '' ? null : (
            <Box flexShrink={0} marginLeft={2}>
              <Text dimColor>{fit.meta}</Text>
            </Box>
          )}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {actRow}
        {askRow}
      </Box>
    )
  })
}

