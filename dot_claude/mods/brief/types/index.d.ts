// --- the band: what the agent asks, what the hooks observe ---

/** Who raised a question: the agent through brief_ask, or the mod itself. */
export type QuestionKind = 'agent' | 'drift' | 'default'

export type Question = {
  /** `D<n>`, what the agent's rows name */
  id: string
  kind: QuestionKind
  question: string
  short: string
  /** options[0] is the default, or the safe choice when blocking */
  options: string[]
  blocking: boolean
  at: number
  status: 'open' | 'answered' | 'defaulted' | 'closed'
  /** the option the person picked (or the default that applied) */
  answer?: string
  /** drift: the main-loop turn the check ran after */
  turn?: number
  /** default: the agent question whose default applied */
  ref?: string
}

/** An answer held for the undo window before it goes to the agent. */
export type Pending = { id: string; option: string; at: number }

export type StepStatus = 'pending' | 'in_progress' | 'completed'

/** One step of the agent's own task list, from its task tool's calls. */
export type Step = { id: string; subject: string; status: StepStatus }

export type DoneItem = { text: string; met: boolean }

/** In-flight background work, from classic.Stop's background_tasks. */
export type Job = { id: string; label: string; since: number }

/** A wakeup the session has scheduled, from classic.Stop's session_crons. */
export type Cron = { id: string; schedule: string; recurring: boolean; seenAt: number }

/** The last direction check's verdict. */
export type Check = { turn: number; onTrack: boolean; unplanned: string[] }

/** What changed since the person last looked, for the /brief snapshot. */
export type Changes = { since: number; done: string[]; asks: number; answers: number; edits: number }

export type SnapTone = 'goal' | 'dim' | 'warning' | 'plain'

export type SnapLine = { text: string; tone: SnapTone }

// --- legacy: the `brief` and `report` tools (hooks/legacy.ts) ---

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
  status: 'open' | 'accepted' | 'changed' | 'withdrawn'
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
      goal: string | null
      doneWhen: DoneItem[]
      assumptions: string[]
      questions: Question[]
      /** the ask whose hotkeys are live; it stays armed until it closes */
      armed: string | null
      pending: Pending | null
      nextId: number
      steps: Step[]
      /** whether the agent has a task tool this session */
      hasTaskTool: boolean
      jobs: Job[]
      crons: Cron[]
      /** whether a main-loop turn is running */
      isWorking: boolean
      startedAt: number
      endedAt: number
      turn: number
      check: Check | null
      changes: Changes
      /** rows waiting to reach the agent, merged into one */
      outbox: string[]
      /** a row appended mid-turn that no model request has read yet */
      unread: string | null
      /** drift the person kept: never asked about again */
      kept: string[]
      /** the /brief snapshot as it was when the command ran */
      snapshot: SnapLine[]
      // legacy tools
      entries: LedgerEntry[]
      ctx: CtxSample[]
      fails: number
      turns: TurnSample[]
      limits: CtxLimits | null
      brief: Brief | null
      decisions: Decision[]
    }
  }
}
