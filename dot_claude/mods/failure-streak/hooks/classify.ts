// Pure helpers: no `$`, so tests can call them directly.

// Failures of the same command allowed before the next identical try is refused.
export const STRIKE_LIMIT = 3

// Only commands that reach the network can be blocked by the sandbox's network policy.
// Without this gate, a failing test run that merely prints "ENOTFOUND" fixtures would get the hint.
const NETWORK_COMMAND =
  /\b(curl|wget|http|https|ssh|scp|rsync|git (fetch|pull|push|clone|ls-remote)|gh|npm|pnpm|yarn|npx|pip3?|uv|brew|doppler|render|wrangler|gcloud|bq|psql|tempo|tailscale|nc|dig|nslookup)\b/

// Symptoms of the OS sandbox's network/socket policy, not of the command itself.
const SANDBOX_PATTERNS: readonly RegExp[] = [
  /certificate verify failed/i,
  /unable to get local issuer certificate/i,
  /self[- ]signed certificate in certificate chain/i,
  /x509: certificate/i,
  /tls: failed to verify/i,
  /Could not resolve host/i,
  /getaddrinfo (ENOTFOUND|EAI_AGAIN)/i,
  /Temporary failure in name resolution/i,
  /nodename nor servname provided/i,
  /Received HTTP code 403 from proxy/i,
  /CONNECT tunnel failed/i,
  /(socket|connect|bind)\(?\)?:? .*Operation not permitted/i,
  /EPERM: operation not permitted, (connect|bind|listen)/i,
  /ssh: Could not resolve hostname/i,
]

export const isSandboxBlock = (command: string, text: string): boolean =>
  NETWORK_COMMAND.test(command) && SANDBOX_PATTERNS.some(re => re.test(text))

// Polling commands fail by design until the thing they wait on is ready; never strike them.
const POLLING = /\b(gh pr checks|gh run (view|watch)|grep -q|pg_isready|kubectl rollout status)\b/
export const isPolling = (command: string): boolean => POLLING.test(command)

// FNV-1a, so the whole command counts (no truncation collisions) without keeping long keys.
const hash = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// Same command modulo whitespace and volatile numbers (ports, pids, timestamps), per loop
// (each subagent has its own streaks), plus whether the sandbox was off: an unsandboxed
// rerun is a different attempt.
export const signatureOf = (command: string, isUnsandboxed = false, agentId?: string): string => {
  const body = command.trim().replace(/\s+/g, ' ').replace(/\d{4,}/g, 'N')
  return `${agentId ?? 'main'}|${isUnsandboxed ? 'nosandbox' : 'sandbox'}|${hash(body)}`
}

// A different error is progress, not a repeat: only identical failures count toward a strike.
export const errorDigest = (text: string): string =>
  hash(text.replace(/\d+(\.\d+)?(ms|s)?\b/g, 'N').replace(/\s+/g, ' ').slice(0, 2000))

export const shortLabel = (command: string): string => {
  const first = command.trim().split(/\s+/).slice(0, 3).join(' ')
  return first.length > 32 ? `${first.slice(0, 31)}…` : first
}

export const SANDBOX_HINT =
  'failure-streak: this error looks like a sandbox network/socket block, not a bug in the command. ' +
  'Do not debug it. If the command is safe, rerun it once with dangerouslyDisableSandbox: true; ' +
  'otherwise hand the exact command to the user to run in their pane.'

export const thirdStrikeHint = (count: number): string =>
  `failure-streak: this exact command has now failed ${count} times in a row with the same error. ` +
  'Do not run it again unchanged. Say what you tried, then propose a different approach.'

export const strikeOutReason = (count: number, command: string): string =>
  `failure-streak: refused — \`${shortLabel(command)}\` already failed ${count} times in a row with the same error and nothing was edited since. ` +
  'Stop retrying it: say what you tried and propose a different approach (a changed command, or one after an edit, will run).'
