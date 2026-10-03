import { expect, mock, test } from 'claude-code/testing'

import { bandRows, duration, eta, lastLineOf, parseBackgroundStart, parseProgress, parseTaskEnds, statusLine, visibleLines } from '../hooks/progress.ts'

// Verbatim shapes from a real session (2.1.288).
const STARTED =
  'Command running in background with ID: bpvctn69i. Output is being written to: /tmp/tasks/bpvctn69i.output. You will be notified when it completes. To check interim output, use Read on that file path.'
const NOTIFY = (id: string, status: string, code: number) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_x</tool-use-id>\n<output-file>/tmp/tasks/${id}.output</output-file>\n<status>${status}</status>\n<summary>Background command "x" ${status} (exit code ${code})</summary>\n</task-notification>`

const BAND = {
  plugin: 'jobs',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 160, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const PANE = {
  plugin: 'jobs',
  component: 'Pane',
  requestId: 'jobs',
  viewport: { columns: 160, rows: 40 },
  props: {
    title: 'Background jobs',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('progress parsing: %, byte pairs, counts, \\r bars, ANSI; dates are not progress', async () => {
  expect(parseProgress(visibleLines('uploading\n  45% done\n'))?.pct).toBe(45)
  expect(parseProgress(visibleLines('[##   ] 3/20\r[####  ] 12/40\n'))).toEqual({ pct: 30, text: '12/40' })
  expect(parseProgress(visibleLines('\x1b[32msent 12.5 MB / 50 MB\x1b[0m'))?.pct).toBe(25)
  expect(parseProgress(visibleLines('row 7 of 28'))?.text).toBe('7/28')
  expect(parseProgress(visibleLines('2026-10-02 16:20:51 started'))).toBeUndefined()
  expect(parseProgress(visibleLines('GET /v1/caps/12/34 200'))).toBeUndefined()
  // newest line wins
  expect(parseProgress(visibleLines('10%\n20%\nflushing'))?.pct).toBe(20)
})

test('::progress / ::status markers win over guessed progress', async () => {
  const lines = visibleLines('::progress 12/40 uploading batch 12\nGET /v1/caps 200 in 3/5 retries\n')
  expect(parseProgress(lines)).toEqual({ pct: 30, text: '12/40 uploading batch 12' })
  expect(lastLineOf(lines)).toBe('GET /v1/caps 200 in 3/5 retries')
  expect(parseProgress(visibleLines('::progress 64%\n'))).toEqual({ pct: 64, text: '64%' })
  expect(parseProgress(visibleLines('::progress 3.2GB/10GB sending\n'))?.pct).toBe(32)
  // a newer ::status replaces the message, keeps the numbers
  expect(parseProgress(visibleLines('::progress 40/40 uploaded\n::status waiting on CI\n'))).toEqual({ pct: 100, text: '40/40 waiting on CI' })
  expect(parseProgress(visibleLines('::status warming caches\n'))).toEqual({ text: 'warming caches' })
})

test('engine texts: background start and task notifications', async () => {
  expect(parseBackgroundStart(STARTED)).toEqual({ id: 'bpvctn69i', file: '/tmp/tasks/bpvctn69i.output' })
  expect(parseBackgroundStart('total 0')).toBeUndefined()
  expect(parseTaskEnds(NOTIFY('a1', 'completed', 0))).toEqual([{ id: 'a1', status: 'completed', exitCode: 0 }])
  expect(parseTaskEnds(NOTIFY('a2', 'failed', 1))[0]?.status).toBe('failed')
  expect(parseTaskEnds(NOTIFY('a3', 'completed', 2))[0]?.status).toBe('failed')
  expect(parseTaskEnds(NOTIFY('a4', 'killed', 143))[0]?.status).toBe('killed')
})

test('eta from the percent history', async () => {
  const h = [
    { at: 0, pct: 10 },
    { at: 60_000, pct: 20 },
  ]
  expect(eta(h, 60_000)).toBe('~8m')
  expect(eta([{ at: 0, pct: 10 }], 0)).toBeUndefined()
})

test('a background shell is tracked, tailed, and finished by its notification', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const toasts: string[] = []
  let log = '1/20\n'
  on('command.register', () => ({ value: { command: 'jobs' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  // What sits beneath in the band (the engine's own, or another mod's): must stay drawn.
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['beneath'] }))
  // The band's first row, or '' when jobs draws nothing of its own.
  const footer = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    const first = await ui.find({ type: 'Text', text: /^(run |done|fail|kill)/ })
    await ui.unmount()
    return first === undefined ? '' : String(first.children?.[0] ?? '').replace(/\s+/g, ' ')
  }
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: log.length, mtimeMs: 0, isLink: false } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: log, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.receive', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: STARTED }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as never)
  await $.tool.call({ tool: 'Bash', command: 'node upload.js', description: 'upload assets', run_in_background: true })
  expect(await footer()).toBe('run upload assets 0s')

  await clock.advance(5_000)
  expect(await footer()).toBe('run upload assets 5s 1/20')
  log += '[###] 10/20\n'
  await clock.advance(5_000)
  expect(await footer()).toMatch(/^run upload assets 10s 10\/20 ~\d+s$/)

  await $.session.receive({ origin: { kind: 'task-notification' }, text: NOTIFY('bpvctn69i', 'completed', 0) } as never)
  expect(toasts).toEqual([]) // completed: band row only, no toast
  expect(await footer()).toBe('done upload assets 10s')

  // dropped from the status line once it is no longer recent (idle polls still refresh)
  await clock.advance(200_000)
  expect(await footer()).toBe('')
})

test('pane lists the job and its stop button calls TaskStop', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const stopped: string[] = []
  on('command.register', () => ({ value: { command: 'jobs' } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskStop') {
      stopped.push(String(e.task_id))
      return { result: 'stopped' }
    }
    return { result: { stdout: '', stderr: '', interrupted: false }, text: STARTED }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as never)
  await $.tool.call({ tool: 'Bash', command: 'pnpm eval:run', description: 'eval run', run_in_background: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^eval run {2}0s/ })).toBeDefined()
    expect(await ui.find({ key: 'stop:bpvctn69i' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'stop:bpvctn69i' })
  expect(stopped).toEqual(['bpvctn69i'])
  expect(await ui.find({ type: 'Text', text: /killed in 0s/ })).toBeDefined()
})

test('durations: short jobs keep seconds', async () => {
  expect(duration(95_000)).toBe('1m35s')
  expect(duration(45_000)).toBe('45s')
  expect(duration(1_500_000)).toBe('25m')
})

test('failed rows stay until the next prompt; completed rows expire', async () => {
  
  const base = { kind: 'shell' as const, startedAt: 0, history: [] }
  const jobs = [
    { ...base, id: 'a', label: 'ok', status: 'completed' as const, endedAt: 1_000 },
    { ...base, id: 'b', label: 'bad', status: 'failed' as const, endedAt: 1_000, exitCode: 1 },
  ]
  const at = (now: number, lastPromptAt: number) => bandRows(jobs, now, 120, lastPromptAt).map(r => r.key)
  expect(at(10_000, 0)).toEqual(['b', 'a'])
  expect(at(600_000, 0)).toEqual(['b']) // completed expired, failed still unseen
  expect(at(600_000, 500_000)).toEqual([]) // a prompt after it failed: seen
})

test('status line summarises at most three running jobs', async () => {
  const job = (id: string) => ({ id, kind: 'shell' as const, label: id, startedAt: 0, status: 'running' as const, history: [] })
  expect(statusLine([job('a'), job('b'), job('c'), job('d')], 0)).toBe('a · b · c · +1')
  expect(statusLine([], 0)).toBeUndefined()
})
