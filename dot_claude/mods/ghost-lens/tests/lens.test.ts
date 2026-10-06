import { expect, test } from 'claude-code/testing'

import type { Recall } from '../types'
import {
  addRecalls,
  bandLines,
  belowFloor,
  enrich,
  ledger,
  ledgerText,
  flagRisk,
  isCorrection,
  parseTrace,
  pathTokens,
  recallsFromLog,
  closeOut,
  distinctiveTokens,
  hookChannel,
  inputText,
  isGhostTool,
  judge,
  mentionsKey,
  logLines,
  newRecall,
  parseInjected,
  parseToolMemories,
  statusText,
  summarize,
} from '../hooks/lens.ts'

// Shapes copied from this session's real ghost hook output.
const PER_PROMPT = `[Ghost Memory — Relevant]
[claude-code-version-pin-three-file-update] When bumping the Claude Code version in the agent-eval runner, three files must all be updated together: CLAUDE_CODE_VERSION in cloudflare-runner.Dockerfile, the 'claude-code' pin in runner/agent/cli/vendor-cli-adapter.mjs, and lastOnboardingVersion in vendor-cli-adapter.test.ts.
[session-summary-2026-09-28-muse-web-runner-planning] Planning-only session (2026-09-28): User asked how to test whether Muse can purchase.
[End Ghost Memory]`

const SESSION_START = `[Ghost Memory — Session Start]
## Project: ghost
[ghost-dedup-threshold-lowered] Ghost's exact-dedup similarity threshold was lowered from ~0.85 to 0.82 (commit 8a3505d).
**Memory hygiene**: After your first substantive task, scan the memories above
[End Ghost Memory]`

const NOW = 1_000

test('parses keys from both hook headers and ignores headers, prose and markdown', async () => {
  expect(hookChannel(PER_PROMPT)).toBe('prompt')
  expect(hookChannel(SESSION_START)).toBe('session-start')
  expect(hookChannel('[Some other hook] hello')).toBeUndefined()
  expect(parseInjected(PER_PROMPT).map(i => i.key)).toEqual([
    'claude-code-version-pin-three-file-update',
    'session-summary-2026-09-28-muse-web-runner-planning',
  ])
  expect(parseInjected(SESSION_START).map(i => i.key)).toEqual(['ghost-dedup-threshold-lowered'])
})

test('parses ghost_context JSON results and tolerates junk', async () => {
  const json = JSON.stringify({ memories: [{ ns: 'agent:x', key: 'a-key', content: 'body' }, { key: 'has space' }, { nokey: 1 }] })
  expect(parseToolMemories(json)).toEqual([{ ns: 'agent:x', key: 'a-key', content: 'body' }])
  expect(parseToolMemories('not json')).toEqual([])
})

test('distinctive tokens: files, flags, env vars, code identifiers; not plain words', async () => {
  const t = distinctiveTokens(
    'Set GHOST_UTILITY_WEIGHT and pass --min-score; see internal/store/edge.go strengthenCoRetrievedEdges and utility_count. Plain words only here.',
  )
  expect(t).toContain('GHOST_UTILITY_WEIGHT')
  expect(t).toContain('--min-score')
  expect(t).toContain('internal/store/edge.go')
  expect(t).toContain('strengthenCoRetrievedEdges')
  expect(t).toContain('utility_count')
  expect(t).not.toContain('Plain')
})

test('addRecalls keeps the first sighting per ns+key', async () => {
  const a = newRecall({ key: 'k', content: 'x' }, 'agent:a', 'session-start', 0, NOW)
  const again = newRecall({ key: 'k', content: 'x' }, 'agent:a', 'prompt', 3, NOW)
  const other = newRecall({ key: 'k', content: 'x' }, 'agent:b', 'prompt', 3, NOW)
  const list = addRecalls(addRecalls([], [a]), [again, other])
  expect(list.map(r => `${r.ns}/${r.channel}`)).toEqual(['agent:a/session-start', 'agent:b/prompt'])
})

