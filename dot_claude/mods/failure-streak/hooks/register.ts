import type { Register } from 'claude-code'

import {
  errorDigest,
  isPolling,
  isSandboxBlock,
  SANDBOX_HINT,
  shortLabel,
  signatureOf,
  STRIKE_LIMIT,
  strikeOutReason,
  thirdStrikeHint,
} from './classify.ts'

type Streak = { count: number; label: string; digest: string }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

const statusText = (streaks: ReadonlyMap<string, Streak>): string | undefined => {
  let top: Streak | undefined
  for (const s of streaks.values()) if (top === undefined || s.count > top.count) top = s
  // A single failure is normal; only a repeat is worth a pinned line.
  return top === undefined || top.count < 2 ? undefined : `${top.label} failed ×${top.count}`
}

export const register: Register = on => {
  // Consecutive identical failures per command signature. Module-level on purpose: a reload starts clean.
  const streaks = new Map<string, Streak>()

  // A reload starts with no streaks: clear whatever the previous load pinned.
  on('session.start', ($, e, next) => {
    $.ui.status(undefined)
    return next(e)
  })

  // An edit changes what a rerun means (edit → rerun typecheck is a fix loop, not a retry loop).
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (EDIT_TOOLS.has(String(e.tool)) && ran.deny === undefined && ran.isError !== true && streaks.size > 0) {
      streaks.clear()
      $.ui.status(undefined)
    }
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (isPolling(e.command)) return next(e)
    const sig = signatureOf(e.command, e.dangerouslyDisableSandbox === true, e.agentId)
    const prior = streaks.get(sig)

    // The 4th identical try: refuse once, then forget, so a later attempt can run.
    if (prior !== undefined && prior.count >= STRIKE_LIMIT) {
      streaks.delete(sig)
      $.ui.status(statusText(streaks))
      return { deny: strikeOutReason(prior.count, e.command) }
    }

    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    if (ran.isError !== true) {
      if (streaks.delete(sig)) $.ui.status(statusText(streaks))
      return ran
    }

    // Re-read after the await: parallel identical calls must not overwrite each other's count.
    const digest = errorDigest(ran.text ?? '')
    const current = streaks.get(sig)
    const count = current !== undefined && current.digest === digest ? current.count + 1 : 1
    streaks.set(sig, { count, label: shortLabel(e.command), digest })
    $.ui.status(statusText(streaks))

    const notes: string[] = []
    if (isSandboxBlock(e.command, ran.text ?? '')) notes.push(SANDBOX_HINT)
    if (count >= STRIKE_LIMIT) notes.push(thirdStrikeHint(count))
    if (notes.length === 0) return ran

    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  })
}
