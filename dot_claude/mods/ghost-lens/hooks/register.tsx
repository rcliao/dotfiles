import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Captured, Recall, TraceRow } from '../types'
import {
  addRecalls,
  bandLines,
  belowFloor,
  closeOut,
  enrich,
  finalVerdict,
  flagRisk,
  fmtTok,
  hookChannel,
  inputText,
  isCorrection,
  isGhostTool,
  judge,
  ledger,
  ledgerText,
  logLines,
  newRecall,
  parseInjected,
  parseToolMemories,
  parseTrace,
  pathTokens,
  recallsFromLog,
  shortKey,
  statusText,
  summarize,
} from './lens.ts'
import { buildReport, reportText } from './report.ts'
import type { SessionLogs } from './report.ts'

const recallsAtom = atom({ plugin: 'ghost-lens', key: 'recalls' } as const, [] as Recall[])
const turnAtom = atom({ plugin: 'ghost-lens', key: 'turn' } as const, 0)
const tracesAtom = atom({ plugin: 'ghost-lens', key: 'traces' } as const, [] as TraceRow[])
const traceSeenAtom = atom({ plugin: 'ghost-lens', key: 'traceSeen' } as const, {} as Record<string, number>)
const sessionAtom = atom({ plugin: 'ghost-lens', key: 'session' } as const, null as string | null)
// Quiet by default: nothing on screen unless the person turns debugging on.
const debugAtom = atom({ plugin: 'ghost-lens', key: 'debug' } as const, false)
const capturedAtom = atom({ plugin: 'ghost-lens', key: 'captured' } as const, [] as Captured[])
const selectedAtom = atom({ plugin: 'ghost-lens', key: 'selected' } as const, null as string | null)

const PANE = 'ghost-lens'
const CONTEXT_TOOL = 'mcp__ghost__ghost_context'
const RECALL_TOOLS = new Set([CONTEXT_TOOL, 'mcp__ghost__ghost_search'])
const FETCH_TOOLS = new Set(['mcp__ghost__ghost_get', 'mcp__ghost__ghost_expand'])
const WRITE_TOOLS = new Set(['mcp__ghost__ghost_put', 'mcp__ghost__ghost_patch'])
// Eval (2026-10-02, run-ledger): a tool description alone was chosen 0/5, one system-prompt sentence 3/3.
// Live-usage eval (2026-09-23): explicit ghost_context is the best channel but ran in 15 of 45 sessions.
const NUDGE =
  `Before non-trivial work in an unfamiliar area, a design decision, or debugging an error you may have seen before, call ${CONTEXT_TOOL} with the task as the query. Automatically injected ghost memories are often off-topic: ignore any that do not apply.`
const CORPUS_MAX = 200_000

// Module state: rebuilt on reload, which only loses the current turn's evidence.
let session = 'unknown'
let logPath: string | undefined
let logDir: string | undefined
let tracePath: string | undefined
let traceDir: string | undefined
let defaultNs = 'agent:claude-code'
let ghostBin = 'ghost'
// The prompt hook's session cap (same variable and default as the hook).
let tokenCap = 6000
let isWriting = false
let prompt = ''
let corpus = ''
let fetched = new Set<string>()

function rowText(content: readonly unknown[]): string {
  return content
    .map(b => {
      const block = b as { type?: string; text?: unknown; content?: unknown }
      if (typeof block.text === 'string') return block.text
      if (typeof block.content === 'string') return block.content
      return ''
    })
    .join('\n')
}

async function persist($: EngineInterface): Promise<void> {
  const recalls = await read($, recallsAtom)
  $.ui.status((await read($, debugAtom)) ? statusText(summarize(recalls)) : undefined)
  if (logPath !== undefined) {
    try {
      await $.fs.write(logPath, logLines(session, recalls))
    } catch {
      // The log is a convenience for measuring the detector; never fail a turn over it.
    }
  }
}

