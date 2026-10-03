import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CtxSample, LedgerEntry, TurnSample } from '../types'
import {
  appendEntries,
  appendSample,
  classifyBash,
  classifyMcp,
  appendTurn,
  ctxView,
  FILE_TOOLS,
  ledgerMarkdown,
  summaryLine,
} from './ledger.ts'

const entriesAtom = atom({ plugin: 'run-ledger', key: 'entries' } as const, [] as LedgerEntry[])
const ctxAtom = atom({ plugin: 'run-ledger', key: 'ctx' } as const, [] as CtxSample[])
const failsAtom = atom({ plugin: 'run-ledger', key: 'fails' } as const, 0)
const turnsAtom = atom({ plugin: 'run-ledger', key: 'turns' } as const, [] as TurnSample[])
const limitsAtom = atom({ plugin: 'run-ledger', key: 'limits' } as const, null as null | { window: number; threshold?: number; isAutoCompact: boolean })

const LEDGER_TOOL = 'mcp__run-ledger__ledger'
const REPORT_RULE =
  `Before you write an end-of-run report or summary of what you changed (for example under Changed / Blocked on me / Found), call ${LEDGER_TOOL} and build the Changed section from it, so no commit, PR, tag, publish, outward write or edited file is left out.`
// Context grows inside one long autonomous turn, so sample between tool calls too, at most this often.
const SAMPLE_EVERY_MS = 15_000

async function sampleContext($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const { tokens, percent } = usage.context
  // Absent before the window's first response and right after a compaction.
  if (tokens === undefined || percent === undefined) return
  const sample: CtxSample = { percent, tokens, usd: usage.cost?.usd, at: await $.clock.now() }
  await update($, ctxAtom, prev => appendSample(prev, sample))
}

// Once per main-loop turn: the turn's end size (growth per turn) and the compaction threshold.
// `summary` is the engine's local estimate: no token-count requests.
async function sampleTurn($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const { tokens, window, breakdown } = usage.context
  const limits =
    breakdown?.autoCompactThreshold === undefined
      ? { window, isAutoCompact: breakdown?.isAutoCompactEnabled ?? false }
      : { window, threshold: breakdown.autoCompactThreshold, isAutoCompact: breakdown.isAutoCompactEnabled }
  await update($, limitsAtom, () => limits)
  if (tokens === undefined) return
  const turn: TurnSample = { tokens, at: await $.clock.now() }
  await update($, turnsAtom, prev => appendTurn(prev, turn))
}

async function currentLedger($: EngineInterface): Promise<string> {
  return ledgerMarkdown(
    await read($, entriesAtom),
    await read($, ctxAtom),
    await read($, failsAtom),
    await read($, turnsAtom),
    await read($, limitsAtom),
  )
}

export const register: Register = on => {
  let lastSampleAt = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ledger',
      description: 'Show what this run changed and sent out, plus context use (reset: start a new baseline)',
      argumentHint: '[reset]',
      immediate: true,
    })
    await $.tool.register({
      name: 'ledger',
      description:
        "This session's ledger of PRs, commits, tags, publishes, paid calls, outward writes, files edited, failures and context use. Read it before writing the end-of-run Changed / Blocked on me / Found report.",
      inputSchema: { type: 'object', properties: {} },
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === LEDGER_TOOL) return { result: await currentLedger($) }

    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const now = await $.clock.now()

    if (e.tool === 'Bash') {
      if (ran.isError === true) await update($, failsAtom, n => (n ?? 0) + 1)
      const found = classifyBash(e.command, ran.text ?? '', now, ran.isError === true)
      if (found.length > 0) await update($, entriesAtom, prev => appendEntries(prev, found))
    } else if (ran.isError !== true) {
      const filePath = FILE_TOOLS.has(String(e.tool)) ? (e as { file_path?: unknown }).file_path : undefined
      const found =
        typeof filePath === 'string'
          ? { kind: 'file' as const, label: filePath, at: now }
          : classifyMcp(String(e.tool), now)
      if (found !== undefined) await update($, entriesAtom, prev => appendEntries(prev, [found]))
    }

    if (now - lastSampleAt >= SAMPLE_EVERY_MS) {
      lastSampleAt = now
      await sampleContext($)
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Subagent turns fire this too; only the main loop's window is the one on screen.
    if (e.agentId === undefined) {
      lastSampleAt = await $.clock.now()
      await sampleContext($)
      await sampleTurn($)
    }
    return done
  })

  // Eval finding: with the tool description alone the model never read the ledger (0/3 runs).
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(LEDGER_TOOL)) return composed
    return { sections: [...composed.sections, { id: 'run-ledger:report', text: REPORT_RULE, scope: 'session' }] }
  })

  on('command.run', { command: 'ledger' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      // A new baseline for a new task in a long session; context figures are the session's and stay.
      await update($, entriesAtom, () => [])
      await update($, failsAtom, () => 0)
      return { text: 'Ledger reset: changes, outward actions and failures start from zero.' }
    }
    return { text: await currentLedger($) }
  })

  // Stack on whatever is beneath (another mod's band, e.g. jobs) instead of replacing it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const summary = summaryLine(await read($, entriesAtom))
    const view = ctxView(await read($, ctxAtom), await read($, turnsAtom), await read($, limitsAtom))
    const ctx = view?.text
    if (ctx === undefined && summary === '') return below
    const ctxColor = view?.level === 'hot' ? 'red' : view?.level === 'warn' ? 'yellow' : undefined
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {ctx === undefined ? null : ctxColor === undefined ? <Text dimColor>{ctx}</Text> : <Text color={ctxColor}>{ctx}</Text>}
          {summary === '' ? null : <Text dimColor>{`${ctx === undefined ? '' : '   '}${summary}`}</Text>}
        </Box>
        {below}
      </Box>
    )
  })
}
