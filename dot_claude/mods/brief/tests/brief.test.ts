import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// The test environment has timers; the declarations name no DOM.
declare const setTimeout: (fn: (value?: unknown) => void, ms: number) => unknown
type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

import { glanceRows, mergeAsks, parseSummary, summarizePrompt, validateInput, allViewText } from '../hooks/brief.ts'

const BAND = {
  plugin: 'brief',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const USAGE = { value: { startedAt: 0, context: { tokens: undefined, window: 200_000, percent: undefined }, rateLimits: [] } }

// The stubs every live test needs beneath the plugin.
const engine = (on: On, own: { registers?: boolean } = {}) => {
  const writes: { path: string; text: string }[] = []
  const models: string[] = []
  const logs: string[] = []
  if (own.registers !== true) {
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('tool.register', ($, e) => ({ value: { tool: `mcp__brief__${e.name}` } }))
  }
  on('session.usage', () => USAGE)
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['beneath'] }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/src/app' }))
  on('session.repo', () => ({ value: null }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.start', ($, e) => e)
  on('prompt.submit', ($, e) => e)
  return { writes, models, logs }
}

const band = async ($: Engine) => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const status = await ui.find({ type: 'Text', text: /^[◐⚠✓] / })
  const asks = await ui.find({ type: 'Text', text: /^needs you/ })
  await ui.unmount()
  return {
    status: status === undefined ? undefined : String(status.children?.[0] ?? ''),
    asks: asks === undefined ? undefined : String(asks.children?.[0] ?? ''),
    asksColor: asks?.props?.color as string | undefined,
  }
}

test('validateInput: limits name themselves; empty asks is fine; string asks accepted', async () => {
  expect(validateInput({ status: 'tests green, opening PR', asks: [] })).toEqual({ ok: true, value: { status: 'tests green, opening PR', asks: [] } })
  const long = validateInput({ status: 'x'.repeat(81), asks: [] })
  expect(long.ok ? '' : long.error).toContain('80')
  const many = validateInput({ status: 's', asks: Array.from({ length: 6 }, (_, i) => ({ text: `a${i}`, kind: 'decision' })) })
  expect(many.ok ? '' : many.error).toContain('at most 5')
  expect(validateInput({ asks: [] }).ok).toBe(false)
  const loose = validateInput({ status: '  two   spaces ', asks: ['Pick a name', { text: 'Approve deploy', kind: 'bogus' }] })
  expect(loose.ok && loose.value).toEqual({ status: 'two spaces', asks: [{ text: 'Pick a name', kind: 'decision' }, { text: 'Approve deploy', kind: 'decision' }] })
})

test('mergeAsks: replacement drops what is gone, unchanged text keeps its age', async () => {
  const prev = [
    { text: 'Pick key name: a or b', kind: 'decision' as const, since: 10 },
    { text: 'Approve push', kind: 'approval' as const, since: 20 },
  ]
  expect(mergeAsks(prev, [{ text: 'pick key name: a or b.', kind: 'decision' }, { text: 'Share the token', kind: 'access' }], 99)).toEqual([
    { text: 'pick key name: a or b.', kind: 'decision', since: 10 },
    { text: 'Share the token', kind: 'access', since: 99 },
  ])
})

test('glanceRows: nothing before a brief; glyph, age when idle, asks dim once the person replied', async () => {
  expect(glanceRows(null, false, 0, 80)).toEqual([])
  const brief = { status: 'migrated 4/7 endpoints', asks: [{ text: 'Pick index name', kind: 'decision' as const, since: 0 }], source: 'tool' as const, at: 0 }
  expect(glanceRows(brief, true, 600_000, 80).map(r => r.text)).toEqual(['◐ migrated 4/7 endpoints', 'needs you (1): Pick index name'])
  const idle = glanceRows(brief, false, 600_000, 80)
  expect(idle.map(r => r.tone)).toEqual(['status', 'age', 'ask'])
  expect(idle[0]?.text).toBe('⚠ migrated 4/7 endpoints')
  expect(idle[1]?.text).toBe('  10m ago')
  expect(glanceRows(brief, false, 600_000, 80, 5)[2]?.tone).toBe('ask-seen')
  expect(glanceRows({ ...brief, asks: [] }, false, 1, 80)[0]?.text).toBe('✓ migrated 4/7 endpoints')
  expect(glanceRows({ ...brief, status: 'x'.repeat(200) }, true, 0, 40)[0]?.text.length).toBe(40)
})

test('parseSummary: takes the JSON out of a fenced reply, clamps, refuses garbage', async () => {
  expect(parseSummary('```json\n{"status":"waiting on review","asks":[{"text":"Review PR #12","kind":"review"}]}\n```')).toEqual({
    status: 'waiting on review',
    asks: [{ text: 'Review PR #12', kind: 'review' }],
  })
  expect(parseSummary('no json here')).toBeUndefined()
  expect(parseSummary('{"asks":[]}')).toBeUndefined()
  expect(parseSummary(`{"status":"${'s'.repeat(120)}","asks":["a","b","c","d","e","f"]}`)?.asks.length).toBe(5)
  expect(summarizePrompt(null, 'x'.repeat(7_000))).toContain('…')
})

test('the brief tool sets the band: status, then asks in yellow until the person replies', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { writes } = engine(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)

  expect((await band($)).status).toBeUndefined()
  const ok = await $.tool.call({ tool: 'mcp__brief__brief', status: 'renamed 3 of 4 call sites', asks: [{ text: 'Pick key name: timeoutMs or requestTimeoutMs', kind: 'decision' }] })
  expect(ok.result).toBe('ok')
  const drawn = await band($)
  expect(drawn.status).toBe('⚠ renamed 3 of 4 call sites')
  expect(drawn.asks).toBe('needs you (1): Pick key name: timeoutMs or requestTimeoutMs')
  expect(drawn.asksColor).toBe('yellow')
  expect(writes.at(-1)?.path).toBe('/home/me/.claude/mods-data/brief/sess-1.json')
  expect(JSON.parse(writes.at(-1)?.text ?? '{}')).toMatchObject({ label: 'app', status: 'renamed 3 of 4 call sites', asks: [{ kind: 'decision' }] })

  await clock.advance(1_000)
  await $.prompt.submit({ text: 'timeoutMs' } as never)
  expect((await band($)).asksColor).toBeUndefined()

  const bad = await $.tool.call({ tool: 'mcp__brief__brief', status: 'x'.repeat(90), asks: [] })
  expect(bad.isError).toBe(true)
  expect(String(bad.result)).toContain('80')

  // a subagent's call does not touch the main session's brief
  await $.tool.call({ tool: 'mcp__brief__brief', status: 'subagent noise', asks: [], agentId: 'a1' } as never)
  expect((await band($)).status).toBe('⚠ renamed 3 of 4 call sites')
})

