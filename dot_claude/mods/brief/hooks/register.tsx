import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Brief, CtxSample, Decision, Job, LedgerEntry, TurnSample } from '../types'
import type { BandMode, SessionRecord } from './brief.ts'
import {
  allViewText,
  appendDecisions,
  queueText,
  settleDecisions,
  BAND_MODES,
  openDecisions,
  briefMarkdown,
  glanceRows,
  nextBrief,
  parseSummary,
  SUMMARIZE_SYSTEM,
  summarizePrompt,
  validateInput,
} from './brief.ts'
import {
  appendEntries,
  appendSample,
  appendTurn,
  classifyBash,
  classifyMcp,
  ctxView,
  FILE_TOOLS,
  ledgerMarkdown,
  summaryLine,
} from './ledger.ts'
import {
  bandRows,
  duration,
  lastLineOf,
  parseBackgroundStart,
  parseProgress,
  parseTaskEnds,
  progressText,
  pushHistory,
  shortLabel,
  trimJobs,
  visibleLines,
} from './progress.ts'
import type { TaskEnd } from './progress.ts'

// --- state (the facts layer keeps run-ledger's and jobs' shapes) ---

const entriesAtom = atom({ plugin: 'brief', key: 'entries' } as const, [] as LedgerEntry[])
const ctxAtom = atom({ plugin: 'brief', key: 'ctx' } as const, [] as CtxSample[])
const failsAtom = atom({ plugin: 'brief', key: 'fails' } as const, 0)
const turnsAtom = atom({ plugin: 'brief', key: 'turns' } as const, [] as TurnSample[])
const limitsAtom = atom({ plugin: 'brief', key: 'limits' } as const, null as null | { window: number; threshold?: number; isAutoCompact: boolean })
const jobsAtom = atom({ plugin: 'brief', key: 'jobs' } as const, [] as Job[])
const lastPromptAtom = atom({ plugin: 'brief', key: 'lastPromptAt' } as const, 0)
const briefAtom = atom({ plugin: 'brief', key: 'brief' } as const, null as Brief | null)
const decisionsAtom = atom({ plugin: 'brief', key: 'decisions' } as const, [] as Decision[])
const workingAtom = atom({ plugin: 'brief', key: 'isWorking' } as const, false)

const BRIEF_TOOL = 'mcp__brief__brief'
const REPORT_TOOL = 'mcp__brief__report'
const PANE = 'brief'
const ALL_PANE = 'brief-all'
const DATA_DIR = '/.claude/mods-data/brief'
const FALLBACK_MODEL = 'haiku'
// Context grows inside one long autonomous turn, so sample between tool calls too, at most this often.
const SAMPLE_EVERY_MS = 15_000
const POLL_MS = 5_000
const HEARTBEAT_MS = 60_000
const TAIL_BYTES = '16384'

// Without a prompt rule a model-facing tool goes unused (run-ledger's eval: 0/5 → 3/3).
const BRIEF_RULE = `Keep the person's glance view current with ${BRIEF_TOOL}. They run many sessions, check each for a few seconds, and want you to keep going. Call it when your phase of work changes, and as your last tool call before you end any turn in which you used tools, with: status, one line of at most 80 characters on where the work stands; asks, only what truly blocks you (an outward or destructive action such as push, deploy, delete or spend; access or a credential; a choice where a wrong guess would waste most of the remaining work), each naming the exact choice with your recommended option first marked (recommended), or an empty list; decided, each new judgment call you made on their behalf so you could keep going (what you chose, the alternatives, whether it is cheap to undo). The tool answers with the numbered queue: to revise a queued decision send it again with its n; when the person agrees in chat, or it no longer applies, list it in settled (accepted or withdrawn); when they change it, settle the old one and act on the change. Do not stop for a decision you can make reasonably and undo cheaply: decide, record it in decided, and continue. Before an end-of-run report (Changed / Blocked on me / Found), call ${REPORT_TOOL}: build Changed from its facts, Blocked on me from its open asks, and list its open decisions under Blocked on me as 'Decided for you (change if wrong)'.`
const JOBS_RULE =
  'When you start a long-running command with run_in_background and you control its output (a script or loop you write), have it print progress lines `::progress <done>/<total> <what>` (or `::progress <n>%`), and `::status <text>` on a phase change; the user sees them live in the brief band and pane.'

