// Pure helpers: parse progress out of a log tail, read the engine's background texts, format. No `$`.
import type { Job, JobProgress, JobStatus } from '../types'

export const MAX_FINISHED = 8
// A finished job stays in the status line this long.
export const RECENT_MS = 120_000
// Output that has not grown for this long is called out as quiet (possible stall).
export const QUIET_MS = 180_000

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

// A progress bar redraws one line with \r: the visible line is the segment after the last \r.
export const visibleLines = (tail: string): string[] =>
  tail
    .replace(ANSI, '')
    .split('\n')
    .map(line => (line.split('\r').filter(s => s.trim() !== '').pop() ?? '').trim())
    .filter(line => line !== '')

const UNIT: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 }
const SIZE = /([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB)\s*(?:\/|of)\s*([\d.]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB)\b/i
const PERCENT = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s?%/
const COUNT = /(?<![\d./:-])(\d+)\s*(?:\/|\bof\b)\s*(\d+)(?![\d./:-])/

const clampPct = (n: number) => Math.max(0, Math.min(100, n))

// Lines a job prints to report on itself: `::progress 12/40 uploading`, `::progress 64%`, `::status waiting on CI`.
const MARK_PROGRESS = /^::progress\s+(\S+)\s*(.*)$/
const MARK_STATUS = /^::status\s+(.+)$/
export const isMarker = (line: string): boolean => line.startsWith('::progress ') || line.startsWith('::status ')

const specPct = (spec: string): number | undefined => {
  const pct = /^(\d{1,3}(?:\.\d+)?)%$/.exec(spec)
  if (pct?.[1] !== undefined) return clampPct(Number(pct[1]))
  const count = /^(\d+)\/(\d+)$/.exec(spec)
  if (count && Number(count[2]) > 0) return clampPct((Number(count[1]) / Number(count[2])) * 100)
  const size = /^([\d.]+)(B|KB|MB|GB|TB|KiB|MiB|GiB)\/([\d.]+)(B|KB|MB|GB|TB|KiB|MiB|GiB)$/i.exec(spec)
  if (size) {
    const done = Number(size[1]) * (UNIT[(size[2] ?? 'b').toLowerCase()] ?? 1)
    const total = Number(size[3]) * (UNIT[(size[4] ?? 'b').toLowerCase()] ?? 1)
    if (total > 0) return clampPct((done / total) * 100)
  }
  return undefined
}

// The job's own report wins over anything guessed: the newest ::progress, plus a newer ::status.
const parseMarkers = (lines: readonly string[]): JobProgress | undefined => {
  let progress: { at: number; spec: string; msg: string } | undefined
  let status: { at: number; msg: string } | undefined
  for (let i = lines.length - 1; i >= 0 && (progress === undefined || status === undefined); i--) {
    const line = lines[i] ?? ''
    const p = progress === undefined ? MARK_PROGRESS.exec(line) : null
    if (p) progress = { at: i, spec: p[1] ?? '', msg: (p[2] ?? '').trim() }
    const s = status === undefined ? MARK_STATUS.exec(line) : null
    if (s) status = { at: i, msg: (s[1] ?? '').trim() }
  }
  if (progress === undefined && status === undefined) return undefined
  const msg = status !== undefined && (progress === undefined || status.at > progress.at) ? status.msg : progress?.msg ?? ''
  const pct = progress === undefined ? undefined : specPct(progress.spec)
  const text = [progress?.spec, msg].filter(Boolean).join(' ')
  return pct === undefined ? { text } : { pct, text }
}

// Newest line first; within a line an explicit % wins, then byte pairs, then N/M counts.
export const parseProgress = (lines: readonly string[]): JobProgress | undefined => {
  const marked = parseMarkers(lines)
  if (marked !== undefined) return marked
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
    const line = lines[i] ?? ''
    const pct = PERCENT.exec(line)
    if (pct?.[1] !== undefined && Number(pct[1]) <= 100) return { pct: clampPct(Number(pct[1])), text: `${Math.round(Number(pct[1]))}%` }
    const size = SIZE.exec(line)
    if (size) {
      const done = Number(size[1]) * (UNIT[(size[2] ?? 'b').toLowerCase()] ?? 1)
      const total = Number(size[3]) * (UNIT[(size[4] ?? 'b').toLowerCase()] ?? 1)
      if (total > 0 && done <= total) return { pct: clampPct((done / total) * 100), text: `${size[1]} ${size[2]} / ${size[3]} ${size[4]}` }
    }
    const count = COUNT.exec(line)
    if (count) {
      const done = Number(count[1])
      const total = Number(count[2])
      if (total > 1 && done <= total) return { pct: clampPct((done / total) * 100), text: `${done}/${total}` }
    }
  }
  return undefined
}

export const lastLineOf = (lines: readonly string[]): string | undefined => {
  const line = lines.filter(l => !isMarker(l)).pop()
  if (line === undefined) return undefined
  return line.length > 160 ? `${line.slice(0, 159)}…` : line
}

// "Command running in background with ID: bpvctn69i. Output is being written to: /…/bpvctn69i.output."
export const parseBackgroundStart = (text: string): { id: string; file?: string } | undefined => {
  const id = /running in background with ID: ([\w-]+)/.exec(text)?.[1]
  if (id === undefined) return undefined
  const file = /Output is being written to: (\S+?\.output)\b/.exec(text)?.[1]
  return file === undefined ? { id } : { id, file }
}

export type TaskEnd = { id: string; status: JobStatus; exitCode?: number }