test('resume: a prior row is replaced by a fresh injection and is never judged itself', async () => {
  const prior: Recall = { ...newRecall({ key: 'k', content: 'x' }, 'agent:a', 'prompt', 0, NOW), verdict: 'unused', prior: true }
  const pendingPrior: Recall = { ...newRecall({ key: 'p', content: 'x' }, 'agent:a', 'prompt', 0, NOW), prior: true }
  const fresh = newRecall({ key: 'k', content: 'see internal/a.go and internal/b.go' }, 'agent:a', 'prompt', 2, NOW)
  const list = addRecalls([prior, pendingPrior], [fresh])
  expect(list.map(r => [r.key, r.verdict, r.prior ?? false, r.shownTurn])).toEqual([
    ['p', 'pending', true, 0],
    ['k', 'pending', false, 2],
  ])
  // A memory seen this session keeps its first sighting.
  expect(addRecalls(list, [{ ...fresh, shownTurn: 5 }])).toBe(list)
  // Prior pending rows are left alone by the judge even long after.
  const judged = judge(list, { corpus: 'nothing', prompt: '', fetched: new Set() }, 9)
  expect(judged.recalls.map(r => [r.key, r.verdict])).toEqual([
    ['p', 'pending'],
    ['k', 'unused'],
  ])
})

test('judge: key named, ghost_get, or 2+ tokens not in the prompt count as used', async () => {
  const mem = newRecall(
    { key: 'pin-update', content: 'Update CLAUDE_CODE_VERSION in cloudflare-runner.Dockerfile and vendor-cli-adapter.mjs' },
    'agent:a',
    'prompt',
    0,
    NOW,
  )
  const ev = (corpus: string, prompt = '', fetched: string[] = []) => ({ corpus, prompt, fetched: new Set(fetched) })

  expect(judge([mem], ev('edited cloudflare-runner.Dockerfile and vendor-cli-adapter.mjs'), 0).recalls[0]).toMatchObject({
    verdict: 'used',
    evidence: 'tokens: cloudflare-runner.Dockerfile, vendor-cli-adapter.mjs',
  })
  // Tokens the person already typed prove nothing: retrieval matched on them.
  expect(
    judge([mem], ev('edited cloudflare-runner.Dockerfile and vendor-cli-adapter.mjs', 'bump cloudflare-runner.Dockerfile'), 0).recalls[0]
      ?.verdict,
  ).toBe('pending')
  expect(judge([mem], ev('per [pin-update] we must'), 0).recalls[0]?.evidence).toBe('key named')
  expect(judge([mem], ev('', '', ['pin-update']), 0).recalls[0]?.evidence).toBe('fetched with ghost_get')
})

test('review: key match is whole-token, ghost tool inputs and tool names are not evidence', async () => {
  expect(mentionsKey('see [pin-update] here', 'pin-update')).toBe(true)
  expect(mentionsKey('{"note":"pin-update."}', 'pin-update')).toBe(true)
  expect(mentionsKey('pin-update-v2 shipped', 'pin-update')).toBe(false)
  expect(mentionsKey('the author wrote', 'auth')).toBe(false) // also too short to trust
  expect(mentionsKey('call mcp__ghost__ghost_context', 'ghost_context')).toBe(false)

  expect(isGhostTool('mcp__ghost__ghost_curate')).toBe(true)
  expect(isGhostTool('Bash')).toBe(false)
  const text = inputText({ tool: 'mcp__x__y', tool_use_id: 'toolu_1', agentId: 'a', command: 'make test' })
  expect(text).toBe('{"command":"make test"}')
})

test('judge: prompt recalls expire after one more turn; session-start ones wait for session end', async () => {
  const p = newRecall({ key: 'p', content: 'x' }, 'agent:a', 'prompt', 2, NOW)
  const s = newRecall({ key: 's', content: 'x' }, 'agent:a', 'session-start', 0, NOW)
  const empty = { corpus: 'nothing relevant', prompt: '', fetched: new Set<string>() }

  const t2 = judge([p, s], empty, 2)
  expect(t2.changed).toEqual([])
  const t3 = judge(t2.recalls, empty, 3)
  expect(t3.recalls.map(r => r.verdict)).toEqual(['unused', 'pending'])
  expect(closeOut(t3.recalls).map(r => r.verdict)).toEqual(['unused', 'unused'])
})

