import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Question } from '../types'
import { activity, activityText, askSpec, askText, DEFAULT_MS, fitAsk, isAscii, nextFire } from '../hooks/band'
import { answerRow, ASK_DESCRIPTION, defaultQuestion, driftQuestion, readText, RULE, snapshot, validateAsk } from '../hooks/model'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const NOW = 10_000_000
const MIN = 60_000

// The asks the reference captures were drawn with.
const publish: Question = { id: 'D3', kind: 'agent', question: 'Publish the mod to GitHub?', short: 'Push to GitHub?', options: ['private', 'public', 'later'], blocking: true, at: NOW - 6 * MIN, status: 'open' }
const deliver: Question = { id: 'D4', kind: 'agent', question: 'Deliver your answers mid-turn?', short: 'Answers mid-turn?', options: ['mid-turn', 'next turn'], blocking: false, at: NOW - DEFAULT_MS + 4 * MIN, status: 'open' }
const drift = driftQuestion('D5', "Status-line entry", 7, NOW)

const line = (q: Question, plus: number, columns: number): string => {
  const spec = askSpec(q, plus, NOW)
  return askText(spec, fitAsk(spec, columns), columns)
}

// Reference lines as captured, less the engine's `[-]` mark and the padding before it.
const strip = (s: string): string => s.replace(/\s*\[-\]$/, '').replace(/\s+$/, '')

test('fit at 75 cells (80 columns): every reference ask line', async () => {
  expect(line(publish, 1, 75)).toBe(strip('! Publish the mod to GitHub?  1: private  2: public  3: later        +1  6m [-]'))
  expect(line(deliver, 0, 75)).toBe('? Deliver your answers mid-turn?  1: mid-turn  2: next turn   default in 4m')
  expect(line(drift, 0, 75)).toBe("? Status-line entry isn't in done-when  1: keep  2: drop       after turn 7")
  // Each fills the line exactly to 75 when it has meta: flush right, nothing past the body.
  for (const s of [line(publish, 1, 75), line(deliver, 0, 75), line(drift, 0, 75)]) expect(s.length).toBe(75)
})

test('fit at 55 cells (60 columns): short question, short meta, +n kept', async () => {
  const p = askSpec(publish, 1, NOW)
  expect(fitAsk(p, 55).form).toBe(4)
  expect(line(publish, 1, 55)).toBe('! Push to GitHub?  1: private  2: public  3: later   +1')
  const d = askSpec(deliver, 0, NOW)
  expect(fitAsk(d, 55).form).toBe(3)
  expect(line(deliver, 0, 55)).toBe('? Answers mid-turn?  1: mid-turn  2: next turn       4m')
  for (const s of [line(publish, 1, 55), line(deliver, 0, 55)]) expect(s.length).toBeLessThanOrEqual(55)
})

test('fit falls through the forms in order, and never exceeds the width while one fits', async () => {
  const p = askSpec(publish, 1, NOW)
  expect([80, 75, 69, 68, 67, 57, 56, 54, 50, 49].map(w => fitAsk(p, w).form)).toEqual([1, 1, 1, 2, 3, 3, 4, 4, 5, 6])
  for (let w = 20; w <= 120; w++) {
    const fit = fitAsk(p, w)
    if (fit.form < 6) expect(askText(p, fit, w).length).toBeLessThanOrEqual(w)
  }
})

test('activity line: between-turn states and the done form', async () => {
  const steps = [
    { id: '1', subject: 'Types', status: 'completed' as const },
    { id: '2', subject: 'Fit function', status: 'completed' as const },
    { id: '3', subject: 'Register brief_ask', status: 'in_progress' as const },
    { id: '4', subject: 'Band', status: 'pending' as const },
    { id: '5', subject: 'Snapshot', status: 'pending' as const },
    { id: '6', subject: 'Captures', status: 'pending' as const },
  ]
  const base = { steps, doneWhen: [], jobs: [], crons: [], startedAt: NOW - 22 * MIN, endedAt: NOW - 2 * MIN, now: NOW }
  const waiting = activity({ ...base, jobs: [{ id: 'b1', label: 'plugin test', since: NOW - 72_000 }] }, 75)
  expect(waiting && activityText(waiting)).toBe('3/6 Register brief_ask  waiting on plugin test 1m12s')
  const ended = activity(base, 75)
  expect(ended && activityText(ended)).toBe('3/6 Register brief_ask  ended 2m ago')
  const done = activity({ ...base, steps: steps.map(s => ({ ...s, status: 'completed' as const })), doneWhen: [1, 2, 3].map(i => ({ text: `c${i}`, met: true })) }, 75)
  expect(done && activityText(done)).toBe('6/6 done  3/3 done-when met  22m')
  // No task tool: the done-when count stands in.
  const fallback = activity({ ...base, steps: [], doneWhen: [{ text: 'pane draws', met: true }, { text: 'tests pass', met: false }] }, 75)
  expect(fallback && activityText(fallback)).toBe('1/2 tests pass  ended 2m ago')
  // Nothing tracked: silence.
  expect(activity({ ...base, steps: [] }, 75)).toBeUndefined()
  // The step gives way before the state does.
  const narrow = activity({ ...base, jobs: [{ id: 'b1', label: 'plugin test', since: NOW - 72_000 }] }, 40)
  expect(narrow && activityText(narrow).length).toBeLessThanOrEqual(40)
})