// <task-notification><task-id>…</task-id>…<status>completed</status><summary>… (exit code 0)</summary>
export const parseTaskEnds = (text: string): TaskEnd[] => {
  const ends: TaskEnd[] = []
  for (const block of text.split('<task-notification>').slice(1)) {
    const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(block)?.[1]
    const raw = /<status>\s*([^<\s]+)\s*<\/status>/.exec(block)?.[1]
    if (id === undefined || raw === undefined) continue
    const code = /exit code (-?\d+)/.exec(block)?.[1]
    const status: JobStatus =
      raw === 'killed' || raw === 'stopped' ? 'killed' : raw === 'failed' || (code !== undefined && code !== '0') ? 'failed' : 'completed'
    ends.push(code === undefined ? { id, status } : { id, status, exitCode: Number(code) })
  }
  return ends
}

export const duration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 600) return s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

// Rate over the last few minutes of samples; undefined until there is a measurable rise.
export const eta = (history: Job['history'], now: number): string | undefined => {
  const recent = history.filter(p => now - p.at <= 600_000)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (first === undefined || last === undefined || last.pct <= first.pct || last.at <= first.at) return undefined
  const perMs = (last.pct - first.pct) / (last.at - first.at)
  return `~${duration((100 - last.pct) / perMs)}`
}

export const pushHistory = (history: Job['history'], at: number, pct: number | undefined): Job['history'] => {
  if (pct === undefined) return history
  const prev = history[history.length - 1]
  if (prev !== undefined && pct < prev.pct) return [{ at, pct }] // restarted, or a new phase
  if (prev !== undefined && pct === prev.pct) return history
  return [...history, { at, pct }].slice(-30)
}

export const progressText = (job: Job, now: number): string => {
  if (job.status !== 'running') {
    const took = duration((job.endedAt ?? now) - job.startedAt)
    const code = job.exitCode !== undefined && job.exitCode !== 0 ? ` (exit ${job.exitCode})` : ''
    return `${job.status === 'completed' ? 'done' : job.status}${code} in ${took}`
  }
  const parts: string[] = []
  if (job.progress) parts.push(job.progress.text)
  const left = job.progress?.pct === undefined ? undefined : eta(job.history, now)
  if (left !== undefined) parts.push(left)
  if (job.changedAt !== undefined && now - job.changedAt >= QUIET_MS) parts.push(`quiet ${duration(now - job.changedAt)}`)
  return parts.join(' ')
}

export const statusLine = (jobs: readonly Job[], now: number): string | undefined => {
  const running = jobs.filter(j => j.status === 'running')
  const shown = running.slice(0, 3).map(j => [j.label, progressText(j, now)].filter(Boolean).join(' '))
  if (running.length > 3) shown.push(`+${running.length - 3}`)
  if (shown.length === 0) {
    const recent = jobs.filter(j => j.status !== 'running' && now - (j.endedAt ?? 0) <= RECENT_MS)
    for (const j of recent.slice(-2)) shown.push(`${j.label} ${progressText(j, now)}`)
  }
  // The engine already prefixes a mod's status with its name.
  return shown.length === 0 ? undefined : shown.join(' · ')
}

export const shortLabel = (text: string): string => {
  const one = text.trim().split('\n')[0] ?? ''
  return one.length > 28 ? `${one.slice(0, 27)}…` : one
}

// Keep every running job and the most recent finished ones.
export const trimJobs = (jobs: readonly Job[]): Job[] => {
  const finished = jobs.filter(j => j.status !== 'running')
  const keep = new Set(finished.slice(-MAX_FINISHED))
  return jobs.filter(j => j.status === 'running' || keep.has(j))
}

export type BandRow = { key: string; text: string; tone: 'running' | 'done' | 'failed' }

const pad = (text: string, n: number) => (text.length >= n ? text.slice(0, n) : text + ' '.repeat(n - text.length))

// One row per running job, then the recently finished; aligned columns, cut to the band's width.
// A completed job shows for RECENT_MS; a failed or killed one stays until the person's next prompt.
export const isShownFinished = (job: Job, now: number, lastPromptAt: number): boolean =>
  job.status === 'completed'
    ? now - (job.endedAt ?? 0) <= RECENT_MS
    : job.status !== 'running' && ((job.endedAt ?? 0) > lastPromptAt || now - (job.endedAt ?? 0) <= RECENT_MS)

export const bandRows = (jobs: readonly Job[], now: number, columns: number, lastPromptAt = 0, max = 4): BandRow[] => {
  const running = jobs.filter(j => j.status === 'running')
  const recent = jobs.filter(j => isShownFinished(j, now, lastPromptAt)).reverse()
  const all = [...running, ...recent]
  const rows: BandRow[] = all.slice(0, max).map(job => {
    const word = job.status === 'running' ? 'run ' : job.status === 'completed' ? 'done' : job.status === 'failed' ? 'fail' : 'kill'
    const elapsed = duration((job.endedAt ?? now) - job.startedAt)
    const detail = job.status === 'running' ? progressText(job, now) : job.exitCode !== undefined && job.exitCode !== 0 ? `exit ${job.exitCode}` : ''
    const text = `${word}  ${pad(job.label, 28)}  ${pad(elapsed, 6)}  ${detail}`.trimEnd()
    return {
      key: job.id,
      text: text.length > columns ? `${text.slice(0, Math.max(0, columns - 1))}…` : text,
      tone: job.status === 'running' ? 'running' : job.status === 'completed' ? 'done' : 'failed',
    }
  })
  if (all.length > max) rows.push({ key: 'more', text: `      +${all.length - max} more · /jobs`, tone: 'done' })
  return rows
}
