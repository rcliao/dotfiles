import { expect, test } from 'claude-code/testing'

import { isSandboxBlock, signatureOf } from '../hooks/classify.ts'

const LONG = 'cd /home/x/app && doppler run -- node -e "' + 'x'.repeat(400)

const fail = (text: string) => ({ isError: true as const, result: text, text })

test('classifier: sandbox symptoms vs real errors', async () => {
  expect(isSandboxBlock('curl https://x', 'curl: (6) Could not resolve host: api.github.com')).toBe(true)
  expect(isSandboxBlock('git fetch', 'SSL certificate problem: unable to get local issuer certificate')).toBe(true)
  expect(isSandboxBlock('pnpm install', 'Error: getaddrinfo ENOTFOUND registry.npmjs.org')).toBe(true)
  expect(isSandboxBlock('ls /nope', 'ls: /nope: No such file or directory')).toBe(false)
  expect(isSandboxBlock('rm /etc/hosts', 'rm: /etc/hosts: Operation not permitted')).toBe(false)
  // review #4: a failing test run that prints ENOTFOUND fixtures is not a sandbox block
  expect(isSandboxBlock('vitest run', 'FAIL types.test.ts > maps getaddrinfo ENOTFOUND to dns_error')).toBe(false)
})

test('signature ignores whitespace and volatile numbers, keeps the sandbox flag', async () => {
  expect(signatureOf('curl  localhost:38911 ')).toBe(signatureOf('curl localhost:40122'))
  expect(signatureOf('curl x', true)).not.toBe(signatureOf('curl x'))
  // review #3: commands differing after 300 chars stay distinct
  expect(signatureOf(LONG + 'A"')).not.toBe(signatureOf(LONG + 'B"'))
  // review #2: each subagent has its own streaks
  expect(signatureOf('pnpm test', false, 'agent-1')).not.toBe(signatureOf('pnpm test'))
})

test('a sandbox-looking failure gets a model-only hint', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => fail('curl: (6) Could not resolve host: example.com'))
  const ran = await $.tool.call({ tool: 'Bash', command: 'curl https://example.com' })
  expect(ran.isError).toBe(true)
  expect(ran.context?.some(c => c.includes('sandbox'))).toBe(true)
})

test('a plain failure gets no hint until the third strike', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => fail('ls: /nope: No such file or directory'))
  const first = await $.tool.call({ tool: 'Bash', command: 'ls /nope' })
  expect(first.context).toBeUndefined()
  await $.tool.call({ tool: 'Bash', command: 'ls /nope' })
  const third = await $.tool.call({ tool: 'Bash', command: 'ls /nope' })
  expect(third.context?.some(c => c.includes('failed 3 times'))).toBe(true)
})

test('the 4th identical try is refused once, then allowed again', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  let ran = 0
  on('tool.call', () => {
    ran += 1
    return fail('ls: /nope: No such file or directory')
  })
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls /nope' })
  const fourth = await $.tool.call({ tool: 'Bash', command: 'ls /nope' })
  // the kit hands a refusal back as { deny }; a session shows the model an errored result
  expect(fourth.deny).toMatch(/refused/)
  expect(ran).toBe(3)
  await $.tool.call({ tool: 'Bash', command: 'ls /nope' })
  expect(ran).toBe(4)
})

test('a changed command and a success both reset the streak', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  let isFixed = false
  on('tool.call', () => (isFixed ? { result: 'ok' } : fail('boom')))
  for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'Bash', command: 'make build' })
  isFixed = true
  await $.tool.call({ tool: 'Bash', command: 'make build' })
  isFixed = false
  for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'Bash', command: 'make build' })
  const third = await $.tool.call({ tool: 'Bash', command: 'make build' })
  // only 3 since the reset: hinted, not refused
  expect(third.text).not.toMatch(/refused/)
  expect(third.context?.some(c => c.includes('failed 3 times'))).toBe(true)
})

test('review #1: a successful edit resets streaks (fix loop, not retry loop)', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  let runs = 0
  on('tool.call', ($, e) => {
    if (e.tool !== 'Bash') return { result: 'ok' }
    runs += 1
    return fail('error TS2322: Type string is not assignable')
  })
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Bash', command: 'pnpm typecheck' })
    await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  }
  const fourth = await $.tool.call({ tool: 'Bash', command: 'pnpm typecheck' })
  expect(fourth.deny).toBeUndefined()
  expect(runs).toBe(4)
})

test('review #1: a changed error message is progress, not a repeat', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  let n = 0
  on('tool.call', () => fail(`error in step ${['alpha', 'beta', 'gamma', 'delta'][n++]}`))
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'make build' })
  const fourth = await $.tool.call({ tool: 'Bash', command: 'make build' })
  expect(fourth.deny).toBeUndefined()
})

test('review #1: polling commands are never struck', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => fail('Some checks are still pending'))
  for (let i = 0; i < 5; i++) {
    const r = await $.tool.call({ tool: 'Bash', command: 'gh pr checks 980' })
    expect(r.deny).toBeUndefined()
  }
})
