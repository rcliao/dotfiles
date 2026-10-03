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

declare module 'claude-code' {
  interface PluginState {
    'run-ledger': { entries: LedgerEntry[]; ctx: CtxSample[]; fails: number; turns: TurnSample[]; limits: CtxLimits | null }
  }
}