// The module's own variables start over on a hot reload; a lost turn id only skips one fallback.
let lastSampleAt = 0
let currentTurnId: string | undefined
let briefTurnId: string | undefined
// Whether /brief's pane is open (so /brief toggles it), and how much the band shows: full, min (status,
// asks, and only red context or failed jobs), or off. The mode is kept across sessions in $.store.
let paneOpen = false
let bandMode: BandMode = 'full'

// --- facts layer ---

async function sampleContext($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const { tokens, percent } = usage.context
  // Absent before the window's first response and right after a compaction.
  if (tokens === undefined || percent === undefined) return
  const sample: CtxSample = { percent, tokens, usd: usage.cost?.usd, at: await $.clock.now() }
  await update($, ctxAtom, prev => appendSample(prev, sample))
}

// Once per main-loop turn: the turn's end size (growth per turn) and the compaction threshold.
async function sampleTurn($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const { tokens, window, breakdown } = usage.context
  const limits =
    breakdown?.autoCompactThreshold === undefined
      ? { window, isAutoCompact: breakdown?.isAutoCompactEnabled ?? false }
      : { window, threshold: breakdown.autoCompactThreshold, isAutoCompact: breakdown.isAutoCompactEnabled }
  await update($, limitsAtom, () => limits)
  if (tokens === undefined) return
  const turn: TurnSample = { tokens, at: await $.clock.now() }
  await update($, turnsAtom, prev => appendTurn(prev, turn))
}

// Working: a main-loop turn is running, or a background shell or agent it started still is. A turn that
// ended while its subagents run must not read as done.
// The decision queue outlives the process: kept per session in $.store, so a resumed session (claude --resume,
// claude -p --resume) gets back what the person has not reviewed yet. /clear drops it; entries expire after a while.
const DECISIONS_KEY = 'decisions:'
const DECISIONS_TTL_MS = 14 * 86_400_000

async function changeDecisions($: EngineInterface, fn: (prev: Decision[]) => Decision[]): Promise<void> {
  await update($, decisionsAtom, prev => fn(prev ?? []))
  try {
    await $.store.set(DECISIONS_KEY + (await $.session.id()), { at: await $.clock.now(), list: await read($, decisionsAtom) })
  } catch {
    // best effort: the queue still works for this process
  }
}

async function loadDecisions($: EngineInterface): Promise<void> {
  try {
    const now = await $.clock.now()
    const saved = (await $.store.get(DECISIONS_KEY + (await $.session.id()))) as { at?: number; list?: Decision[] } | undefined
    if (Array.isArray(saved?.list)) await update($, decisionsAtom, () => saved.list as Decision[])
    for (const key of await $.store.keys()) {
      if (!key.startsWith(DECISIONS_KEY)) continue
      const v = (await $.store.get(key)) as { at?: number } | undefined
      if (typeof v?.at !== 'number' || now - v.at > DECISIONS_TTL_MS) await $.store.delete(key)
    }
  } catch {
    // no store, or an unreadable entry: start with an empty queue
  }
}

async function isBusy($: EngineInterface): Promise<boolean> {
  return (await read($, workingAtom)) || (await read($, jobsAtom)).some(j => j.status === 'running' && j.kind !== 'watch')
}

async function redraw($: EngineInterface): Promise<void> {
  $.ui.invalidate('ui.render')
}

async function endJobs($: EngineInterface, ends: readonly TaskEnd[]): Promise<void> {
  if (ends.length === 0) return
  const now = await $.clock.now()
  const done: Job[] = []
  await update($, jobsAtom, prev => {
    const list = (prev ?? []).map(job => {
      const end = ends.find(x => x.id === job.id)
      if (end === undefined || job.status !== 'running') return job
      const next: Job = { ...job, status: end.status, endedAt: now }
      if (end.exitCode !== undefined) next.exitCode = end.exitCode
      done.push(next)
      return next
    })
    return trimJobs(list)
  })
  // Only what you'd otherwise miss gets a toast; a completed job is a dim band row.
  for (const job of done) if (job.status !== 'completed') $.ui.toast(`${job.label}: ${progressText(job, now)}`)
  await redraw($)
}