test('cron: next fire of a wakeup and a recurring schedule', async () => {
  const t = new Date(2026, 9, 17, 9, 58, 30).getTime()
  expect(nextFire('0 10 * * *', t)).toBe(new Date(2026, 9, 17, 10, 0).getTime())
  expect(nextFire('*/5 * * * *', t)).toBe(new Date(2026, 9, 17, 10, 0).getTime())
  expect(nextFire('bogus', t)).toBeUndefined()
})

test('ASCII only: every string the mod produces', async () => {
  const strings = [
    ...[75, 55, 40].flatMap(w => [line(publish, 1, w), line(deliver, 0, w), line(drift, 0, w)]),
    line(defaultQuestion('D6', deliver, NOW), 0, 75),
    answerRow(publish, 'private') ?? '',
    answerRow(drift, 'keep') ?? '',
    answerRow(defaultQuestion('D6', deliver, NOW), 'drop') ?? '',
    ...snapshot({ goal: 'Ship v0', doneWhen: [{ text: 'tests pass', met: false }], questions: [publish, deliver], steps: [], check: { turn: 6, onTrack: true, unplanned: [] }, changes: { since: NOW - 9 * MIN, done: ['band'], asks: 2, answers: 0, edits: 3 }, ctxPercent: 41, assumptions: [], now: NOW }).map(l => l.text),
    readText({ goal: 'Ship v0', doneWhen: [], questions: [publish], steps: [], check: null, changes: { since: 0, done: [], asks: 0, answers: 0, edits: 0 }, ctxPercent: undefined, assumptions: ['x'], now: NOW }),
    RULE,
    'sent: private',
  ]
  for (const s of strings) for (const l of s.split('\n')) expect([l, isAscii(l)]).toEqual([l, true])
  // The agent's own strings are checked at the door.
  expect(validateAsk({ question: 'Ship it→now?', short: 'Ship?', options: ['yes', 'no'] }).ok).toBe(false)
})

test('brief_ask limits and the fixed texts', async () => {
  expect(validateAsk({ question: 'x'.repeat(61), short: 's', options: ['a', 'b'] }).ok).toBe(false)
  expect(validateAsk({ question: 'q', short: 's'.repeat(25), options: ['a', 'b'] }).ok).toBe(false)
  expect(validateAsk({ question: 'q', short: 's', options: ['a'.repeat(13), 'b'] }).ok).toBe(false)
  expect(validateAsk({ question: 'q', short: 's', options: ['a'] }).ok).toBe(false)
  expect(validateAsk({ question: 'q', short: 's', options: '["a","b"]' })).toEqual({ ok: true, value: { question: 'q', short: 's', options: ['a', 'b'], blocking: false } })
  expect(ASK_DESCRIPTION).toBe("Queue a multiple-choice question without stopping. Put your default first; it applies if they don't answer in time.")
  expect(answerRow(publish, 'private')).toBe('[brief] D3 -> private (you). Resume with private.')
})

// --- live: the hooks against the engine ---

