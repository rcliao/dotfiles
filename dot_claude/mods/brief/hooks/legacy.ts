// The v1 tools the agent already calls, `brief` (status, asks, decisions) and `report` (the facts ledger),
// kept on their own until they are retired: deleting this file and its call in register.tsx removes them whole.
// Nothing here draws; register.tsx calls these from its own hooks (an event takes one hook per module).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ToolCallEnvelope, ToolCallResult } from 'claude-code'

import type { Brief, CtxSample, Decision, LedgerEntry, TurnSample } from '../types'
import { appendDecisions, briefMarkdown, nextBrief, queueText, settleDecisions, validateInput } from './brief'
import { appendEntries, appendSample, appendTurn, classifyBash, classifyMcp, FILE_TOOLS, ledgerMarkdown } from './ledger'

const entriesAtom = atom({ plugin: 'brief', key: 'entries' } as const, [] as LedgerEntry[])
const ctxAtom = atom({ plugin: 'brief', key: 'ctx' } as const, [] as CtxSample[])
const failsAtom = atom({ plugin: 'brief', key: 'fails' } as const, 0)
const turnsAtom = atom({ plugin: 'brief', key: 'turns' } as const, [] as TurnSample[])
const limitsAtom = atom({ plugin: 'brief', key: 'limits' } as const, null as null | { window: number; threshold?: number; isAutoCompact: boolean })
const briefAtom = atom({ plugin: 'brief', key: 'brief' } as const, null as Brief | null)
const decisionsAtom = atom({ plugin: 'brief', key: 'decisions' } as const, [] as Decision[])

const BRIEF_TOOL = 'mcp__brief__brief'
const REPORT_TOOL = 'mcp__brief__report'

const BRIEF_RULE = `Keep the person's glance view current with ${BRIEF_TOOL}. They run many sessions, check each for a few seconds, and want you to keep going. Call it when your phase of work changes, and as your last tool call before you end any turn in which you used tools, with: status, one line of at most 80 characters on where the work stands; asks, only what truly blocks you (an outward or destructive action such as push, deploy, delete or spend; access or a credential; a choice where a wrong guess would waste most of the remaining work), each naming the exact choice with your recommended option first marked (recommended), or an empty list; decided, each new judgment call you made on their behalf so you could keep going (what you chose, the alternatives, whether it is cheap to undo). The tool answers with the numbered queue: to revise a queued decision send it again with its n; when the person agrees in chat, or it no longer applies, list it in settled (accepted or withdrawn); when they change it, settle the old one and act on the change. Do not stop for a decision you can make reasonably and undo cheaply: decide, record it in decided, and continue. Before an end-of-run report (Changed / Blocked on me / Found), call ${REPORT_TOOL}: build Changed from its facts, Blocked on me from its open asks, and list its open decisions under Blocked on me as 'Decided for you (change if wrong)'.`

async function sampleTurn($: EngineInterface): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const { tokens, percent, window, breakdown } = usage.context
  const limits =
    breakdown?.autoCompactThreshold === undefined
      ? { window, isAutoCompact: breakdown?.isAutoCompactEnabled ?? false }
      : { window, threshold: breakdown.autoCompactThreshold, isAutoCompact: breakdown.isAutoCompactEnabled }
  await update($, limitsAtom, () => limits)
  if (tokens === undefined) return
  const now = await $.clock.now()
  if (percent !== undefined) await update($, ctxAtom, prev => appendSample(prev, { percent, tokens, usd: usage.cost?.usd, at: now }))
  await update($, turnsAtom, prev => appendTurn(prev, { tokens, at: now }))
}

async function reportText($: EngineInterface): Promise<string> {
  const ledger = ledgerMarkdown(await read($, entriesAtom), await read($, ctxAtom), await read($, failsAtom), await read($, turnsAtom), await read($, limitsAtom))
  return [briefMarkdown(await read($, briefAtom), await $.clock.now(), await read($, decisionsAtom)), ledger].join('\n\n')
}

