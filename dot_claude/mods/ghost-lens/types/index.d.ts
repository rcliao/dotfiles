/** How a memory reached the conversation. */
export type Channel = 'session-start' | 'prompt' | 'explicit'

export type Verdict = 'pending' | 'used' | 'unused'

/** One memory recalled into this session, and what became of it. */
export type Recall = {
  key: string
  ns: string
  channel: Channel
  /** First line of the memory, for the pane. */
  snippet: string
  /** The memory text as injected, cut to 800 chars, for the detail view. */
  content: string
  /** Identifier-like tokens from the memory body (paths, flags, env vars, code names). */
  tokens: string[]
  /** Retrieval score from ghost, when known (hook trace or tool result). */
  score?: number
  /** The score floor in force when it was loaded; a lower score means it entered by edge or rescue. */
  floor?: number
  /** How ghost let it in (`ghost context` via): pinned, search, rescued, edge, reserved, parent. */
  via?: string
  /** Estimated tokens it cost in context. */
  tok: number
  /** The query that pulled it in. */
  query?: string
  /** Main-loop turn index when it was injected. */
  shownTurn: number
  shownAt: number
  /** The mod's automatic judgment. */
  verdict: Verdict
  /** Turn the verdict was reached. */
  judgedTurn?: number
  /** Why it was judged used (key named, ghost_get, tokens). */
  evidence?: string
  /** The person's correction from the pane, when given. */
  corrected?: 'used' | 'unused'
  /** Paths it names under a directory that exists here but which do not exist: likely stale. */
  stale?: string[]
  /** Something to check: e.g. it was used and the next prompt was a correction. */
  risk?: string
  /** Loaded back from the log on resume: an earlier exposure, replaced if ghost injects it again. */
  prior?: boolean
}

/** One run of a ghost hook, from its trace line. */
export type TraceRow = {
  at: string
  turn: number
  hook: string
  outcome: string
  reason?: string
  query: string
  floor?: number
  injected: { key: string; score?: number; tok: number; via?: string }[]
  /** Tokens actually injected (after dedup against what the session already has). */
  tok: number
  /** What the hook allowed (sum of --budget over its calls) and what ghost reported packing. */
  budget: number
  used: number
}

/** A memory the agent wrote this session. */
export type Captured = { key: string; ns: string; turn: number; tool: string }

declare module 'claude-code' {
  interface PluginState {
    'ghost-lens': {
      recalls: Recall[]
      turn: number
      traces: TraceRow[]
      /** Lines already read, per trace file (a new session id after /clear is a new file). */
      traceSeen: Record<string, number>
      /** The session id the rest of this state belongs to. */
      session: string | null
      /** Band, status line and toasts on; off by default so ghost stays out of sight. */
      debug: boolean
      captured: Captured[]
      selected: string | null
    }
  }
}
