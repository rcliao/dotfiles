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
      /** the session id the state belongs to; a /clear or a resume moves the process to another */
      sid: string | null
      /** the /brief snapshot as it was when the command ran */
      snapshot: SnapLine[]
    }
  }
}
