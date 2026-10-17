import { expect, mock, test } from 'claude-code/testing'

import { allViewText, appendDecisions, mergeAsks, parseSummary, summarizePrompt, validateInput } from '../hooks/brief'
import { classifyBash, classifyMcp, ctxView, growthPerTurn, ledgerMarkdown, summaryLine } from '../hooks/ledger'

// The v1 `brief` and `report` tools (hooks/legacy.ts) and the pure helpers they and evals/replay use.

const USAGE = (percent: number, tokens: number, usd: number) => ({
  value: { startedAt: 0, context: { tokens, window: 200_000, percent }, rateLimits: [], cost: { usd } },
})

test('classifyBash: commit + push in one command, PR url, tag, paid, prod secret', async () => {
  const commit = classifyBash(
    'git commit -m "x" && git push',
    '[ericliao/foo 1a2b3c4] x\n 1 file changed\n   abc..def  ericliao/foo -> ericliao/foo',
    1,
  )
  expect(commit.map(e => e.kind)).toEqual(['commit', 'push'])
  expect(commit[0]?.label).toBe('1a2b3c4')

  const pr = classifyBash('gh pr create --title t --body b', 'https://github.com/acme/app/pull/982\n', 1)
  expect(pr[0]).toMatchObject({ kind: 'pr', label: 'PR #982' })

  expect(
    classifyBash('git tag cli-v1.36.0 abc && git push origin cli-v1.36.0', ' * [new tag]         cli-v1.36.0 -> cli-v1.36.0', 1),
  ).toEqual([{ kind: 'tag', label: 'cli-v1.36.0', at: 1 }])
  expect(classifyBash('git push --force-with-lease', ' + 1a2b3c4...5d6e7f8 feat -> feat (forced update)', 1)[0]).toMatchObject({
    kind: 'force-push',
    label: 'feat',
  })
  // review #6: a branch named like a version is a push, not a tag; a later command's token is ignored
  expect(
    classifyBash('git push origin release/sdk-v0.29.0', ' * [new branch]      release/sdk-v0.29.0 -> release/sdk-v0.29.0', 1),
  ).toEqual([{ kind: 'push', label: 'release/sdk-v0.29.0', at: 1 }])
  expect(classifyBash('git push && gh release view v1.2.3', '   1a2b3c4..5d6e7f8  main -> main', 1).map(e => e.kind)).toEqual(['push'])
  // review #7: any payment CLI that paid, with or without --max-pay
  expect(classifyBash('paycli get https://x', 'Paid 0.01 USDC via x402 on base', 1)[0]).toMatchObject({ kind: 'paid', label: '0.01 USDC' })
  expect(classifyBash('paycli get https://x', '{"ok":true}', 1)).toEqual([])
  expect(classifyBash('doppler secrets set -p api -c prd FOO=bar', '', 1)[0]?.label).toBe('doppler prd: FOO')
  expect(classifyBash('ls -la', 'total 0', 1)).toEqual([])
})

test('context outlook: tokens/window, growth per turn, turns to compact, colors', async () => {
  const turns = [100_000, 110_000, 120_000, 130_000].map((tokens, at) => ({ tokens, at }))
  expect(growthPerTurn(turns)).toBe(10_000)
  // a compaction drop restarts the series
  expect(growthPerTurn([...turns, { tokens: 40_000, at: 9 }])).toBeUndefined()
  const samples = [{ percent: 13, tokens: 130_000, usd: 4.2, at: 1 }]
  const limits = { window: 1_000_000, threshold: 800_000, isAutoCompact: true }
  expect(ctxView(samples, turns, limits)).toEqual({ text: 'ctx 130k/1M  13%  +10k/turn  ~67 turns to compact', level: 'ok' })
  const close = [{ percent: 78, tokens: 780_000, at: 1 }]
  expect(ctxView(close, turns, limits)?.level).toBe('hot')
  expect(ctxView(close, turns, { window: 1_000_000, isAutoCompact: false })?.text).toContain('~22 turns to full')
  expect(ctxView([], turns, limits)).toBeUndefined()
})

