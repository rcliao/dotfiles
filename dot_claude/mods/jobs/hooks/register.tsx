import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Job } from '../types'
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
  statusLine,
  trimJobs,
  visibleLines,
} from './progress.ts'
import type { TaskEnd } from './progress.ts'

const PANE = 'jobs'
const TITLE = 'Background jobs'
const POLL_MS = 5_000
const TAIL_BYTES = '16384'

const REPORT_RULE =
  'When you start a long-running command with run_in_background and you control its output (a script or loop you write), have it print progress lines `::progress <done>/<total> <what>` (or `::progress <n>%`), and `::status <text>` on a phase change; the user sees them live in the jobs footer and pane.'

const listAtom = atom({ plugin: 'jobs', key: 'list' } as const, [] as Job[])
const lastPromptAtom = atom({ plugin: 'jobs', key: 'lastPromptAt' } as const, 0)

const finish = (jobs: readonly Job[], ends: readonly TaskEnd[], now: number) => {
  const done: Job[] = []
  const list = jobs.map(job => {
    const end = ends.find(x => x.id === job.id)
    if (end === undefined || job.status !== 'running') return job
    const next: Job = { ...job, status: end.status, endedAt: now }
    if (end.exitCode !== undefined) next.exitCode = end.exitCode
    done.push(next)
    return next
  })
  return { list: trimJobs(list), done }
}

// The rows live in the band above the prompt (info, not a ⚠ pinned status); redraw it.
async function refreshStatus($: EngineInterface): Promise<void> {
  $.ui.invalidate('ui.render')
}

async function endJobs($: EngineInterface, ends: readonly TaskEnd[]): Promise<void> {
  if (ends.length === 0) return
  const now = await $.clock.now()
  let done: Job[] = []
  await update($, listAtom, prev => {
    const out = finish(prev ?? [], ends, now)
    done = out.done
    return out.list
  })
  // Only what you'd otherwise miss gets a toast; a completed job is a dim band row.
  for (const job of done) if (job.status !== 'completed') $.ui.toast(`${job.label}: ${progressText(job, now)}`)
  await refreshStatus($)
}

async function addJob($: EngineInterface, job: Job): Promise<void> {
  await update($, listAtom, prev => trimJobs([...(prev ?? []).filter(j => j.id !== job.id), job]))
  await refreshStatus($)
}

// One pass over running jobs: tail logs that grew, ask the engine about agents.
async function poll($: EngineInterface): Promise<void> {
  const jobs = await read($, listAtom)
  const running = jobs.filter(j => j.status === 'running')
  // Still refresh when idle, so a finished job leaves the status line once it is no longer recent.
  if (running.length === 0) return refreshStatus($)
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
    await update($, listAtom, prev => (prev ?? []).map(j => ({ ...j, ...(changes.get(j.id) ?? {}) })))
  }
  await endJobs($, ends)
  await refreshStatus($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'jobs',
      description: 'Background job progress (open pane; watch <file> [label]; unwatch <label>; clear)',
      argumentHint: '[watch <file> [label] | unwatch <label> | clear]',
      immediate: true,
    })
    $.clock.every(POLL_MS, () => {
      void poll($)
    })
    // Earlier versions pinned a status line; a reload must take it down.
    $.ui.status(undefined)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const now = await $.clock.now()

    if (e.tool === 'Bash') {
      const started = parseBackgroundStart(ran.text ?? '')
      if (started !== undefined) {
        const job: Job = {
          id: started.id,
          kind: 'shell',
          label: shortLabel(e.description ?? e.command),
          startedAt: now,
          status: 'running',
          history: [],
        }
        if (started.file !== undefined) job.file = started.file
        await addJob($, job)
      }
    } else if (e.tool === 'Agent') {
      const result = ran.result as { status?: string; agentId?: string; description?: string } | undefined
      if (result?.status === 'async_launched' && result.agentId !== undefined) {
        await addJob($, {
          id: result.agentId,
          kind: 'agent',
          label: shortLabel(`agent: ${result.description ?? 'background'}`),
          startedAt: now,
          status: 'running',
          history: [],
        })
      }
    } else if (e.tool === 'TaskStop') {
      const id = e.task_id ?? e.shell_id
      if (id !== undefined) await endJobs($, [{ id, status: 'killed' }])
    }
    return ran
  })

  // Completion: the engine appends a <task-notification> row (and may deliver one) when a task ends.
  on('session.append', async ($, e, next) => {
    const text = JSON.stringify(e.message.content ?? '')
    if (text.includes('task-notification')) await endJobs($, parseTaskEnds(text.replace(/\\n/g, '\n')))
    return next(e)
  })

  // Failed/killed rows stay in the band until the person's next prompt.
  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, lastPromptAtom, () => now)
    return next(e)
  })

  on('session.receive', async ($, e, next) => {
    if (e.text.includes('task-notification')) await endJobs($, parseTaskEnds(e.text))
    return next(e)
  })

  on('command.run', { command: 'jobs' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const now = await $.clock.now()

    if (verb === 'watch') {
      const [file, ...label] = rest
      if (file === undefined) return { text: 'Usage: /jobs watch <file> [label]' }
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
      await update($, listAtom, prev => (prev ?? []).filter(j => !(j.kind === 'watch' && (j.label === key || j.file === key))))
      await refreshStatus($)
      return { text: `Stopped watching ${key}.` }
    }
    if (verb === 'clear') {
      await update($, listAtom, prev => (prev ?? []).filter(j => j.status === 'running'))
      await refreshStatus($)
      return { text: 'Cleared finished jobs.' }
    }

    await $.ui.open({ id: PANE, title: TITLE })
    const jobs = await read($, listAtom)
    if (jobs.length === 0) return { text: 'No background jobs.' }
    return { text: jobs.map(j => `${j.status === 'running' ? 'run ' : 'end '} ${j.label}  ${duration(now - j.startedAt)}  ${progressText(j, now)}`).join('\n') }
  })

  // Without a prompt rule, a model-facing convention goes unused (see run-ledger's eval: 0/5 → 3/3).
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes('Bash')) return composed
    return { sections: [...composed.sections, { id: 'jobs:progress', text: REPORT_RULE, scope: 'session' }] }
  })

  // The band above the prompt always has room (the footer tail is dropped when the footer is full).
  // Draw after whatever is beneath, so run-ledger's line stays on top in either load order.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const rows = bandRows(await read($, listAtom), await $.clock.now(), Math.max(20, e.props.bodyColumns - 1), await read($, lastPromptAtom))
    if (rows.length === 0) return below
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        {rows.map(row =>
          row.tone === 'failed' ? (
            <Text key={row.key} color="red">{row.text}</Text>
          ) : (
            <Text key={row.key} dimColor={row.tone === 'done'}>{row.text}</Text>
          ),
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const jobs = await read($, listAtom)
    const now = await $.clock.now()
    const width = Math.max(20, e.props.bodyColumns - 2)
    const ordered = [...jobs.filter(j => j.status === 'running'), ...jobs.filter(j => j.status !== 'running').reverse()]

    if (ordered.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No background jobs.</Text>
          <Text dimColor>Started with run_in_background, a background agent, or /jobs watch &lt;file&gt;.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {ordered.map(job => (
          <Box key={job.id} flexDirection="column" marginBottom={1}>
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
                  await update($, listAtom, prev => (prev ?? []).filter(j => j.id !== job.id))
                  await refreshStatus($)
                }} />
              ) : null}
            </Box>
            {job.lastLine === undefined ? null : (
              <Text dimColor wrap="truncate-end">{job.lastLine.slice(0, width)}</Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
