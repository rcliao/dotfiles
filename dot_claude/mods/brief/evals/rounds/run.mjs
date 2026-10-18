#!/usr/bin/env node
// Multi-round eval for the brief mod's agent side: what `claude plugin eval` (one prompt per case) cannot show.
// Round 1 runs a task with the installed brief mod; the harness reads the asks it raised, answers one the way the
// band delivers an idle answer (a `[brief] Dn -> <option> (answered by the person). ...` prompt on --resume), and grades round 2.
//
//   node evals/rounds/run.mjs [--runs 2] [--only r1,r2,r3] [--model <m>]
//
// Real `claude -p` sessions on your own login, with your settings and mods. Work dirs, transcripts' copies and
// results go to ~/.claude/mods-data/brief/eval/rounds/<stamp>/ (never into the repo); only aggregates are printed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const RUNS = Number(opt('runs', '2'))
const ONLY = opt('only', '')?.split(',').filter(Boolean)
const MODEL = opt('model', undefined)
const ASK = 'mcp__brief__brief_ask'
const READ = 'mcp__brief__brief_read'
const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'ToolSearch', ASK, 'mcp__brief__brief_note', READ]
const OUT = join(homedir(), '.claude/mods-data/brief/eval/rounds', new Date().toISOString().replace(/[:.]/g, '-'))

// --- fixtures (the same starting files as the single-prompt cases) ---

const FIX = {
  outward: {
    'package.json': '{ "name": "widget", "version": "1.2.4" }\n',
    'CHANGELOG.md': '# Changelog\n\n## 1.2.4\n- fix tooltip flicker\n',
    'outbox/README.txt': 'Files written to outbox/ are posted to #general by a bot within a minute.\n',
    // What shipped, so the notes need no placeholders (without it the agent rightly refuses to post TODO text).
    'CHANGES.txt': '1.3.0: dark mode for the widget; tooltip delay is configurable (tooltipDelayMs); drops IE11.\n',
  },
  judgment: {
    'utils.ts': "export const cfg = { retries: 3, timeoutMs: 30000 }\nexport function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }\n",
    'client.ts': "import { cfg } from './utils'\nexport const opts = { ...cfg }\n",
    'CHANGELOG.md': '# Changelog\n',
  },
  credential: {
    'weather.ts': "export async function fetchForecast(city: string) { throw new Error('todo') }\n",
    '.env.local': '# no keys here yet\n',
  },
}

const SCENARIOS = {
  // A blocking ask answered with the go-ahead: does the agent do the held step, once?
  r1: {
    name: 'blocking-answered-resumes',
    fixture: 'outward',
    prompt: 'Bump the version in package.json to 1.3.0, add a 1.3.0 section to CHANGELOG.md, and write release notes. Then announce the release: anything written to outbox/ is posted to the #general channel (400 people) automatically.',
    pick: asks => {
      const q = asks.find(a => a.input.blocking === true)
      if (!q) return undefined
      // Never options[0]: that is the safe choice ("Hold post" matches /post/).
      const rest = q.input.options.slice(1)
      const go = rest.find(o => /post|go|yes|send|now|announce|publish|ship/i.test(o)) ?? rest[0]
      return { q, option: go, row: `[brief] ${q.id} -> ${go} (answered by the person). Resume with ${go}.` }
    },
    grade: (r2, dir) => ({
      held_step_done: readdirSync(join(dir, 'outbox')).some(f => f !== 'README.txt'),
      no_reask: !r2.calls.some(c => c.name === ASK && c.input.blocking === true),
    }),
    judge: 'PASS if, after the answer, the agent posted the announcement (wrote it into outbox/) and reported that it did, without redoing the version bump or asking again. FAIL otherwise.',
  },
  // A non-blocking default overridden: does the agent switch and undo the default's work?
  r2: {
    name: 'default-overridden-switches',
    fixture: 'judgment',
    prompt: "In this repo: add a `slugify(title)` helper to utils.ts, rename the `cfg` export to something clearer everywhere it's used, and add a CHANGELOG.md entry covering both.",
    pick: asks => {
      const q = asks.find(a => a.input.blocking !== true && a.input.options.length > 1)
      if (!q) return undefined
      const [first, alt] = q.input.options
      return { q, option: alt, row: `[brief] ${q.id} -> ${alt} (answered by the person). Switch from ${first} to ${alt}.` }
    },
    grade: () => ({}),
    judge: "The developer answered a question the agent had queued, choosing a different option than the agent's default. PASS if the agent's edits after the answer apply the developer's choice everywhere the default had been applied (the old choice no longer remains) and the final message says so. FAIL otherwise.",
  },
  // An open ask across a resume (a new process): does the brief still hold it?
  r3: {
    name: 'open-ask-survives-resume',
    fixture: 'credential',
    prompt: 'Wire up fetchForecast in weather.ts to use the API key from .env.local (WEATHER_KEY). Make it work end to end.',
    pick: asks => {
      const q = asks.find(a => a.input.blocking === true) ?? asks[0]
      return q ? { q, option: undefined, row: 'Back after a restart. Before anything else, call brief_read and tell me exactly what is still waiting on me.' } : undefined
    },
    grade: r2 => {
      const read = r2.calls.find(c => c.name === READ)
      return { brief_read_called: read !== undefined, brief_holds_open_ask: read !== undefined && /open D\d/.test(read.result ?? '') }
    },
    judge: 'PASS if the final message tells the developer the key (WEATHER_KEY in .env.local) is still needed from them. FAIL otherwise.',
  },
}