test('summary, status line and shadow log', async () => {
  const used = { ...newRecall({ key: 'u', content: 'x' }, 'agent:a', 'prompt', 0, NOW), verdict: 'used' as const, corrected: 'unused' as const }
  const unused = { ...newRecall({ key: 'n', content: 'x' }, 'agent:a', 'prompt', 0, NOW), verdict: 'unused' as const, corrected: 'unused' as const }
  const pending = newRecall({ key: 'p', content: 'x' }, 'agent:a', 'session-start', 0, NOW)
  const s = summarize([used, unused, pending])
  // The person's correction wins: "u" was marked noise, so 0 used, 2 unused.
  expect(s).toMatchObject({ recalled: 3, used: 0, unused: 2, pending: 1, agreed: 1, reviewed: 2, tok: 3, wastedTok: 2 })
  expect(statusText(s)).toBe('ghost 3 in · 0 used · 3 tok')
  expect(statusText(summarize([]))).toBeUndefined()
  // v0.1 recalls in $.state have no tok: no NaN.
  const legacy = { ...pending, tok: undefined } as unknown as typeof pending
  expect(summarize([legacy]).tok).toBe(0)

  // Resume: the log round-trips the verdict-bearing fields.
  const back = recallsFromLog(logLines('sid', [used, pending]) + '{"bad\n')
  expect(back.map(r => [r.key, r.channel, r.verdict, r.corrected, r.tok])).toEqual([
    ['u', 'prompt', 'used', 'unused', 1],
    ['p', 'session-start', 'pending', undefined, 1],
  ])

  const lines = logLines('sid', [used]).trim().split('\n')
  expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ session: 'sid', key: 'u', verdict: 'used', corrected: 'unused' })
  expect(logLines('sid', [])).toBe('')
})

// Shapes copied from a real run of the updated hooks against a copy of the live DB.
const TRACE =
  [
    { v: 1, at: 't1', hook: 'session-start', outcome: 'injected', reason: null, query: 'working in ghost', floor: 0.55, injected: ['pin-a', 'proj-b'],
      phases: [{ phase: 'project', memories: [{ key: 'pin-a', score: 0.5, tok: 84 }, { key: 'proj-b', score: 0.71, tok: 200 }] }] },
    { v: 1, at: 't2', hook: 'prompt', outcome: 'skipped', reason: 'prompt is 5 words (gate <= 5)', query: 'I see ghost as status', floor: 0.55, injected: [], phases: [] },
    { v: 1, at: 't3', hook: 'prompt', outcome: 'injected', reason: null, query: 'zzqx plorf wibble', floor: 0.55, injected: ['old-c'],
      phases: [{ phase: 'general', memories: [{ key: 'old-c', score: 0.09, tok: 120 }] }] },
  ]
    .map(l => JSON.stringify(l))
    .join('\n') + '\n'

test('trace: parses new lines only, waits on a partial line, fills scores', async () => {
  const all = parseTrace(TRACE, 0, 4)
  expect(all.seen).toBe(3)
  expect(all.rows.map(r => `${r.hook}:${r.outcome}`)).toEqual(['session-start:injected', 'prompt:skipped', 'prompt:injected'])
  expect(all.rows[0]).toMatchObject({ turn: 4, tok: 284, injected: [{ key: 'pin-a', score: 0.5, tok: 84 }, { key: 'proj-b', score: 0.71, tok: 200 }] })
  expect(parseTrace(TRACE, 3, 5).rows).toEqual([])
  expect(parseTrace(`${TRACE}{"v":1,"hook":"pro`, 3, 5)).toEqual({ rows: [], seen: 3 })
  // A shorter file than the offset is a new file: read it from the top.
  const fresh = TRACE.split('\n').slice(1).join('\n')
  expect(parseTrace(fresh, 3, 6)).toMatchObject({ seen: 2, rows: [{ outcome: 'skipped' }, { outcome: 'injected' }] })

  const r = newRecall({ key: 'old-c', content: 'see internal/store/gone.go' }, 'agent:a', 'prompt', 4, NOW)
  const [filled] = enrich([r], all.rows)
  expect(filled).toMatchObject({ score: 0.09, floor: 0.55, tok: 120, query: 'zzqx plorf wibble' })
  expect(belowFloor(filled ?? {})).toBe(true)
})

test('band: loaded with scores and an under-floor warning, or the skip reason', async () => {
  const rows = parseTrace(TRACE, 0, 0).rows
  expect(bandLines(rows[1], 100)).toEqual(['ghost  nothing loaded: prompt is 5 words (gate <= 5)'])
  const loaded = bandLines(rows[2], 120)
  expect(loaded[0]).toContain('ghost  loaded 1 for this prompt · 120 tok')
  expect(loaded[0]).toContain('0.09 old-c')
  expect(loaded[1]).toContain('1 under the 0.55 floor got in: 0.09 old-c')
  // With ghost's via in the trace, the band names the path and recalls carry it.
  const withVia = parseTrace(TRACE.replace('{"key":"old-c","score":0.09', '{"key":"old-c","via":"rescued","score":0.09'), 0, 0).rows
  expect(bandLines(withVia[2], 120)[1]).toContain('0.09 old-c (rescued)')
  expect(enrich([newRecall({ key: 'old-c', content: 'x' }, 'agent:a', 'prompt', 0, NOW)], withVia)[0]?.via).toBe('rescued')
  expect(bandLines(undefined, 100)).toEqual([])
  for (const line of bandLines(rows[0], 40)) expect(line.length).toBeLessThanOrEqual(40)
})