async function addJob($: EngineInterface, job: Job): Promise<void> {
  await update($, jobsAtom, prev => trimJobs([...(prev ?? []).filter(j => j.id !== job.id), job]))
  await redraw($)
}

// One pass over running jobs: tail logs that grew, ask the engine about agents.
async function poll($: EngineInterface): Promise<void> {
  const jobs = await read($, jobsAtom)
  const running = jobs.filter(j => j.status === 'running')
  // Still refresh when idle, so a finished job leaves the band once it is no longer recent.
  if (running.length === 0) return redraw($)
  const now = await $.clock.now()
  const changes = new Map<string, Partial<Job>>()

  for (const job of running) {
    if (job.file === undefined) continue
    try {
      const stat = await $.fs.stat(job.file)
      if (stat.size === job.size) continue
      const tail = await $.process.run(['tail', '-c', TAIL_BYTES, job.file], { timeoutMs: 3_000 })
      const lines = visibleLines(tail.stdout)
      const progress = parseProgress(lines)
      const change: Partial<Job> = { size: stat.size, changedAt: now, history: pushHistory(job.history, now, progress?.pct) }
      const last = lastLineOf(lines)
      if (last !== undefined) change.lastLine = last
      if (progress !== undefined) change.progress = progress
      changes.set(job.id, change)
    } catch {
      // A log that vanished or cannot be read leaves the job as it was.
    }
  }

  const ends: TaskEnd[] = []
  if (running.some(j => j.kind === 'agent')) {
    const agents = await $.agent.list()
    for (const job of running.filter(j => j.kind === 'agent')) {
      const agent = agents.find(a => a.id === job.id)
      if (agent === undefined || agent.status === 'running') continue
      ends.push({ id: job.id, status: agent.status === 'completed' ? 'completed' : agent.status === 'killed' ? 'killed' : 'failed' })
    }
  }

  if (changes.size > 0) {
    await update($, jobsAtom, prev => (prev ?? []).map(j => ({ ...j, ...(changes.get(j.id) ?? {}) })))
  }
  await endJobs($, ends)
  await redraw($)
}

// --- narrative layer ---

async function sessionFile($: EngineInterface, sessionId?: string): Promise<string | undefined> {
  const home = await $.env.get('HOME')
  if (home === undefined) return undefined
  return `${home}${DATA_DIR}/${sessionId ?? (await $.session.id())}.json`
}

// Mirror the brief for other sessions' /brief all. Best effort: a failed write changes nothing here.
async function writeSessionFile($: EngineInterface): Promise<void> {
  try {
    const path = await sessionFile($)
    const brief = await read($, briefAtom)
    if (path === undefined || brief === null) return
    const cwd = await $.session.cwd()
    const repo = await $.session.repo()
    const base = (repo?.root ?? cwd).split('/').pop() ?? cwd
    const record: SessionRecord = {
      sessionId: await $.session.id(),
      label: repo !== null && cwd !== repo.root ? `${base}/${cwd.split('/').pop()}` : base,
      cwd,
      status: brief.status,
      asks: brief.asks,
      isWorking: await isBusy($),
      at: await $.clock.now(),
      briefAt: brief.at,
      decided: openDecisions(await read($, decisionsAtom)).map(d => ({ n: d.n, text: d.text })),
    }
    await $.fs.write(path, JSON.stringify(record))
  } catch {
    // ignore
  }
}

async function readSessionFiles($: EngineInterface): Promise<SessionRecord[]> {
  const home = await $.env.get('HOME')
  if (home === undefined) return []
  const dir = `${home}${DATA_DIR}`
  if (!(await $.fs.exists(dir))) return []
  const out: SessionRecord[] = []
  for (const entry of await $.fs.list(dir)) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const r = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Partial<SessionRecord> | null
      // Valid JSON of another shape (an older version, a stray file) is skipped like unparsable JSON.
      if (r !== null && typeof r === 'object' && typeof r.sessionId === 'string' && typeof r.status === 'string' && typeof r.at === 'number' && Array.isArray(r.asks)) {
        out.push(r as SessionRecord)
      }
    } catch {
      // a file mid-write or not ours
    }
  }
  return out
}

