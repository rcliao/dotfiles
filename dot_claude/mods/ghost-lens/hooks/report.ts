// Aggregates ghost-lens shadow logs and hook traces across sessions: is ghost
// helping? Pure (no `$`), so the /ghost command and scripts/report.ts share it.

type Row = Record<string, unknown>

function rows(text: string): Row[] {
  const out: Row[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const v = JSON.parse(line) as unknown
      if (v !== null && typeof v === 'object') out.push(v as Row)
    } catch {
      // a partial last line, or a line from an older format
    }
  }
  return out
}

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export type ChannelStats = {
  recalled: number
  used: number
  unused: number
  pending: number
  tok: number
  usedTok: number
  wastedTok: number
}

export type Report = {
  sessions: number
  channels: Record<string, ChannelStats>
  /** Prompt-hook runs by outcome, and the reasons behind skips. */
  promptRuns: Record<string, number>
  skipReasons: Record<string, number>
  capHits: number
  /** Person's corrections against the mod's verdicts. */
  reviewed: number
  agreed: number
}

export type SessionLogs = { shadow: string; trace: string }

function emptyChannel(): ChannelStats {
  return { recalled: 0, used: 0, unused: 0, pending: 0, tok: 0, usedTok: 0, wastedTok: 0 }
}

/** Reason text with numbers stripped, so "prompt is 3 words" and "prompt is 5 words" group. */
export function reasonKey(reason: string): string {
  return reason.replace(/\(.*?\)/g, '').replace(/\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').trim()
}

export function buildReport(sessions: SessionLogs[]): Report {
  const r: Report = { sessions: 0, channels: {}, promptRuns: {}, skipReasons: {}, capHits: 0, reviewed: 0, agreed: 0 }
  for (const s of sessions) {
    const recalls = rows(s.shadow)
    const traces = rows(s.trace)
    if (recalls.length === 0 && traces.length === 0) continue
    r.sessions += 1
    for (const rec of recalls) {
      const channel = typeof rec.channel === 'string' ? rec.channel : 'unknown'
      const c = (r.channels[channel] ??= emptyChannel())
      const verdict = rec.verdict === 'used' || rec.verdict === 'unused' ? rec.verdict : 'pending'
      const final = rec.corrected === 'used' || rec.corrected === 'unused' ? rec.corrected : verdict
      const tok = n(rec.tok)
      c.recalled += 1
      c[final] += 1
      c.tok += tok
      if (final === 'used') c.usedTok += tok
      if (final === 'unused') c.wastedTok += tok
      if (rec.corrected !== undefined && verdict !== 'pending') {
        r.reviewed += 1
        if (rec.corrected === verdict) r.agreed += 1
      }
    }
    for (const t of traces) {
      if (t.hook !== 'prompt') continue
      const outcome = typeof t.outcome === 'string' ? t.outcome : 'unknown'
      r.promptRuns[outcome] = (r.promptRuns[outcome] ?? 0) + 1
      if (outcome !== 'injected' && typeof t.reason === 'string') {
        const key = reasonKey(t.reason)
        r.skipReasons[key] = (r.skipReasons[key] ?? 0) + 1
        if (key.startsWith('session cap reached')) r.capHits += 1
      }
    }
  }
  return r
}

function pct(a: number, b: number): string {
  return b === 0 ? '—' : `${Math.round((a / b) * 100)}%`
}

function tok(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
}

/** Plain-text table: per channel use rate and token cost, then prompt-hook outcomes. */
export function reportText(r: Report): string {
  const lines = [`ghost report · ${r.sessions} session${r.sessions === 1 ? '' : 's'}`, '']
  lines.push('channel        loaded  used  rate   tok    tok/used  wasted')
  const order = ['session-start', 'prompt', 'explicit', ...Object.keys(r.channels).filter(k => !['session-start', 'prompt', 'explicit'].includes(k))]
  for (const name of order) {
    const c = r.channels[name]
    if (c === undefined) continue
    const judged = c.used + c.unused
    lines.push(
      [
        name.padEnd(14),
        String(c.recalled).padStart(6),
        String(c.used).padStart(5),
        pct(c.used, judged).padStart(5),
        tok(c.tok).padStart(6),
        (c.used === 0 ? '—' : tok(Math.round(c.tok / c.used))).padStart(9),
        tok(c.wastedTok).padStart(7),
      ].join(' '),
    )
  }
  const runs = Object.entries(r.promptRuns).sort((a, b) => b[1] - a[1])
  if (runs.length > 0) {
    lines.push('', `prompt hook: ${runs.map(([k, v]) => `${k} ${v}`).join(' · ')}`)
    const reasons = Object.entries(r.skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 6)
    for (const [k, v] of reasons) lines.push(`  ${String(v).padStart(4)}  ${k}`)
  }
  lines.push('', r.reviewed === 0 ? 'detector: no corrections yet' : `detector: you agreed with ${r.agreed} of ${r.reviewed} verdicts (${pct(r.agreed, r.reviewed)})`)
  return lines.join('\n')
}