export const LEGACY_TOOLS = [
      {
        name: 'brief',
        description:
          "Set the person's glance view of this session: a one-line status, the complete list of what blocks you (replaces the previous asks; [] means nothing blocks), and any new decisions you made for them so you could keep going (queued for their review).",
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Where the work stands, at most 80 characters' },
            asks: {
              type: 'array',
              description: 'Only what blocks you (outward or destructive action, access, or a choice a wrong guess would waste most work on), most blocking first; [] when nothing',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Starts with a verb and names the exact choice or action, your recommended option first marked (recommended); at most 120 characters' },
                  kind: { type: 'string', enum: ['decision', 'approval', 'action', 'access', 'review', 'info'] },
                },
                required: ['text', 'kind'],
              },
            },
            decided: {
              type: 'array',
              description: 'New judgment calls you made for the person so you could keep going; each joins a review queue. [] when none',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'What you chose, at most 120 characters' },
                  alternatives: { type: 'string', description: 'What you did not choose' },
                  reversible: { type: 'boolean', description: 'false when it would be costly to undo' },
                  n: { type: 'number', description: 'To revise a queued decision instead of adding one: its number' },
                },
                required: ['text'],
              },
            },
            settled: {
              type: 'array',
              description: 'Queued decisions to take off the queue: accepted when the person agreed in chat, withdrawn when no longer relevant',
              items: { type: 'object', properties: { n: { type: 'number' }, as: { type: 'string', enum: ['accepted', 'withdrawn'] } }, required: ['n', 'as'] },
            },
          },
          required: ['status', 'asks'],
        },
      },
      {
        name: 'report',
        description:
          "This session's facts (PRs, commits, tags, publishes, paid calls, outward writes, files edited, failures, context use) and its open asks. Read it before writing the end-of-run Changed / Blocked on me / Found report.",
        inputSchema: { type: 'object', properties: {} },
      },
]

export async function legacyEnd($: EngineInterface): Promise<void> {
  await update($, briefAtom, () => null)
  await update($, decisionsAtom, () => [])
}

export async function legacyTurnComplete($: EngineInterface): Promise<void> {
  await sampleTurn($)
}

/** Answers the two legacy tools; undefined for every other tool. */
export async function legacyCall($: EngineInterface, e: ToolCallEnvelope): Promise<ToolCallResult | undefined> {
  if (e.tool === BRIEF_TOOL) {
    if (e.agentId !== undefined) return { result: 'Not recorded: only the main session sets the brief.' }
    const checked = validateInput(e)
    if (!checked.ok) return { isError: true, result: checked.error, text: checked.error }
    const now = await $.clock.now()
    if (checked.value.settled.length > 0 || checked.value.decided.length > 0) {
      await update($, decisionsAtom, prev => appendDecisions(settleDecisions(prev, checked.value.settled), checked.value.decided, now))
    }
    await update($, briefAtom, prev => nextBrief(prev, checked.value, 'tool', now))
    return { result: queueText(await read($, decisionsAtom)) }
  }
  if (e.tool === REPORT_TOOL) return { result: await reportText($) }
  return undefined
}

/** The facts report's ledger, from a tool call that ran. */
export async function legacyObserve($: EngineInterface, e: ToolCallEnvelope, ran: ToolCallResult): Promise<void> {
  const now = await $.clock.now()
  if (e.tool === 'Bash') {
    if (ran.isError === true) await update($, failsAtom, n => (n ?? 0) + 1)
    const found = classifyBash(String((e as { command?: unknown }).command ?? ''), ran.text ?? '', now, ran.isError === true)
    if (found.length > 0) await update($, entriesAtom, prev => appendEntries(prev, found))
  } else if (ran.isError !== true) {
    const filePath = FILE_TOOLS.has(String(e.tool)) ? (e as { file_path?: unknown }).file_path : undefined
    const found = typeof filePath === 'string' ? { kind: 'file' as const, label: filePath, at: now } : classifyMcp(String(e.tool), now)
    if (found !== undefined) await update($, entriesAtom, prev => appendEntries(prev, [found]))
  }
}

export const legacySection = (tools: readonly string[]) =>
  tools.includes(BRIEF_TOOL) ? [{ id: 'brief:legacy', text: BRIEF_RULE, scope: 'session' as const }] : []