async function setBrief($: EngineInterface, brief: Brief): Promise<void> {
  await update($, briefAtom, () => brief)
  await redraw($)
  await writeSessionFile($)
}

// TurnFallback: the turn ended without a brief call, so haiku reads the final answer.
// Started without awaiting; a result that lands after the next turn began is dropped.
async function fallback($: EngineInterface, turnId: string, answer: string): Promise<void> {
  const prev = await read($, briefAtom)
  const reply = await $.model.complete({ model: FALLBACK_MODEL, system: SUMMARIZE_SYSTEM, prompt: summarizePrompt(prev, answer), maxTokens: 600 })
  if (!reply.isAnswered) {
    $.ui.log(`brief: turn-end summary failed (${reply.reason})`)
    return
  }
  const parsed = parseSummary(reply.text)
  if (parsed === undefined) {
    $.ui.log('brief: turn-end summary was not JSON')
    return
  }
  if (currentTurnId !== turnId || briefTurnId === turnId) return
  await setBrief($, nextBrief(await read($, briefAtom), parsed, 'fallback', await $.clock.now()))
}

async function reportText($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const jobs = await read($, jobsAtom)
  const running = jobs.filter(j => j.status === 'running')
  const jobLines =
    jobs.length === 0
      ? []
      : ['### Background jobs', ...jobs.map(j => `- ${j.status === 'running' ? 'running' : j.status} ${j.label}  ${duration((j.endedAt ?? now) - j.startedAt)}  ${progressText(j, now)}`)]
  const ledger = ledgerMarkdown(
    await read($, entriesAtom),
    await read($, ctxAtom),
    await read($, failsAtom),
    await read($, turnsAtom),
    await read($, limitsAtom),
  )
  const note = running.length > 0 ? `\n\n${running.length} background job(s) still running.` : ''
  return [briefMarkdown(await read($, briefAtom), now, await read($, decisionsAtom)), ledger, ...jobLines].join('\n\n') + note
}