test('named outward actions: latest three, newest first, then +N', async () => {
  const e = (kind: 'tag' | 'paid' | 'pr' | 'push' | 'publish', label: string) => ({ kind, label, at: 1 })
  expect(summaryLine([e('pr', 'PR #1'), e('push', 'main'), e('tag', 'cli-v1.36.0'), e('paid', '0.05 USDC'), e('publish', '@acme/cli@1.36.0')])).toBe(
    'published @acme/cli@1.36.0 · cli-v1.36.0 · PR #1',
  )
})

test('review #5: errored chains still record what landed', async () => {
  expect(classifyBash('git commit -m x && git push', '[main 1a2b3c4] x\n ! [rejected] main -> main (fetch first)', 1, true)).toEqual([
    { kind: 'commit', label: '1a2b3c4', at: 1 },
  ])
  expect(classifyBash('paycli get https://x', 'Paid 0.05 USDC via mpp on tempo\nHTTP 422', 1, true)[0]?.label).toBe(
    '0.05 USDC (call errored)',
  )
})

test('live finding: inline scripts that mention commands record nothing', async () => {
  const script = "python3 - <<'EOF'\nrun('git tag cli-v1.36.0 && git push origin cli-v1.36.0 && gh pr merge 9 && gcloud functions deploy f')\nEOF"
  expect(classifyBash(script, 'done', 1)).toEqual([])
  expect(classifyBash('git push', 'Everything up-to-date', 1)).toEqual([])
  expect(classifyBash('grep -rn Paid packages/cli', 'fetch-command.ts:62: const base = `Paid 0.01 USDC via x402`', 1)).toEqual([])
  expect(classifyBash('gh pr merge 980 --squash', '✓ Squashed and merged pull request #980', 1)[0]?.label).toBe('merge #980')
})

test('classifyMcp: outward writes only, drafts ignored', async () => {
  expect(classifyMcp('mcp__linear-server__save_comment', 1)?.kind).toBe('linear')
  expect(classifyMcp('mcp__plugin_slack_slack__slack_send_message', 1)?.kind).toBe('slack')
  expect(classifyMcp('mcp__plugin_slack_slack__slack_send_message_draft', 1)).toBeUndefined()
  expect(classifyMcp('mcp__linear-server__get_issue', 1)).toBeUndefined()
})

test('summary and markdown read cleanly', async () => {
  const entries = [
    { kind: 'pr' as const, label: 'PR #982', at: 1, detail: 'https://github.com/a/b/pull/982' },
    { kind: 'commit' as const, label: 'abc1234', at: 1 },
    { kind: 'file' as const, label: '/r/a.ts', at: 1 },
    { kind: 'slack' as const, label: 'slack_send_message', at: 1 },
  ]
  expect(summaryLine(entries)).toBe('slack message · PR #982   1 file')
  const md = ledgerMarkdown(entries, [{ percent: 42, tokens: 84_000, usd: 3.1, at: 1 }], 2)
  expect(md).toContain('Context: 42% (84k tokens), peak 42%, session cost $3.10')
  expect(md).toContain('### Changed')
  expect(md).toContain('- Slack writes (1): slack_send_message')
})