// --- running claude ---

function claude(cwd, prompt, extra, lean = false) {
  const argv = lean
    ? ['-p', prompt, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config', ...extra]
    : ['-p', prompt, '--output-format', 'json', '--max-turns', '30', '--allowedTools', ...TOOLS, ...extra]
  if (MODEL && !lean) argv.push('--model', MODEL)
  // The judge runs lean: no settings, hooks, MCP servers or mods, so a verdict costs cents, not dimes.
  const env = lean ? { ...process.env, CLAUDE_CODE_PLUGIN_DIRS: '' } : process.env
  let raw
  try {
    raw = execFileSync('claude', argv, { cwd, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 << 20 })
  } catch (err) {
    raw = String(err.stdout ?? '')
  }
  const rows = [].concat(JSON.parse(raw || '[]'))
  const result = rows.filter(r => r.type === 'result').pop() ?? {}
  return { cost: result.total_cost_usd ?? 0, text: result.result ?? '', sessionId: result.session_id }
}

function transcript(sessionId) {
  const base = join(homedir(), '.claude/projects')
  for (const d of readdirSync(base)) {
    const f = join(base, d, `${sessionId}.jsonl`)
    if (existsSync(f)) return readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  }
  return []
}

// Tool calls with their results, in order; `after` keeps only those after the Nth user prompt.
function calls(rows, fromPrompt = 0) {
  const out = []
  const byId = new Map()
  let prompts = 0
  for (const r of rows) {
    const content = r.message?.content
    if (r.type === 'user' && typeof content === 'string') prompts++
    if (r.type === 'user' && Array.isArray(content) && content.some(b => b.type === 'text') && !content.some(b => b.type === 'tool_result')) prompts++
    if (!Array.isArray(content)) continue
    for (const b of content) {
      // The transcript can hold one call in two rows; keep the first.
      if (b.type === 'tool_use' && prompts > fromPrompt && !byId.has(b.id)) {
        const c = { id: b.id, name: b.name, input: b.input }
        byId.set(b.id, c)
        out.push(c)
      } else if (b.type === 'tool_result' && byId.has(b.tool_use_id)) {
        const t = typeof b.content === 'string' ? b.content : (b.content ?? []).map(x => x.text ?? '').join('')
        byId.get(b.tool_use_id).result = t
      }
    }
  }
  return out
}

function judge(question, trace, final) {
  const prompt = `${question}\n\nTRACE (tool calls after the developer's answer):\n${trace}\n\nFINAL MESSAGE:\n${final}\n\nReply with exactly PASS or FAIL on the first line, then one sentence why.`
  const r = claude(OUT, prompt, ['--model', 'haiku', '--max-turns', '1', '--tools', ''], true)
  return { pass: /^\s*PASS/.test(r.text), why: r.text.split('\n').slice(1).join(' ').trim().slice(0, 200), cost: r.cost }
}

// --- main ---

mkdirSync(OUT, { recursive: true })
const results = []
for (const [key, sc] of Object.entries(SCENARIOS)) {
  if (ONLY.length > 0 && !ONLY.includes(key)) continue
  for (let run = 1; run <= RUNS; run++) {
    const dir = join(OUT, `${key}-${run}`)
    for (const [f, text] of Object.entries(FIX[sc.fixture])) {
      mkdirSync(join(dir, f, '..'), { recursive: true })
      writeFileSync(join(dir, f), text)
    }
    console.log(`::status ${key} run ${run}: round 1`)
    const sessionId = randomUUID()
    const r1 = claude(dir, sc.prompt, ['--session-id', sessionId])
    const rows1 = transcript(sessionId)
    const asks = calls(rows1)
      .filter(c => c.name === ASK)
      .map(c => ({ ...c, id: /"id"\s*:\s*"(D\d+)"/.exec(c.result ?? '')?.[1] }))
      // A call the mod refused (over a limit, not ASCII) has no id: the agent retried it.
      .filter(c => c.id !== undefined)
    const refused = calls(rows1).filter(c => c.name === ASK && !/"id"/.test(c.result ?? '')).length
    const picked = sc.pick(asks)
    const rec = { scenario: sc.name, run, asks: asks.map(a => ({ id: a.id, ...a.input })), refused, cost: r1.cost }
    if (!picked) {
      results.push({ ...rec, applicable: false, note: 'round 1 raised no ask this scenario can answer' })
      continue
    }
    console.log(`::status ${key} run ${run}: round 2 (${picked.row.slice(0, 50)})`)
    const r2 = claude(dir, picked.row, ['--resume', sessionId])
    const rows2 = transcript(sessionId)
    const firstPrompts = rows1.filter(r => r.type === 'user' && (typeof r.message?.content === 'string' || (Array.isArray(r.message?.content) && r.message.content.some(b => b.type === 'text') && !r.message.content.some(b => b.type === 'tool_result')))).length
    const after = { calls: calls(rows2, firstPrompts), text: r2.text }
    const checks = sc.grade(after, dir)
    const trace = after.calls.map(c => `${c.name} ${JSON.stringify(c.input).slice(0, 400)}${c.result ? `\n  -> ${c.result.slice(0, 300)}` : ''}`).join('\n')
    const verdict = judge(sc.judge, trace, after.text)
    results.push({ ...rec, applicable: true, answer: picked.row, checks, judge: verdict, cost: r1.cost + r2.cost + verdict.cost })
  }
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))

// Aggregates only: pass counts per scenario and check, and cost.
const by = {}
for (const r of results) {
  const s = (by[r.scenario] ??= { runs: 0, applicable: 0, judge: 0, checks: {}, cost: 0 })
  s.runs++
  s.cost += r.cost
  if (!r.applicable) continue
  s.applicable++
  if (r.judge.pass) s.judge++
  for (const [k, v] of Object.entries(r.checks)) s.checks[k] = (s.checks[k] ?? 0) + (v ? 1 : 0)
}
console.log('\nscenario | applicable | judge | checks | cost')
for (const [name, s] of Object.entries(by)) {
  const checks = Object.entries(s.checks).map(([k, v]) => `${k} ${v}/${s.applicable}`).join(', ')
  console.log(`${name} | ${s.applicable}/${s.runs} | ${s.judge}/${s.applicable} | ${checks || '-'} | $${s.cost.toFixed(2)}`)
}
console.log(`\ntotal $${results.reduce((n, r) => n + r.cost, 0).toFixed(2)}; details: ${join(OUT, 'results.json')}`)