test('token ledger: per channel, against the cap, share of context; band carries the session total', async () => {
  const capped = [
    { v: 1, at: 'a', hook: 'session-start', outcome: 'injected', floor: 0.55, injected: ['s1'], injected_tok: 400,
      phases: [{ phase: 'project', budget: 1500, used: 420, memories: [{ key: 's1', score: 0.7, tok: 400 }] }] },
    { v: 1, at: 'b', hook: 'prompt', outcome: 'injected', floor: 0.55, injected: ['p1', 'p2'], injected_tok: 900,
      phases: [{ phase: 'project', budget: 1000, used: 640, memories: [{ key: 'p1', score: 0.8, tok: 600 }] },
               { phase: 'general', budget: 500, used: 320, memories: [{ key: 'p2', score: 0.6, tok: 300 }] }] },
    { v: 1, at: 'c', hook: 'prompt', outcome: 'skipped', reason: 'session cap reached (5950 of 6000 tok)', injected: [], phases: [] },
  ]
    .map(l => JSON.stringify(l))
    .join('\n') + '\n'
  const rows = parseTrace(capped, 0, 1).rows
  expect(rows[1]).toMatchObject({ tok: 900, budget: 1500, used: 960 })

  const ask = { ...newRecall({ key: 'x', content: 'y'.repeat(400) }, 'agent:a', 'explicit', 1, NOW), verdict: 'unused' as const }
  const l = ledger(rows, [ask], 6000)
  expect(l).toEqual({ start: 400, prompt: 900, explicit: 100, total: 1400, cap: 6000, unused: 100 })
  expect(ledgerText(l, 1_000_000)).toBe('tokens: start 400 · prompt 900/6.0k cap · ask 100 · total 1.4k (0.1% of context) · unused 100')
  expect(ledgerText({ ...l, cap: 0 })).toContain('prompt 900 ·')

  expect(bandLines(rows[1], 200, l)[0]).toContain('loaded 2 for this prompt · 900 tok of 1.5k budget')
  expect(bandLines(rows[1], 200, l)[0]).toMatch(/· session 1\.4k, prompt 900\/6\.0k$/)
  expect(bandLines(rows[2], 200, l)[0]).toBe('ghost  nothing loaded: session cap reached (5950 of 6000 tok)  · session 1.4k, prompt 900/6.0k')
  for (const line of bandLines(rows[1], 60, l)) expect(line.length).toBeLessThanOrEqual(60)
})

test('stale paths: only repo-relative paths; corrections flag last turn’s used recalls', async () => {
  expect(pathTokens(['internal/store/edge.go', '/abs/x.go', '~/x/y.md', 'https://a.b/c.md', 'edge.go', 'GHOST_X'])).toEqual([
    { path: 'internal/store/edge.go', top: 'internal' },
  ])
  expect(isCorrection('no, that is the wrong file')).toBe(true)
  expect(isCorrection("actually let's use the other one")).toBe(true)
  expect(isCorrection('nothing else to add, ship it')).toBe(false)
  expect(isCorrection('know what, go ahead')).toBe(false)

  const usedLast: Recall = { ...newRecall({ key: 'k', content: 'x' }, 'agent:a', 'prompt', 2, NOW), verdict: 'used', judgedTurn: 2 }
  const usedEarlier: Recall = { ...usedLast, key: 'e', judgedTurn: 1 }
  const flagged = flagRisk([usedLast, usedEarlier], 2)
  expect(flagged.map(r => r.risk)).toEqual(['used, then your next prompt pushed back', undefined])
})