test('validateInput: limits name themselves; empty asks is fine; string asks accepted', async () => {
  expect(validateInput({ status: 'tests green, opening PR', asks: [] })).toEqual({ ok: true, value: { status: 'tests green, opening PR', asks: [], decided: [], settled: [] } })
  const long = validateInput({ status: 'x'.repeat(81), asks: [] })
  expect(long.ok ? '' : long.error).toContain('80')
  const many = validateInput({ status: 's', asks: Array.from({ length: 6 }, (_, i) => ({ text: `a${i}`, kind: 'decision' })) })
  expect(many.ok ? '' : many.error).toContain('at most 5')
  expect(validateInput({ asks: [] }).ok).toBe(false)
  const loose = validateInput({ status: '  two   spaces ', asks: ['Pick a name', { text: 'Approve deploy', kind: 'bogus' }] })
  expect(loose.ok && loose.value).toEqual({ status: 'two spaces', asks: [{ text: 'Pick a name', kind: 'decision' }, { text: 'Approve deploy', kind: 'decision' }], decided: [], settled: [] })
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

test('parseSummary: takes the JSON out of a fenced reply, clamps, refuses garbage', async () => {
  expect(parseSummary('```json\n{"status":"waiting on review","asks":[{"text":"Review PR #12","kind":"review"}]}\n```')).toEqual({
    status: 'waiting on review',
    asks: [{ text: 'Review PR #12', kind: 'review' }],
    decided: [],
    settled: [],
  })
  expect(parseSummary('no json here')).toBeUndefined()
  expect(parseSummary('{"asks":[]}')).toBeUndefined()
  expect(parseSummary(`{"status":"${'s'.repeat(120)}","asks":["a","b","c","d","e","f"]}`)?.asks.length).toBe(5)
  expect(summarizePrompt(null, 'x'.repeat(7_000))).toContain('…')
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

test('appendDecisions: numbers grow, an open duplicate is not repeated, overflow folds into accepted', async () => {
  const one = appendDecisions([], [{ text: 'Used timeoutMs', alternatives: 'requestTimeoutMs', reversible: true }], 1)
  expect(one).toEqual([{ n: 1, text: 'Used timeoutMs', alternatives: 'requestTimeoutMs', reversible: true, at: 1, status: 'open' }])
  const two = appendDecisions(one, [{ text: 'used timeoutMs.', reversible: true }, { text: 'Kept ISO dates', reversible: false }], 2)
  expect(two.map(d => [d.n, d.text])).toEqual([[1, 'Used timeoutMs'], [2, 'Kept ISO dates']])
  const many = appendDecisions([], Array.from({ length: 14 }, (_, i) => ({ text: `d${i}`, reversible: true })), 3)
  expect(many.filter(d => d.status === 'open').length).toBe(12)
  expect(many[0]?.status).toBe('accepted')
  expect(validateInput({ status: 's', asks: [], decided: ['Picked A'] })).toEqual({ ok: true, value: { status: 's', asks: [], decided: [{ text: 'Picked A', reversible: true }], settled: [] } })
})

test('live finding: a list sent JSON-encoded (client with an older tool schema) is accepted', async () => {
  const v = validateInput({ status: 's', asks: '[]', decided: '[{"text":"Picked A","alternatives":"B"}]' })
  expect(v).toEqual({ ok: true, value: { status: 's', asks: [], decided: [{ text: 'Picked A', alternatives: 'B', reversible: true }], settled: [] } })
  expect(validateInput({ status: 's', asks: [], decided: 'not json' }).ok).toBe(false)
})

test('legacy tools: brief records the queue; report reads the ledger', async ($, on) => {
  mock.clock(on, { now: 100_000 })
  on('session.usage', () => USAGE(37, 74_000, 1.25))
  on('tool.call', ($, e) => (e.tool === 'Bash' ? { result: 'ok', text: '[main 9f8e7d6] msg\n 1 file changed' } : { result: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'git commit -am msg' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  const queued = await $.tool.call({ tool: 'mcp__brief__brief', status: 'migrating', asks: [], decided: [{ text: 'Used timeoutMs' }] })
  expect(String(queued.result)).toBe('ok; queued for the person to review: 1. Used timeoutMs')
  const report = String((await $.tool.call({ tool: 'mcp__brief__report' })).result)
  expect(report).toContain('Commits (1): 9f8e7d6')
  expect(report).toContain('Files edited (1): /repo/a.ts')
  expect(report).toContain('1. Used timeoutMs')
})