// session.start does not fire on /clear: the id changes under a running process.
// Point the trace and log at the new id and start this session's view over.
async function syncSession($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  const dir = traceDir ?? '/tmp'
  session = id
  tracePath = `${dir}/ghost-trace-${id}.jsonl`
  if (logDir !== undefined) logPath = `${logDir}/${id}.jsonl`
  const owner = await read($, sessionAtom)
  if (owner === id) return
  // A different session from the one this state belongs to (/clear, /resume, or a
  // fresh process): start its view over, then take back whatever its log already
  // holds, so a resumed session keeps its verdicts instead of overwriting them.
  if (owner !== null) {
    await update($, tracesAtom, () => [])
    await update($, capturedAtom, () => [])
    await update($, turnAtom, () => 0)
    await update($, selectedAtom, () => null)
  }
  const logged = logPath === undefined ? [] : recallsFromLog(await $.fs.read(logPath).catch(() => ''))
  if (owner !== null || (await read($, recallsAtom)).length === 0) await update($, recallsAtom, () => logged)
  await update($, sessionAtom, () => id)
}

// New lines of the hooks' trace: scores, token costs, skip reasons.
async function readTrace($: EngineInterface): Promise<void> {
  await syncSession($)
  if (tracePath === undefined) return
  const path = tracePath
  let text: string
  try {
    text = await $.fs.read(path)
  } catch {
    return // no trace yet: hooks not updated, or nothing ran this session
  }
  const turn = await read($, turnAtom)
  const seenByFile = await read($, traceSeenAtom)
  // v0.2 kept one number for every file.
  const seen = typeof seenByFile === 'object' && seenByFile !== null ? (seenByFile[path] ?? 0) : 0
  const parsed = parseTrace(text, seen, turn)
  await update($, traceSeenAtom, prev => ({ ...(typeof prev === 'object' && prev !== null ? prev : {}), [path]: parsed.seen }))
  if (parsed.rows.length === 0) return
  // /tmp is cleared on reboot: keep a durable copy beside the shadow log for /ghost report.
  if (logDir !== undefined) {
    try {
      await $.fs.write(`${logDir}/${session}.trace.jsonl`, text)
    } catch {
      // a convenience copy; the live view does not depend on it
    }
  }
  await update($, tracesAtom, prev => [...prev, ...parsed.rows].slice(-200))
  await update($, recallsAtom, list => enrich(list, parsed.rows))
  await persist($)
}

// Paths a memory names that are gone from this repo: likely stale.
async function checkStale($: EngineInterface): Promise<void> {
  const recalls = await read($, recallsAtom)
  const found = new Map<string, string[]>()
  for (const r of recalls) {
    if (r.stale !== undefined) continue
    const gone: string[] = []
    for (const p of pathTokens(r.tokens)) {
      try {
        if ((await $.fs.exists(p.top)) && !(await $.fs.exists(p.path))) gone.push(p.path)
      } catch {
        // unreadable path: no evidence either way
      }
    }
    found.set(`${r.ns}\u0000${r.key}`, gone)
  }
  if (found.size === 0) return
  await update($, recallsAtom, list =>
    list.map(r => {
      const gone = found.get(`${r.ns}\u0000${r.key}`)
      return gone === undefined || r.stale !== undefined ? r : { ...r, stale: gone }
    }),
  )
}

async function addAndCheck($: EngineInterface, found: Recall[]): Promise<void> {
  if (found.length === 0) return
  // The trace line may have been read before the hook's text row arrived.
  const traces = await read($, tracesAtom)
  await update($, recallsAtom, prev => enrich(addRecalls(prev, found), traces))
  await checkStale($)
  await persist($)
}

async function reportUsed($: EngineInterface, used: Recall[]): Promise<void> {
  if (!isWriting) return
  for (const r of used) {
    const ran = await $.process.run([ghostBin, 'curate', '--ns', r.ns, '--key', r.key, '--op', 'used'])
    if (ran.exitCode !== 0) $.ui.toast(`ghost-lens: curate used failed for ${r.key}`)
  }
}

async function correct($: EngineInterface, key: string, ns: string, to: 'used' | 'unused'): Promise<void> {
  await update($, recallsAtom, list => list.map(r => (r.key === key && r.ns === ns ? { ...r, corrected: to } : r)))
  await persist($)
}

// Every session's shadow log and trace copy under ~/.ghost/lens, aggregated.
async function crossSessionReport($: EngineInterface): Promise<string> {
  if (logDir === undefined) return 'ghost report: no log directory ($HOME unset).'
  await persist($) // this session's latest verdicts first
  let entries
  try {
    entries = await $.fs.list(logDir)
  } catch {
    return `ghost report: cannot read ${logDir}.`
  }
  const sessions: SessionLogs[] = []
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || f.name.endsWith('.trace.jsonl')) continue
    const id = f.name.slice(0, -'.jsonl'.length)
    const shadow = await $.fs.read(`${logDir}/${f.name}`).catch(() => '')
    const trace = await $.fs.read(`${logDir}/${id}.trace.jsonl`).catch(() => '')
    sessions.push({ shadow, trace })
  }
  return reportText(buildReport(sessions))
}