const BAND = (columns: number, extra: { hasSurvey?: boolean; isWorking?: boolean } = {}) =>
  ({
    plugin: 'brief',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    viewport: { columns: columns + 5, rows: 30 },
    props: { hasSurvey: extra.hasSurvey ?? false, isWorking: extra.isWorking ?? false, maxRows: 10, bodyColumns: columns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string

// Each row of the band as plain text: Text children, a plain Button as `k: label`, gaps and margins as spaces.
const textOf = (n: unknown): string => {
  if (typeof n === 'string') return n
  if (n === null || typeof n !== 'object') return ''
  const node = n as Exclude<Node, string>
  if (node.type === 'Button') return `${String(node.props?.hotkey)}: ${String(node.props?.label)}`
  const gap = typeof node.props?.gap === 'number' ? ' '.repeat(node.props.gap) : ''
  const margin = typeof node.props?.marginLeft === 'number' ? ' '.repeat(node.props.marginLeft) : ''
  return margin + (node.children ?? []).map(textOf).filter(s => s !== '').join(gap)
}

const rows = async ($: Engine, columns: number, extra: { hasSurvey?: boolean; isWorking?: boolean } = {}) => {
  const ui = await $.ui.mount({ ...BAND(columns, extra), requestId: 'probe', surface: 'terminal' })
  const tree = (await ui.drawn()) as Node
  await ui.unmount()
  if (typeof tree === 'string' || tree.type !== 'Box' || tree.props?.flexDirection !== 'column') return { beneath: true, rows: [] as string[] }
  return { beneath: false, rows: (tree.children ?? []).map(textOf) }
}

const engine = (on: On) => {
  const prompts: string[] = []
  const notified: string[] = []
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__brief__${e.name}` } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 82_000, window: 200_000, percent: 41 }, rateLimits: [] } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.notify', ($, e) => {
    notified.push(e.text)
    return { value: { isSent: true, channel: 'terminal' } } as never
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['beneath'] }))
  on('model.fork', () => ({ value: { isAnswered: true, text: '{"onTrack": false, "unplanned": ["Status-line entry"]}', usage: { inputTokens: 1, outputTokens: 1 } } }) as never)
  on('session.start', ($, e) => e)
  on('turn.start', ($, e) => e)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'session' as const }] }))
  let task = 0
  on('tool.call', ($, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: String(++task), subject: e.subject } } } : { result: 'ok' }))
  mock.store(on)
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return e
  })
  return { prompts, notified }
}

const start = async ($: Engine) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)

const ask = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__brief__brief_ask', ...input } as never)

test('band: empty when nothing is tracked; at most two lines in every state; no ask under a survey', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { notified } = engine(on)
  await start($)
  expect((await rows($, 75)).beneath).toBe(true)

  for (const subject of ['Types', 'Fit function', 'Register brief_ask', 'Band', 'Snapshot', 'Captures']) {
    await $.tool.call({ tool: 'TaskCreate', subject, description: 'd' } as never)
  }
  for (const id of ['1', '2']) await $.tool.call({ tool: 'TaskUpdate', taskId: id, status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'in_progress' } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'plugin test' }], session_crons: [] })
  await clock.advance(72_000)
  expect((await rows($, 75)).rows).toEqual(['3/6 Register brief_ask  waiting on plugin test 1m12s'])

  const r1 = await ask($, { question: 'Publish the mod to GitHub?', short: 'Push to GitHub?', options: ['private', 'public', 'later'], blocking: true })
  expect(JSON.parse(String(r1.result))).toEqual({ id: 'D1' })
  expect(notified).toEqual(['Publish the mod to GitHub?  private / public / later'])
  await ask($, { question: 'Deliver your answers mid-turn?', short: 'Answers mid-turn?', options: ['mid-turn', 'next turn'] })
  const two = (await rows($, 75)).rows
  expect(two).toHaveLength(2)
  expect(two[1]).toMatch(/^! Publish the mod to GitHub\?  1: private  2: public  3: later  .*\+1  0s$/)
  // A turn running: the spinner carries the activity; the ask stays.
  const working = (await rows($, 75, { isWorking: true })).rows
  expect(working).toHaveLength(1)
  expect(working[0]).toMatch(/^! Publish/)
  // A survey holds the band.
  expect((await rows($, 75, { hasSurvey: true })).beneath).toBe(true)
  // 55 cells: the short form.
  expect((await rows($, 55)).rows[1]).toMatch(/^! Push to GitHub\?  1: private  2: public  3: later  +\+1/)
})

test('the armed ask keeps its hotkeys; an answer is held 3s, undoable, then reaches the agent', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { prompts } = engine(on)
  await start($)
  await ask($, { question: 'Deliver your answers mid-turn?', short: 'Answers mid-turn?', options: ['mid-turn', 'next turn'] })
  // A blocking ask arriving later does not take the armed ask's place while it is on screen.
  await ask($, { question: 'Publish the mod to GitHub?', short: 'Push to GitHub?', options: ['private', 'public', 'later'], blocking: true })
  expect((await rows($, 75)).rows[0]).toMatch(/^\? Deliver your answers/)

  const ui = await $.ui.mount({ ...BAND(75), surface: 'terminal' })
  await ui.press({ key: 'D1:2' })
  expect((await rows($, 75)).rows).toEqual(['sent: next turn  0: undo'])
  await clock.advance(1_000)
  await ui.press({ key: 'undo' })
  expect((await rows($, 75)).rows[0]).toMatch(/^\? Deliver your answers mid-turn\?  1: mid-turn  2: next turn/)
  await clock.advance(5_000)
  expect(prompts).toEqual([])

  await ui.press({ key: 'D1:2' })
  await clock.advance(3_000)
  await clock.advance(500)
  expect(prompts).toEqual(['[brief] D1 -> next turn (you). Switch from mid-turn to next turn.'])
  // The next ask arms: the blocking one, now that nothing is on screen in its place.
  expect((await rows($, 75)).rows[0]).toMatch(/^! Publish the mod to GitHub\?/)
  await ui.unmount()
})

test('mid-turn answers go as one user row; idle ones as a prompt', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { prompts } = engine(on)
  const rowsSeen = mock.session(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await ask($, { question: 'Pick a name?', short: 'Name?', options: ['alpha', 'beta'] })
  const ui = await $.ui.mount({ ...BAND(75), surface: 'terminal' })
  await ui.press({ key: 'D1:1' })
  await clock.advance(3_500)
  await ui.unmount()
  expect(prompts).toEqual([])
  const users = rowsSeen.appended().map(r => JSON.stringify(r.message))
  expect(users.some(u => u.includes('[brief] D1 -> alpha (you). Keep going with alpha.'))).toBe(true)
})

test('defaults apply after 10 minutes and raise keep/drop; a drift check raises its own ask', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on)
  await start($)
  await $.tool.call({ tool: 'mcp__brief__brief_note', goal: 'Ship v0 of the brief mod', doneWhen: ['[x] pane draws', 'answers reach agent', 'tests pass'] } as never)
  await ask($, { question: 'Deliver your answers mid-turn?', short: 'Answers mid-turn?', options: ['mid-turn', 'next turn'] })
  await clock.advance(DEFAULT_MS + 15_000)
  expect((await rows($, 75)).rows.at(-1)).toMatch(/^\? Answers mid-turn\?: went with mid-turn  1: keep  2: drop/)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  await $.turn.complete({ answer: 'did stuff', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await clock.advance(10)
  const read = String((await $.tool.call({ tool: 'mcp__brief__brief_read' } as never)).result)
  expect(read.split('\n').length).toBeLessThanOrEqual(8)
  expect(read).toContain("Status-line entry isn't in done-when")
  expect(read).toContain('drift after turn 1')
})

test('/brief: the model reads "Brief shown."; the row draws the snapshot', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on)
  await start($)
  await $.tool.call({ tool: 'mcp__brief__brief_note', goal: 'Ship v0 of the brief mod: pane + agent ask tool', doneWhen: ['[x] pane draws', 'answers reach agent', 'tests pass'] } as never)
  await ask($, { question: 'Publish the mod to GitHub?', short: 'Push to GitHub?', options: ['private', 'public', 'later'], blocking: true })
  const ran = await $.command.run({ command: 'brief', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(ran.text).toBe('Brief shown.')
  const ui = await $.ui.mount({ plugin: 'brief', surface: 'terminal', component: 'CommandOutput', requestId: 'c1', viewport: { columns: 80, rows: 30 }, props: { command: 'brief', args: '', text: 'Brief shown.', isErrored: false } } as never)
  const tree = (await ui.drawn()) as Exclude<Node, string>
  await ui.unmount()
  const lines = (tree.children ?? []).map(textOf)
  expect(lines).toEqual([
    'Ship v0 of the brief mod: pane + agent ask tool',
    'done when  [x] pane draws  [ ] answers reach agent  [ ] tests pass',
    '! Publish the mod to GitHub?  private / public / later  0s',
    'since 0s  pane draws, 1 ask',
    'ctx 41%',
  ])
  const warn = (tree.children ?? [])[2] as Exclude<Node, string>
  expect(warn.props?.color).toBe('warning')
})

test('spinner: suffix only, after Claude Code\'s own; compose: one fixed section, last', async ($, on) => {
  mock.clock(on, { now: NOW })
  let suffix: string | undefined
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    suffix = e.props.suffix
    return { type: 'Text', props: {}, children: [e.props.word] }
  })
  engine(on)
  await start($)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'a', status: 'completed', activeForm: 'a' }, { content: 'b', status: 'in_progress', activeForm: 'b' }, { content: 'c', status: 'pending', activeForm: 'c' }] } as never)
  const ui = await $.ui.mount({ plugin: 'brief', surface: 'terminal', component: 'Spinner', requestId: 's', viewport: { columns: 80, rows: 30 }, props: { word: 'Baking', message: null, suffix: '…', mode: 'responding' } } as never)
  await ui.unmount()
  expect(suffix).toBe('\u2026 2/3')
  const composed = await $.prompt.compose({ tools: ['mcp__brief__brief_ask', 'mcp__brief__brief', 'Bash'], promptModel: 'claude-opus-5-5', model: 'claude-opus-5-5', surfaces: ['terminal'], outputStyle: null, traits: [], sections: [] } as never)
  const ids = composed.sections.map(s => s.id)
  expect(ids.at(-1)).toBe('brief:rule')
  expect(composed.sections.at(-1)?.text).toBe(RULE)
})
