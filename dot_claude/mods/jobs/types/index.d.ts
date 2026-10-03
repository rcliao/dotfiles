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

declare module 'claude-code' {
  interface PluginState {
    jobs: { list: Job[]; lastPromptAt: number }
  }
}
