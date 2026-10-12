// --- facts layer: outward actions and context (was run-ledger) ---

export type LedgerKind =
  | 'pr'
  | 'merge'
  | 'commit'
  | 'push'
  | 'force-push'
  | 'tag'
  | 'publish'
  | 'deploy'
  | 'paid'
  | 'comment'
  | 'linear'
  | 'slack'
  | 'notion'
  | 'prod-secret'
  | 'file'

export type LedgerEntry = { kind: LedgerKind; label: string; at: number; detail?: string }

export type CtxSample = { percent: number; tokens: number; usd?: number; at: number }

/** Context tokens at the end of each main-loop turn, for growth per turn. */
export type TurnSample = { tokens: number; at: number }

/** The window and where auto-compaction fires, from the engine's local estimate. */
export type CtxLimits = { window: number; threshold?: number; isAutoCompact: boolean }

// --- facts layer: background jobs (was jobs) ---

export type JobKind = 'shell' | 'agent' | 'watch'

export type JobStatus = 'running' | 'completed' | 'failed' | 'killed'

export type JobProgress = { pct?: number; text: string }

export type Job = {
  id: string
  kind: JobKind
  label: string
  file?: string
  startedAt: number
  status: JobStatus
  endedAt?: number
  exitCode?: number
  progress?: JobProgress
  lastLine?: string
  /** when the log last grew, for "quiet 4m" stall hints */
  changedAt?: number
  size?: number
  /** (time, pct) points for the ETA */
  history: { at: number; pct: number }[]
}

// --- narrative layer: what the model says it is doing and needs ---

export type AskKind = 'decision' | 'approval' | 'action' | 'access' | 'review' | 'info'

export type Ask = {
  text: string
  kind: AskKind
  /** when this ask (same text) first appeared */
  since: number
}

/** A judgment call the model made for the person so it could keep going, queued for review. */
export type Decision = {
  n: number
  text: string
  alternatives?: string
  /** false: costly to undo, review soon */
  reversible: boolean
  at: number
  status: 'open' | 'accepted' | 'changed'
  change?: string
}

export type Brief = {
  status: string
  asks: Ask[]
  /** who wrote it: the model through the brief tool, or the turn-end fallback */
  source: 'tool' | 'fallback'
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    brief: {
      entries: LedgerEntry[]
      ctx: CtxSample[]
      fails: number
      turns: TurnSample[]
      limits: CtxLimits | null
      jobs: Job[]
      lastPromptAt: number
      brief: Brief | null
      decisions: Decision[]
      /** whether a main-loop turn is running, for the band's glyph */
      isWorking: boolean
    }
  }
}