// The context window size, for ghost's share of it; undefined where the host has none.
async function contextWindow($: EngineInterface): Promise<number | undefined> {
  try {
    return (await $.session.usage()).context.window
  } catch {
    return undefined
  }
}

async function select($: EngineInterface, id: string | null): Promise<void> {
  await update($, selectedAtom, cur => (cur === id ? null : id))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    defaultNs = (await $.env.get('GHOST_AGENT_NS')) ?? 'agent:claude-code'
    ghostBin = (await $.env.get('GHOST_BIN')) ?? 'ghost'
    isWriting = (await $.env.get('GHOST_LENS_WRITE')) === '1'
    const cap = Number((await $.env.get('GHOST_SESSION_TOKEN_CAP')) ?? '6000')
    tokenCap = Number.isFinite(cap) && cap >= 0 ? cap : 6000
    traceDir = (await $.env.get('GHOST_TRACE_DIR')) ?? '/tmp'
    const home = await $.env.get('HOME')
    if (home !== undefined) {
      const dir = `${home}/.ghost/lens`
      try {
        await $.process.run(['mkdir', '-p', dir])
        logDir = dir
      } catch {
        logDir = undefined
      }
    }
    await $.command.register({
      name: 'ghost',
      description: 'Show what ghost loaded this session and whether the agent used it; debug|quiet toggles the band and status line',
      argumentHint: '[report|debug|quiet|close]',
      immediate: true,
    })
    if ((await $.env.get('GHOST_LENS_DEBUG')) === '1') await update($, debugAtom, () => true)
    // Sets session, tracePath and logPath, and reads the session-start trace line.
    await readTrace($)
    await persist($)
    return next(e)
  })

  // What ghost's shell hooks inject arrives as hook-context rows.
  on('session.append', async ($, e, next) => {
    const appended = await next(e)
    if (e.agentId !== undefined || e.door !== 'hook-context') return appended
    const text = rowText(e.message.content)
    const channel = hookChannel(text)
    if (channel === undefined) return appended
    // After /clear the SessionStart block arrives before any turn: switch logs first.
    await syncSession($)
    const turn = await read($, turnAtom)
    const at = await $.clock.now()
    await addAndCheck($, parseInjected(text).map(i => newRecall(i, defaultNs, channel, turn, at)))
    await readTrace($)
    return appended
  })

  on('prompt.submit', async ($, e, next) => {
    // A delivery into a running turn (turnId set) must not wipe that turn's evidence.
    if (e.turnId !== undefined) {
      prompt += `\n${e.text}`
      return next(e)
    }
    await syncSession($)
    prompt = e.text
    corpus = ''
    fetched = new Set()
    if (isCorrection(e.text)) {
      const lastTurn = (await read($, turnAtom)) - 1
      await update($, recallsAtom, list => flagRisk(list, lastTurn))
      await persist($)
    }
    return next(e)
  })

  // The prompt hook has run by now, skipped or not: pick up its trace line.
  on('turn.start', async ($, e, next) => {
    await readTrace($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    if (FETCH_TOOLS.has(tool) && typeof input.key === 'string') fetched.add(input.key)
    // Ghost's own tools name keys to curate, link or store them, not to use them.
    if (!isGhostTool(tool) && corpus.length < CORPUS_MAX) corpus += `\n${inputText(input)}`

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    if (RECALL_TOOLS.has(tool) || WRITE_TOOLS.has(tool)) await syncSession($)
    if (RECALL_TOOLS.has(tool)) {
      const turn = await read($, turnAtom)
      const at = await $.clock.now()
      const query = typeof input.query === 'string' ? input.query : undefined
      const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : JSON.stringify(ran.result ?? ''))
      const found = parseToolMemories(text).map(m => ({ ...newRecall(m, m.ns ?? defaultNs, 'explicit', turn, at), query }))
      await addAndCheck($, found)
    } else if (WRITE_TOOLS.has(tool) && typeof input.key === 'string') {
      const key = input.key
      const ns = typeof input.ns === 'string' ? input.ns : defaultNs
      const turn = await read($, turnAtom)
      await update($, capturedAtom, prev => [...prev, { key, ns, turn, tool: tool.replace('mcp__ghost__ghost_', '') }].slice(-100))
      if (await read($, debugAtom)) $.ui.toast(`ghost saved ${key}`)
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.isAborted) return done
    await syncSession($)
    const turn = await read($, turnAtom)
    const evidence = { corpus: `${corpus}\n${e.answer}`, prompt, fetched }
    const judged = judge(await read($, recallsAtom), evidence, turn)
    await update($, recallsAtom, () => judged.recalls)
    await update($, turnAtom, t => t + 1)
    corpus = ''
    fetched = new Set()
    await persist($)
    await reportUsed($, judged.changed.filter(r => r.verdict === 'used'))
    return done
  })

  on('session.end', async ($, e, next) => {
    await update($, recallsAtom, list => closeOut(list))
    await persist($)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(CONTEXT_TOOL)) return composed
    return { sections: [...composed.sections, { id: 'ghost-lens:recall', text: NUDGE, scope: 'session' }] }
  })

  on('command.run', { command: 'ghost' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'report') return { text: await crossSessionReport($) }
    if (arg === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'ghost: pane closed.' }
    }
    if (arg === 'debug' || arg === 'quiet') {
      await update($, debugAtom, () => arg === 'debug')
      await persist($)
      return { text: arg === 'debug' ? 'ghost: debug on (band, status line, toasts). /ghost quiet to hide.' : 'ghost: quiet. /ghost opens the pane any time.' }
    }
    // Focused so Esc closes it when you are done reviewing.
    await $.ui.open({ id: PANE, title: 'Ghost', focus: true, closeOnEscape: true })
    const s = summarize(await read($, recallsAtom))
    return {
      text: `ghost: ${s.recalled} loaded (${fmtTok(s.tok)} tok), ${s.used} used, ${s.unused} unused (${fmtTok(s.wastedTok)} tok), ${s.pending} pending${isWriting ? '' : ' · shadow mode'}.`,
    }
  })

  // One or two lines above the prompt: what ghost did for the prompt just sent.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || !(await read($, debugAtom))) return below
    const traces = await read($, tracesAtom)
    const latest = [...traces].reverse().find(t => t.hook === 'prompt') ?? [...traces].reverse().find(t => t.hook === 'session-start')
    const lines = bandLines(latest, e.props.bodyColumns ?? 100, ledger(traces, await read($, recallsAtom), tokenCap))
    if (lines.length === 0) return below
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Text key={`gl${i}`} dimColor={i > 0 || latest?.outcome !== 'injected'} color={i > 0 ? 'yellow' : undefined}>
            {line}
          </Text>
        ))}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const recalls = await read($, recallsAtom)
    const traces = await read($, tracesAtom)
    const captured = await read($, capturedAtom)
    const selected = await read($, selectedAtom)
    const s = summarize(recalls)
    const width = e.props.bodyColumns ?? 80
    const keyWidth = Math.max(12, width - 34)
    const rows = [...recalls].reverse()
    const pick = rows.find(r => `${r.ns}:${r.key}` === selected)
    const runs = [...traces].reverse().slice(0, 8)
    const window = await contextWindow($)

    return (
      <Box flexDirection="column">
        <Text bold>
          Loaded {s.recalled} · {fmtTok(s.tok)} tok · {s.used} used · {s.unused} unused ({fmtTok(s.wastedTok)} tok) · {s.pending} pending
        </Text>
        <Text>{ledgerText(ledger(traces, recalls, tokenCap), window)}</Text>
        <Text dimColor>
          {s.stale > 0 ? `${s.stale} likely stale · ` : ''}
          {s.risky > 0 ? `${s.risky} to check · ` : ''}
          {s.reviewed === 0 ? 'no corrections yet' : `you agreed with ${s.agreed} of ${s.reviewed}`}
          {isWriting ? '' : ' · shadow mode, nothing written to ghost'}
        </Text>
        <Text dimColor>Esc or /ghost close to close</Text>

        {pick !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{pick.key}</Text>
            <Text dimColor>
              {pick.channel} · turn {pick.shownTurn} · {pick.score === undefined ? 'no score' : `score ${pick.score.toFixed(2)}`}
              {pick.floor === undefined ? '' : ` / floor ${pick.floor}`}
              {pick.via !== undefined ? ` · via ${pick.via}` : belowFloor(pick) ? ' (under the floor: came in by edge or rescue)' : ''} · {pick.tok} tok
            </Text>
            {pick.query !== undefined && <Text dimColor>query: {pick.query.slice(0, width - 8)}</Text>}
            <Text>
              verdict: {finalVerdict(pick)}
              {pick.corrected !== undefined ? ` (you; mod said ${pick.verdict})` : ''}
              {pick.evidence !== undefined ? ` · ${pick.evidence}` : ''}
            </Text>
            {pick.tokens.length > 0 && <Text dimColor>tokens: {pick.tokens.slice(0, 10).join(', ').slice(0, width - 9)}</Text>}
            {(pick.stale?.length ?? 0) > 0 && <Text color="yellow">missing here: {pick.stale?.join(', ')}</Text>}
            {pick.risk !== undefined && <Text color="yellow">check: {pick.risk}</Text>}
            <Text>{pick.content}</Text>
            <Box flexDirection="row">
              <Button key={`du:${pick.key}`} label="used" plain onPress={() => correct($, pick.key, pick.ns, 'used')} />
              <Text> </Text>
              <Button key={`dn:${pick.key}`} label="noise" plain onPress={() => correct($, pick.key, pick.ns, 'unused')} />
              <Text> </Text>
              <Button key={`dc:${pick.key}`} label="close" plain onPress={() => select($, null)} />
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text bold>Memories</Text>
        </Box>
        <Text dimColor>{'turn  from    score   tok  verdict  key'}</Text>
        {rows.length === 0 && <Text dimColor>Nothing loaded yet.</Text>}
        {rows.slice(0, 40).map(r => {
          const v = finalVerdict(r)
          // ghost's own via when it is more than a plain search hit; the floor guess for older binaries.
          const how = r.via !== undefined && r.via !== 'search' ? ` ${r.via}` : r.via === undefined && belowFloor(r) ? ' <floor' : ''
          const flag = (r.stale?.length ?? 0) > 0 ? ' stale' : r.risk !== undefined ? ' check' : how
          return (
            <Box flexDirection="row" key={`r:${r.ns}:${r.key}`}>
              <Text dimColor>
                {String(r.shownTurn).padStart(4)}  {(r.channel === 'session-start' ? 'start' : r.channel === 'prompt' ? 'prompt' : 'ask').padEnd(6)}{' '}
                {(r.score === undefined ? '—' : r.score.toFixed(2)).padStart(5)} {String(r.tok ?? 0).padStart(5)}{'  '}
              </Text>
              <Text color={v === 'used' ? 'green' : v === 'pending' ? 'yellow' : undefined} dimColor={v === 'unused'}>
                {v.padEnd(8)}
              </Text>
              <Button key={`s:${r.ns}:${r.key}`} label={shortKey(r.key, keyWidth)} plain onPress={() => select($, `${r.ns}:${r.key}`)} />
              <Text color="yellow">{flag}</Text>
            </Box>
          )
        })}

        <Box marginTop={1}>
          <Text bold>Hook runs</Text>
        </Box>
        {runs.length === 0 && <Text dimColor>No trace yet (hooks write /tmp/ghost-trace-&lt;session&gt;.jsonl).</Text>}
        {runs.map((t, i) => (
          <Text key={`t:${i}`} dimColor={t.outcome !== 'injected'}>
            {String(t.turn).padStart(4)}  {t.hook.padEnd(13)} {t.outcome === 'injected'
              ? `loaded ${t.injected.length} · ${fmtTok(t.tok)} tok${(t.budget ?? 0) > 0 ? ` (ghost packed ${fmtTok(t.used ?? 0)} of ${fmtTok(t.budget)} budget)` : ''}`
              : `${t.outcome}: ${t.reason ?? ''}`}
          </Text>
        ))}

        <Box marginTop={1}>
          <Text bold>Captured</Text>
        </Box>
        {captured.length === 0 && <Text dimColor>No agent writes this session.</Text>}
        {[...captured].reverse().slice(0, 10).map((c, i) => (
          <Text key={`c:${i}`}>
            {String(c.turn).padStart(4)}  {c.tool.padEnd(6)} {shortKey(c.key, width - 14)}
          </Text>
        ))}
      </Box>
    )
  })
}