const BAND = {
  plugin: 'ghost-lens',
  surface: 'terminal',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('/clear: a new session id (no session.start) switches trace file, resets the view, band follows', async ($, on) => {
  let id = 'sid1'
  const NEW =
    JSON.stringify({ v: 1, at: 'n1', hook: 'session-start', outcome: 'empty', reason: 'no memory passed min-score 0.55', query: 'q', floor: 0.55, injected: [], phases: [] }) +
    '\n' +
    JSON.stringify({ v: 1, at: 'n2', hook: 'prompt', outcome: 'skipped', reason: 'harness turn', query: '<x>', floor: 0.55, injected: [], phases: [] }) +
    '\n'
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('turn.start', async ($, e) => ({ text: e.text, turnId: e.turnId }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('ui.status', async () => ({ value: undefined }) as never)
  on('env.get', async () => ({ value: undefined }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.write', async () => ({ value: undefined }))
  on('session.id', async () => ({ value: id }))
  const closed: string[] = []
  on('ui.close', async ($, e) => {
    closed.push((e as unknown as { id: string }).id)
    return { value: undefined } as never
  })
  // The engine's own band beneath: an empty box.
  on('ui.render', async ($, e) => h($.ui.resolve(e).Box, {}) as never)
  on('fs.read', async ($, e) => ({ value: (e as unknown as { path: string }).path.includes('sid1') ? TRACE : NEW }) as never)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Quiet by default: nothing above the prompt.
  let band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /ghost/ })).toBeUndefined()
  await band.unmount()

  const on1 = await $.command.run({ command: 'ghost', args: 'debug' } as never)
  expect((on1 as { text?: string }).text).toContain('debug on')
  band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /ghost {2}loaded 1 for this prompt/ })).toBeDefined()
  await band.unmount()

  id = 'sid2' // /clear
  await $.turn.start({ text: 'next', turnId: 't1' } as never)
  band = await $.ui.mount(BAND)
  // Old file's 3 rows are not re-read and the offset of 3 does not skip the new file's 2.
  expect(await band.find({ type: 'Text', text: /nothing loaded: harness turn/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /loaded 1 for this prompt/ })).toBeUndefined()
  await band.unmount()

  const done = await $.command.run({ command: 'ghost', args: 'close' } as never)
  expect((done as { text?: string }).text).toBe('ghost: pane closed.')
  expect(closed).toEqual(['ghost-lens'])

  await $.command.run({ command: 'ghost', args: 'quiet' } as never)
  band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /ghost/ })).toBeUndefined()
  await band.unmount()
})

// The kit cannot raise a hook-context row ($.session.append from a test is door `note`),
// so this drives the explicit channel; the hook-row path is verified live.
test('end to end: trace read at start, ghost_context recall, pane shows runs, stale path, detail', async ($, on) => {
  // The world beneath the plugin: the trace file, a repo with internal/ but no gone.go.
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('clock.now', async () => ({ value: NOW }) as never)
  on('ui.status', async () => ({ value: undefined }) as never)
  on('env.get', async ($, e) => ({ value: (e as unknown as { name: string }).name === 'HOME' ? '/home/t' : undefined }))
  on('tool.call', async () =>
    ({
      result: JSON.stringify({ memories: [{ ns: 'agent:claude-code', key: 'old-c', content: 'Remember internal/store/gone.go handles X', score: 0.09 }] }),
    }) as never,
  )
  on('session.id', async () => ({ value: 'sid' }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', async () => ({ value: TRACE }))
  on('fs.write', async () => ({ value: undefined }))
  const asked: string[] = []
  on('fs.exists', async ($, e) => {
    const path = (e as unknown as { path: string }).path
    asked.push(path)
    return { value: path === 'internal' || path.endsWith('/internal') }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__ghost__ghost_context', tool_use_id: 'toolu_1', query: 'where is X handled' } as never)

  const ui = await $.ui.mount({
    plugin: 'ghost-lens',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'ghost-lens',
    viewport: { columns: 120, rows: 40 },
    props: { title: 'Ghost', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const drawn = JSON.stringify(await ui.drawn())
  expect(await ui.find({ type: 'Text', text: /Loaded 1/ }), `header in ${drawn.slice(0, 1500)}`).toBeDefined()
  await ui.press({ key: 's:agent:claude-code:old-c' })
  const texts = JSON.stringify(await ui.drawn()).match(/"(tokens:|missing|score)[^"]*"/g)
  expect(await ui.find({ type: 'Text', text: /1 likely stale/ }), `stale; detail: ${texts}; exists asked: ${JSON.stringify(asked)}`).toBeDefined()
  await ui.press({ key: 'dc:old-c' })
  expect(await ui.find({ type: 'Text', text: /skipped: prompt is 5 words/ }), 'hook runs').toBeDefined()
  await ui.press({ key: 's:agent:claude-code:old-c' })
  expect(await ui.find({ type: 'Text', text: /score 0\.09/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /query: where is X handled/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /missing here: internal\/store\/gone.go/ })).toBeDefined()
  await ui.press({ key: 'dn:old-c' })
  expect(await ui.find({ type: 'Text', text: /you; mod said pending/ })).toBeDefined()
  await ui.unmount()
})