async function briefCommand($: EngineInterface, args: string): Promise<{ text: string }> {
  const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const now = await $.clock.now()

  if (verb !== undefined && (BAND_MODES as readonly string[]).includes(verb)) {
    bandMode = verb as BandMode
    await $.store.set('bandMode', bandMode)
    await redraw($)
    return { text: bandMode === 'off' ? 'Brief band off (it stays off in new sessions). /brief full or /brief min turns it back on; /brief still opens the pane.' : `Brief band: ${bandMode}.` }
  }
  if (verb === 'ok') {
    const which = rest[0] === undefined ? undefined : Number(rest[0])
    let count = 0
    await changeDecisions($, prev => prev.map(d => (d.status === 'open' && (which === undefined || d.n === which) ? (count++, { ...d, status: 'accepted' as const }) : d)))
    await redraw($)
    return { text: count === 0 ? (which === undefined ? 'No open decisions.' : `No open decision ${which}.`) : `Accepted ${count} decision(s).` }
  }
  if (verb === 'change') {
    const which = Number(rest[0])
    const answer = rest.slice(1).join(' ')
    const d = openDecisions(await read($, decisionsAtom)).find(x => x.n === which)
    if (d === undefined || answer === '') return { text: 'Usage: /brief change <N> <what to do instead> (N from the decided list)' }
    await changeDecisions($, prev => prev.map(x => (x.n === which ? { ...x, status: 'changed' as const, change: answer } : x)))
    await redraw($)
    // A user turn of its own once the session is idle. Submitting from inside this command would wait on the
    // turn the command holds (the engine refuses it), so it goes out from a timer just after.
    const text = `Change to decision ${which} (you chose: ${d.text}): ${answer}`
    $.clock.after(50, () => {
      void $.prompt.submit({ text }).catch(err => $.ui.log(`brief: could not send the change (${String(err)})`))
    })
    return { text: `Sent to Claude: decision ${which} → ${answer}` }
  }
  if (verb === 'all') {
    await $.ui.open({ id: ALL_PANE, title: 'All sessions' })
    return { text: allViewText(await readSessionFiles($), await $.session.id(), now) }
  }
  if (verb === 'reset') {
    // A new baseline for a new task in a long session; context figures are the session's and stay.
    await update($, entriesAtom, () => [])
    await update($, failsAtom, () => 0)
    await update($, briefAtom, () => null)
    await changeDecisions($, () => [])
    // A turn-end summary still running must not bring the old brief back.
    briefTurnId = currentTurnId
    await redraw($)
    return { text: 'Brief reset: status, asks, changes, outward actions and failures start from zero.' }
  }
  if (verb === 'watch') {
    const [file, ...label] = rest
    if (file === undefined) return { text: 'Usage: /brief watch <file> [label]' }
    if (!(await $.fs.exists(file))) return { text: `No such file: ${file}` }
    await addJob($, {
      id: `watch:${file}`,
      kind: 'watch',
      label: shortLabel(label.length > 0 ? label.join(' ') : (file.split('/').pop() ?? file)),
      file,
      startedAt: now,
      status: 'running',
      history: [],
    })
    void poll($)
    return { text: `Watching ${file}.` }
  }
  if (verb === 'unwatch') {
    const key = rest.join(' ')
    await update($, jobsAtom, prev => (prev ?? []).filter(j => !(j.kind === 'watch' && (j.label === key || j.file === key))))
    await redraw($)
    return { text: `Stopped watching ${key}.` }
  }
  if (verb === 'clear') {
    await update($, jobsAtom, prev => (prev ?? []).filter(j => j.status === 'running'))
    await redraw($)
    return { text: 'Cleared finished jobs.' }
  }

  // /brief with no argument toggles the pane.
  if (paneOpen) {
    await $.ui.close({ id: PANE })
    paneOpen = false
    return { text: 'Closed the brief pane.' }
  }
  await $.ui.open({ id: PANE, title: 'Brief' })
  paneOpen = true
  return { text: await reportText($) }
}
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brief',
      description: 'Toggle the brief pane (full|min|off: how much the band shows; all: every live session; reset: new baseline)',
      argumentHint: '[ok [N] | change N <answer> | full | min | off | all | reset | watch <file> [label] | unwatch <label> | clear]',
      immediate: true,
    })
    // Aliases for the commands of the two mods brief replaced. While those mods are still loaded the engine may let
    // either answer (hook order decides); a refusal (a built-in name) leaves brief running without the alias.
    for (const name of ['ledger', 'jobs']) {
      await $.command
        .register({ name, description: `Alias of /brief (was the ${name} mod)`, argumentHint: '[reset | watch <file> [label] | unwatch <label> | clear]', immediate: true })
        .catch(() => undefined)
    }
    await $.tool.register({
      name: 'brief',
      description:
        "Set the person's glance view of this session: a one-line status, the complete list of what blocks you (replaces the previous asks; [] means nothing blocks), and any new decisions you made for them so you could keep going (queued for their review).",
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Where the work stands, at most 80 characters' },
          asks: {
            type: 'array',
            description: 'Only what blocks you (outward or destructive action, access, or a choice a wrong guess would waste most work on), most blocking first; [] when nothing',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Starts with a verb and names the exact choice or action, your recommended option first marked (recommended); at most 120 characters' },
                kind: { type: 'string', enum: ['decision', 'approval', 'action', 'access', 'review', 'info'] },
              },
              required: ['text', 'kind'],
            },
          },
          decided: {
            type: 'array',
            description: 'New judgment calls you made for the person so you could keep going; each joins a review queue. [] when none',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'What you chose, at most 120 characters' },
                alternatives: { type: 'string', description: 'What you did not choose' },
                reversible: { type: 'boolean', description: 'false when it would be costly to undo' },
                n: { type: 'number', description: 'To revise a queued decision instead of adding one: its number' },
              },
              required: ['text'],
            },
          },
          settled: {
            type: 'array',
            description: 'Queued decisions to take off the queue: accepted when the person agreed in chat, withdrawn when no longer relevant',
            items: {
              type: 'object',
              properties: { n: { type: 'number' }, as: { type: 'string', enum: ['accepted', 'withdrawn'] } },
              required: ['n', 'as'],
            },
          },
        },
        required: ['status', 'asks'],
      },
    })
    await $.tool.register({
      name: 'report',
      description:
        "This session's facts (PRs, commits, tags, publishes, paid calls, outward writes, files edited, failures, background jobs, context use) and its open asks. Read it before writing the end-of-run Changed / Blocked on me / Found report.",
      inputSchema: { type: 'object', properties: {} },
    })
    await loadDecisions($)
    const saved = await $.store.get('bandMode')
    if (typeof saved === 'string' && (BAND_MODES as readonly string[]).includes(saved)) bandMode = saved as BandMode
    $.clock.every(POLL_MS, () => {
      void poll($)
    })
    // Heartbeat for /brief all: a session that stops writing (crashed, closed) drops out after LIVE_MS.
    $.clock.every(HEARTBEAT_MS, () => {
      void writeSessionFile($)
    })
    return next(e)
  })

  // /clear and /resume end this conversation while the process lives on: forget its brief, and drop any
  // turn-end summary still running, so nothing of it is shown or written under the next session's id.
  on('session.end', async ($, e, next) => {
    currentTurnId = undefined
    briefTurnId = undefined
    await update($, briefAtom, () => null)
    // The queue stays in $.store for a resume; /clear ends the conversation, so it goes.
    await update($, decisionsAtom, () => [])
    if (e.reason === 'clear') await Promise.resolve($.store.delete(DECISIONS_KEY + e.sessionId)).catch(() => undefined)
    const path = await sessionFile($, e.sessionId)
    if (path !== undefined) await $.process.run(['rm', '-f', path], { timeoutMs: 3_000 }).catch(() => undefined)
    return next(e)
  })

  // The pane closed by its × or Esc, or by an unload: the next /brief opens it again.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) paneOpen = false
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    currentTurnId = e.turnId
    await update($, workingAtom, () => true)
    await redraw($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Subagent turns fire this too; only the main loop's window and brief are the ones on screen.
    if (e.agentId !== undefined) return done
    await update($, workingAtom, () => false)
    lastSampleAt = await $.clock.now()
    await sampleContext($)
    await sampleTurn($)
    await writeSessionFile($)
    // The fallback runs when the turn did not END on a brief call (one earlier in the turn does not count).
    if (briefTurnId !== e.turnId && !e.isAborted && e.answer.trim() !== '') {
      void fallback($, e.turnId, e.answer).catch(err => $.ui.log(`brief: turn-end summary failed (${String(err)})`))
    }
    await redraw($)
    return done
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === BRIEF_TOOL) {
      // The glance view is the main session's; a subagent's status would overwrite it.
      if (e.agentId !== undefined) return { result: 'Not recorded: only the main session sets the brief.' }
      const checked = validateInput(e)
      if (!checked.ok) return { isError: true, result: checked.error, text: checked.error }
      briefTurnId = currentTurnId
      const now = await $.clock.now()
      if (checked.value.settled.length > 0 || checked.value.decided.length > 0) {
        await changeDecisions($, prev => appendDecisions(settleDecisions(prev, checked.value.settled), checked.value.decided, now))
      }
      await setBrief($, nextBrief(await read($, briefAtom), checked.value, 'tool', now))
      return { result: queueText(await read($, decisionsAtom)) }
    }
    if (e.tool === REPORT_TOOL) return { result: await reportText($) }
    // Work after a brief call makes that brief possibly stale: the fallback summarizes the turn's end unless
    // the brief tool is called again.
    if (e.agentId === undefined) briefTurnId = undefined

    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const now = await $.clock.now()

    if (e.tool === 'Bash') {
      if (ran.isError === true) await update($, failsAtom, n => (n ?? 0) + 1)
      const found = classifyBash(e.command, ran.text ?? '', now, ran.isError === true)
      if (found.length > 0) await update($, entriesAtom, prev => appendEntries(prev, found))
      // Only a call that asked for the background: a foreground command whose output merely quotes the
      // engine's notice (cat of a test fixture, a log) is not a job.
      const started = ran.isError === true || e.run_in_background !== true ? undefined : parseBackgroundStart(ran.text ?? '')
      if (started !== undefined) {
        const job: Job = { id: started.id, kind: 'shell', label: shortLabel(e.description ?? e.command), startedAt: now, status: 'running', history: [] }
        if (started.file !== undefined) job.file = started.file
        await addJob($, job)
      }
    } else if (ran.isError !== true) {
      if (e.tool === 'Agent') {
        const result = ran.result as { status?: string; agentId?: string; description?: string } | undefined
        if (result?.status === 'async_launched' && result.agentId !== undefined) {
          await addJob($, { id: result.agentId, kind: 'agent', label: shortLabel(`agent: ${result.description ?? 'background'}`), startedAt: now, status: 'running', history: [] })
        }
      } else if (e.tool === 'TaskStop') {
        const id = e.task_id ?? e.shell_id
        if (id !== undefined) await endJobs($, [{ id, status: 'killed' }])
      }
      const filePath = FILE_TOOLS.has(String(e.tool)) ? (e as { file_path?: unknown }).file_path : undefined
      const found =
        typeof filePath === 'string' ? { kind: 'file' as const, label: filePath, at: now } : classifyMcp(String(e.tool), now)
      if (found !== undefined) await update($, entriesAtom, prev => appendEntries(prev, [found]))
    }

    if (now - lastSampleAt >= SAMPLE_EVERY_MS) {
      lastSampleAt = now
      await sampleContext($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Completion: the engine appends a <task-notification> row (and may deliver one) when a task ends.
  on('session.append', async ($, e, next) => {
    const text = JSON.stringify(e.message.content ?? '')
    if (text.includes('task-notification')) await endJobs($, parseTaskEnds(text.replace(/\\n/g, '\n')))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.receive', async ($, e, next) => {
    if (e.text.includes('task-notification')) await endJobs($, parseTaskEnds(e.text))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Failed job rows stay until the person's next prompt; asks written before it turn dim.
  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, lastPromptAtom, () => now)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const sections = [...composed.sections]
    if (e.tools.includes(BRIEF_TOOL)) sections.push({ id: 'brief:rule', text: BRIEF_RULE, scope: 'session' })
    if (e.tools.includes('Bash')) sections.push({ id: 'brief:progress', text: JOBS_RULE, scope: 'session' })
    return { sections }
  })

  // /ledger and /jobs are the old mods' commands, kept as aliases of /brief.
  for (const command of ['brief', 'ledger', 'jobs'] as const) {
    on('command.run', { command }, async ($, e) => briefCommand($, e.args)).catch(() => ({
      text: 'brief: the command failed; see the debug log.',
    }))
  }

  // The band: glance rows (status, asks), then the ledger line, then job rows, then whatever is beneath.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || bandMode === 'off') return below
    const now = await $.clock.now()
    const columns = Math.max(20, e.props.bodyColumns - 1)
    const glance = glanceRows(await read($, briefAtom), await isBusy($), now, columns, await read($, lastPromptAtom), await read($, decisionsAtom))
    const minimal = bandMode === 'min'
    const summary = minimal ? '' : summaryLine(await read($, entriesAtom))
    const view = ctxView(await read($, ctxAtom), await read($, turnsAtom), await read($, limitsAtom))
    const jobRows = bandRows(await read($, jobsAtom), now, columns, await read($, lastPromptAtom)).filter(r => !minimal || r.tone === 'failed')
    const ctx = minimal && view?.level !== 'hot' ? undefined : view?.text
    if (glance.length === 0 && ctx === undefined && summary === '' && jobRows.length === 0) return below
    const ctxColor = view?.level === 'hot' ? 'red' : view?.level === 'warn' ? 'yellow' : undefined
    const status = glance.filter(r => r.tone === 'status' || r.tone === 'age')
    const asks = glance.find(r => r.tone === 'ask' || r.tone === 'ask-seen')
    const decided = glance.find(r => r.tone === 'decided')
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {status.length === 0 ? null : (
          <Box flexDirection="row">
            {status.map(r => (r.tone === 'age' ? <Text key={r.key} dimColor>{r.text}</Text> : <Text key={r.key} wrap="truncate-end">{r.text}</Text>))}
          </Box>
        )}
        {asks === undefined ? null : asks.tone === 'ask' ? (
          <Text key="asks" color="yellow" wrap="truncate-end">{asks.text}</Text>
        ) : (
          <Text key="asks" dimColor wrap="truncate-end">{asks.text}</Text>
        )}
        {decided === undefined ? null : <Text key="decided" dimColor wrap="truncate-end">{decided.text}</Text>}
        {ctx === undefined && summary === '' ? null : (
          <Box flexDirection="row">
            {ctx === undefined ? null : ctxColor === undefined ? <Text dimColor>{ctx}</Text> : <Text color={ctxColor}>{ctx}</Text>}
            {summary === '' ? null : <Text dimColor>{`${ctx === undefined ? '' : '   '}${summary}`}</Text>}
          </Box>
        )}
        {jobRows.map(row =>
          row.tone === 'failed' ? (
            <Text key={row.key} color="red">{row.text}</Text>
          ) : (
            <Text key={row.key} dimColor={row.tone === 'done'}>{row.text}</Text>
          ),
        )}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const width = Math.max(20, e.props.bodyColumns - 2)
    const brief = await read($, briefAtom)
    const jobs = await read($, jobsAtom)
    const ordered = [...jobs.filter(j => j.status === 'running'), ...jobs.filter(j => j.status !== 'running').reverse()]
    const view = ctxView(await read($, ctxAtom), await read($, turnsAtom), await read($, limitsAtom))
    const summary = summaryLine(await read($, entriesAtom))

    return (
      <Box flexDirection="column">
        <Text bold wrap="wrap">{brief === null ? 'No brief yet.' : brief.status}</Text>
        {brief === null ? null : <Text dimColor>{`${brief.source === 'tool' ? 'from Claude' : 'summarized at turn end'} · ${duration(now - brief.at)} ago`}</Text>}
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Needs you</Text>
          {brief === null || brief.asks.length === 0 ? (
            <Text dimColor>nothing</Text>
          ) : (
            brief.asks.map((a, i) => <Text key={`ask:${i}`} wrap="wrap">{`- ${a.text}  (${a.kind}, ${duration(now - a.since)})`}</Text>)
          )}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Facts</Text>
          {view === undefined ? null : <Text dimColor>{view.text}</Text>}
          <Text dimColor wrap="wrap">{summary === '' ? 'Nothing changed or sent out yet.' : summary}</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Background jobs</Text>
          {ordered.length === 0 ? <Text dimColor>none</Text> : null}
          {ordered.map(job => (
            <Box key={job.id} flexDirection="column">
              <Box flexDirection="row">
                <Text bold={job.status === 'running'} dimColor={job.status !== 'running'} color={job.status === 'failed' ? 'red' : undefined} wrap="truncate-end">
                  {`${job.label}  ${duration((job.endedAt ?? now) - job.startedAt)}  ${progressText(job, now)}  `}
                </Text>
                {job.status === 'running' && job.kind !== 'watch' ? (
                  <Button key={`stop:${job.id}`} label="stop" onPress={async () => {
                    await $.tool.call({ tool: 'TaskStop', task_id: job.id })
                    await endJobs($, [{ id: job.id, status: 'killed' }])
                  }} />
                ) : null}
                {job.kind === 'watch' && job.status === 'running' ? (
                  <Button key={`unwatch:${job.id}`} label="unwatch" onPress={async () => {
                    await update($, jobsAtom, prev => (prev ?? []).filter(j => j.id !== job.id))
                    await redraw($)
                  }} />
                ) : null}
              </Box>
              {job.lastLine === undefined ? null : <Text dimColor wrap="truncate-end">{job.lastLine.slice(0, width)}</Text>}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: ALL_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const text = allViewText(await readSessionFiles($), await $.session.id(), await $.clock.now())
    return (
      <Box flexDirection="column">
        {text.split('\n').map((line, i) =>
          line.startsWith('    needs you') ? (
            <Text key={`l${i}`} color="yellow" wrap="truncate-end">{line}</Text>
          ) : (
            <Text key={`l${i}`} wrap="truncate-end">{line}</Text>
          ),
        )}
      </Box>
    )
  })
}
