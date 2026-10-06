import { expect, test } from 'claude-code/testing'

import { buildReport, reasonKey, reportText } from '../hooks/report.ts'

const line = (o: object): string => JSON.stringify(o)

const S1 = {
  shadow: [
    line({ key: 'a', channel: 'prompt', verdict: 'used', tok: 100 }),
    line({ key: 'b', channel: 'prompt', verdict: 'unused', tok: 300 }),
    line({ key: 'c', channel: 'prompt', verdict: 'used', corrected: 'unused', tok: 50 }),
    line({ key: 'd', channel: 'session-start', verdict: 'pending', tok: 200 }),
    '{"partial', // a half-written last line is skipped
  ].join('\n'),
  trace: [
    line({ hook: 'session-start', outcome: 'injected' }),
    line({ hook: 'prompt', outcome: 'injected' }),
    line({ hook: 'prompt', outcome: 'skipped', reason: 'prompt is 3 words (gate <= 5)' }),
    line({ hook: 'prompt', outcome: 'skipped', reason: 'prompt is 5 words (gate <= 5)' }),
    line({ hook: 'prompt', outcome: 'skipped', reason: 'session cap reached (5990 of 6000 tok)' }),
  ].join('\n'),
}
const S2 = { shadow: line({ key: 'e', channel: 'explicit', verdict: 'used', corrected: 'used', tok: 80 }), trace: '' }

test('report: per-channel use and cost with corrections winning, prompt outcomes, grouped skip reasons', async () => {
  const r = buildReport([S1, S2, { shadow: '', trace: '' }])
  expect(r.sessions).toBe(2)
  expect(r.channels.prompt).toEqual({ recalled: 3, used: 1, unused: 2, pending: 0, tok: 450, usedTok: 100, wastedTok: 350 })
  expect(r.channels['session-start']).toMatchObject({ recalled: 1, pending: 1, tok: 200 })
  expect(r.channels.explicit).toMatchObject({ used: 1, usedTok: 80 })
  expect(r.promptRuns).toEqual({ injected: 1, skipped: 3 })
  expect(r.skipReasons).toEqual({ 'prompt is N words': 2, 'session cap reached': 1 })
  expect(r.capHits).toBe(1)
  expect({ reviewed: r.reviewed, agreed: r.agreed }).toEqual({ reviewed: 2, agreed: 1 })

  const text = reportText(r)
  expect(text).toContain('ghost report · 2 sessions')
  expect(text).toMatch(/prompt\s+3\s+1\s+33%\s+450\s+450\s+350/)
  expect(text).toContain('prompt hook: skipped 3 · injected 1')
  expect(text).toContain('detector: you agreed with 1 of 2 verdicts (50%)')
  expect(reasonKey('no memory passed min-score 0.55 / min-spread 0.15')).toBe('no memory passed min-score N / min-spread N')
})