test('turn end without a brief call: haiku summarizes the answer; with one, it does not run', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on)
  const asked: string[] = []
  on('model.complete', ($, e) => {
    asked.push(String(e.prompt))
    return { value: { isAnswered: true, text: '{"status":"PR #12 open, CI green","asks":[{"text":"Approve merge of PR #12","kind":"approval"}]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)

  await $.turn.start({ text: 'ship it', turnId: 't1' })
  await $.turn.complete({ answer: 'Opened PR #12; CI is green. Blocked on me: approve the merge.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await new Promise(r => setTimeout(r, 20))
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('Opened PR #12')
  expect((await band($)).status).toBe('⚠ PR #12 open, CI green')

  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.tool.call({ tool: 'mcp__brief__brief', status: 'merged PR #12', asks: [] })
  await $.turn.complete({ answer: 'Merged.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  await new Promise(r => setTimeout(r, 20))
  expect(asked.length).toBe(1)
  expect((await band($)).status).toBe('✓ merged PR #12')
})

test('a fallback that lands after the next turn started is dropped', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on)
  let release: () => void = () => undefined
  on('model.complete', async () => {
    await new Promise<void>(r => {
      release = r
    })
    return { value: { isAnswered: true, text: '{"status":"stale summary","asks":[]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)

  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.turn.complete({ answer: 'done with a', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await $.turn.start({ text: 'b', turnId: 't2' })
  await $.tool.call({ tool: 'mcp__brief__brief', status: 'working on b', asks: [] })
  release()
  await new Promise(r => setTimeout(r, 20))
  expect((await band($)).status).toBe('◐ working on b')
})

test('prompt rule, report tool, and /brief all', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on)
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [{ name: 'sess-1.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }, { name: 'sess-2.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }))
  on('fs.read', ($, e) => ({
    value: JSON.stringify(
      String(e.path).endsWith('sess-2.json')
        ? { sessionId: 'sess-2', label: 'api', cwd: '/src/api', status: 'migration ready', asks: [{ text: 'Approve prod migration', kind: 'approval', since: 0 }], isWorking: false, at: 999_000 }
        : { sessionId: 'sess-1', label: 'app', cwd: '/src/app', status: 'idle', asks: [], isWorking: false, at: 999_000 },
    ),
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)

  const composed = await $.prompt.compose({ tools: ['mcp__brief__brief', 'Bash'], model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], outputStyle: null, traits: [], sections: [] } as never)
  expect(composed.sections.map(s => s.id)).toEqual(['brief:rule', 'brief:progress'])

  await $.tool.call({ tool: 'mcp__brief__brief', status: 'waiting on a decision', asks: [{ text: 'Pick DB index name', kind: 'decision' }] })
  const report = String((await $.tool.call({ tool: 'mcp__brief__report' })).result)
  expect(report).toContain('### Blocked on me\n- [decision] Pick DB index name')
  expect(report).toContain('Nothing changed or sent out yet.')

  const all = await $.command.run({ command: 'brief', args: 'all', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(all.text?.split('\n')[0]).toMatch(/^⚠ api {2}migration ready/)
  expect(all.text).toContain('    needs you: Approve prod migration')
  expect(all.text).toContain('app (this)')
})

test('allViewText: dead sessions drop out, sessions that need you sort first', async () => {
  const rec = (sessionId: string, at: number, asks = 0) => ({
    sessionId,
    label: sessionId,
    cwd: '/',
    status: 's',
    asks: Array.from({ length: asks }, () => ({ text: 'x', kind: 'decision' as const, since: 0 })),
    isWorking: false,
    at,
  })
  const text = allViewText([rec('old', 0), rec('quiet', 50_000_000), rec('needy', 49_900_000, 1)], 'quiet', 50_000_001)
  expect(text.split('\n').filter(l => !l.startsWith(' ')).map(l => l.split(' ')[1])).toEqual(['needy', 'quiet'])
})

test('/ledger and /jobs answer as /brief; a refused alias name does not stop the session start', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on, { registers: true })
  const tools: string[] = []
  on('command.register', ($, e) => (e.name === 'brief' ? { value: { command: 'brief' } } : { deny: `${e.name} is taken` }))
  on('tool.register', ($, e) => {
    tools.push(e.name)
    return { value: { tool: `mcp__brief__${e.name}` } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)
  expect(tools).toEqual(['brief', 'report'])

  await $.tool.call({ tool: 'mcp__brief__brief', status: 'waiting', asks: [{ text: 'Pick a name', kind: 'decision' }] })
  for (const command of ['ledger', 'jobs']) {
    const out = await $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
    expect(out.text).toContain('- [decision] Pick a name')
  }
})

// Review findings (fresh-context review, 2026-10-12), one test each.

test('review #1: a brief call mid-turn does not cover the turn; the fallback still reads how it ended', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on)
  let asked = 0
  on('model.complete', () => {
    asked++
    return { value: { isAnswered: true, text: '{"status":"pushed branch, PR open","asks":[{"text":"Approve force-push to feat/x","kind":"approval"}]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__brief__brief', status: 'phase 1/2: tests', asks: [] })
  await $.tool.call({ tool: 'Read', file_path: '/src/app/a.ts' })
  await $.turn.complete({ answer: 'Rebased. Approve force-push to feat/x?', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await new Promise(r => setTimeout(r, 20))
  expect(asked).toBe(1)
  expect((await band($)).asks).toBe('needs you (1): Approve force-push to feat/x')

  // a brief call that IS the last tool call covers the turn
  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: '/src/app/a.ts' })
  await $.tool.call({ tool: 'mcp__brief__brief', status: 'force-pushed feat/x', asks: [] })
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  await new Promise(r => setTimeout(r, 20))
  expect(asked).toBe(1)
})

test('review #2: session end forgets the brief, drops a running fallback, removes the ended session file', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const { writes } = engine(on)
  const removed: string[] = []
  let release: () => void = () => undefined
  on('model.complete', async () => {
    await new Promise<void>(r => {
      release = r
    })
    return { value: { isAnswered: true, text: '{"status":"old conversation","asks":[{"text":"Approve deploy","kind":"approval"}]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('process.run', ($, e) => {
    removed.push(String(e.argv[2]))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.end', ($, e) => e)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)

  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__brief__brief', status: 'about to deploy', asks: [] })
  await $.turn.complete({ answer: 'Ready. Approve deploy?', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await $.session.end({ reason: 'clear', sessionId: 'old-sess' } as never)
  const before = writes.length
  release()
  await new Promise(r => setTimeout(r, 20))
  expect(writes.length).toBe(before)
  expect(removed).toEqual(['/home/me/.claude/mods-data/brief/old-sess.json'])
  expect((await band($)).status).toBeUndefined()
})

test('review #3: a rejected turn-end summary is logged, not left unhandled', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const { logs } = engine(on)
  on('model.complete', () => {
    throw new Error('model blocked')
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/src/app' } as never)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.turn.complete({ answer: 'Which name?', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await new Promise(r => setTimeout(r, 20))
  expect(logs.some(l => l.includes('turn-end summary failed'))).toBe(true)
})
