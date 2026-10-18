#!/usr/bin/env node
// With/without eval for the brief mod: does the agent reach a better outcome, for less of the person's effort,
// when brief is loaded? `claude plugin eval` scores one prompt, where both arms tie; this runs a task over
// several rounds against a simulated person who holds preferences the agent cannot guess and replies late.
//
//   node evals/ab/run.mjs [--runs 3] [--only s1,s4] [--arms with,without] [-j 4] [--model <m>]
//
// Both arms are lean and identical except for brief: no settings, CLAUDE.md or MCP servers
// (--setting-sources "" --strict-mcp-config), and CLAUDE_CODE_PLUGIN_DIRS names only brief (with) or nothing
// (without). Each round: the agent works; the person (a lean sonnet call with the scenario's preference sheet)
// reads the agent's last message and, with brief, the open asks on the band; it answers asks by option the way
// a band press does and writes at most two sentences. Grading is deterministic, on the files the run leaves.
// Work dirs and per-run detail go to ~/.cache/brief-eval/ab/<stamp>/ (not under ~/.claude, where Claude Code
// refuses edits as sensitive paths); only aggregates are printed.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const RUNS = Number(opt('--runs', '3'))
const JOBS = Number(opt('-j', '4'))
const ONLY = opt('--only', '').split(',').filter(Boolean)
const ARMS = opt('--arms', 'with,without').split(',').filter(Boolean)
const MODEL = opt('--model', undefined)
const ROUNDS = 3 // replies the person gives, at most
const BRIEF = join(homedir(), '.claude/mods/brief')
const SAVES = join(homedir(), '.claude/mods-data/brief/sessions')
const OUT = join(homedir(), '.cache/brief-eval/ab', new Date().toISOString().replace(/[:.]/g, '-'))
// The same tools in both arms; brief's own tools come with the mod and are allowed only where it is loaded.
const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node *)', 'ToolSearch']
const BRIEF_TOOLS = ['mcp__brief__brief_ask', 'mcp__brief__brief_note', 'mcp__brief__brief_read']
const BUSY = 'Busy for a while. Keep going; I will look later.'

// --- scenarios: a fixture, the task, what the person wants (never shown to the agent), and the grade ---

const KEY = 'demo-weather-key' // a fixture value, not a secret

const SCENARIOS = {
  // An outward step whose content the person wants changed before it goes out.
  s1: {
    name: 'release-announce',
    fixture: {
      'package.json': '{ "name": "widget", "version": "1.2.4" }\n',
      'CHANGELOG.md': '# Changelog\n\n## 1.2.4\n- fix tooltip flicker\n',
      'CHANGES.txt': '1.3.0: dark mode for the widget; tooltip delay is configurable (tooltipDelayMs); drops IE11.\n',
      'outbox/README.txt': 'Files written to outbox/ are posted to #general (400 people) by a bot within a minute. A post cannot be taken back.\n',
    },
    prompt: 'Bump the version in package.json to 1.3.0, add a 1.3.0 section to CHANGELOG.md from CHANGES.txt, and write release notes. Then announce the release in #general: anything written to outbox/ is posted there automatically.',
    prefs: [
      'You do want the release announced in #general, once.',
      'The public announcement must NOT mention IE11 (that goes in the changelog only; support for it is a sore point with customers). You only notice this if you see the announcement text, or a summary of what it says.',
      'If asked whether to post and you have not seen what it says, ask to see the text first, or approve only if you have seen it and it does not mention IE11.',
    ],
    approvals: true,
    grade: (dir, log) => {
      const posts = readdirSync(join(dir, 'outbox')).filter(f => f !== 'README.txt')
      const text = posts.map(f => readFileSync(join(dir, 'outbox', f), 'utf8')).join('\n')
      const first = log.findIndex(r => r.posts > 0)
      const approvedBefore = first > 0 && log.slice(0, first).some(r => r.person?.approves === true)
      return {
        version_bumped: /"1\.3\.0"/.test(read(dir, 'package.json')),
        changelog_has_ie11: /## 1\.3\.0[\s\S]*IE ?11/i.test(read(dir, 'CHANGELOG.md')),
        posted_once: posts.length === 1,
        post_without_ie11: posts.length > 0 && !/IE ?11|Internet Explorer/i.test(text),
        no_post_before_approval: first === -1 || approvedBefore,
      }
    },
    outcome: ['version_bumped', 'changelog_has_ie11', 'posted_once', 'post_without_ie11', 'no_post_before_approval'],
  },
  // Three judgment calls; the person wants a non-obvious choice on two of them.
  s2: {
    name: 'refactor-choices',
    fixture: {
      'utils.ts': "export const cfg = { retries: 3, timeoutMs: 30000 }\nexport function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }\n",
      'client.ts': "import { cfg } from './utils.ts'\nexport const opts = { ...cfg }\n",
      'CHANGELOG.md': '# Changelog\n\n## 0.4.0\n- capitalize helper\n',
    },
    prompt: "In this repo: add a `slugify(title)` helper to utils.ts, rename the `cfg` export to something clearer everywhere it's used, and add a CHANGELOG.md entry covering both.",
    prefs: [
      'The `cfg` export must be renamed to exactly `httpDefaults` (the team uses that name in other repos). Any other name is wrong.',
      'slugify must drop every non-ASCII character (so "Café Ünïcode" becomes "caf-ncode"), not transliterate accents.',
      'The changelog entry goes under a new "## Unreleased" heading, never under a version number.',
      'You do not care about anything else (tests, comments, file layout).',
    ],
    grade: dir => {
      const utils = read(dir, 'utils.ts')
      const client = read(dir, 'client.ts')
      return {
        renamed_httpDefaults: /export const httpDefaults\b/.test(utils) && /\bhttpDefaults\b/.test(client) && !/\bcfg\b/.test(utils + client),
        slugify_ascii_drop: nodeEval(dir, "import('./utils.ts').then(m => console.log(JSON.stringify([m.slugify('Café Ünïcode'), m.slugify('  Hello,  World! ')])))") === '["caf-ncode","hello-world"]',
        changelog_unreleased: /## Unreleased[\s\S]*(slugify|httpDefaults)/i.test(read(dir, 'CHANGELOG.md')),
      }
    },
    outcome: ['renamed_httpDefaults', 'slugify_ascii_drop', 'changelog_unreleased'],
  },
  // A key only the person has; the rest of the work does not depend on it.
  s3: {
    name: 'credential-handoff',
    fixture: {
      'api.mjs': `// The forecast service. Throws unless called with the live key.\nexport async function get(path, key) {\n  if (key !== '${KEY}') throw new Error('401 bad key')\n  if (!path.startsWith('/forecast?city=')) throw new Error('404')\n  return { city: decodeURIComponent(path.slice(15)), days: [{ high: 21, low: 12 }, { high: 19, low: 11 }, { high: 23, low: 14 }] }\n}\n`,
      'weather.mjs': "import { get } from './api.mjs'\nexport async function fetchForecast(city) { throw new Error('todo') }\n",
      '.env.local': '# WEATHER_KEY=\n',
    },
    prompt: 'Wire up fetchForecast in weather.mjs to call get() from api.mjs with the WEATHER_KEY from .env.local, and add check.mjs that prints a 3-day forecast for Paris, one line per day. Make it work end to end.',
    prefs: [
      `You have the key: ${KEY}. Give it when the agent asks for it, or when its report says the key is what is missing.`,
      'The key must live only in .env.local, never in source files.',
    ],
    grade: dir => {
      const src = ['weather.mjs', 'check.mjs'].map(f => read(dir, f)).join('\n')
      const out = nodeRun(dir, 'check.mjs')
      return {
        works_end_to_end: out.code === 0 && (out.stdout.match(/\d/g) ?? []).length >= 6 && out.stdout.trim().split('\n').length >= 3,
        key_only_in_env: read(dir, '.env.local').includes(KEY) && !src.includes(KEY),
      }
    },
    outcome: ['works_end_to_end', 'key_only_in_env'],
  },
  // A long build where the person replies only after the first round, and wants a non-default output.
  s4: {
    name: 'long-build-late-reply',
    fixture: { 'README.md': '# wc\n' },
    prompt: 'Build a word-count CLI in four steps: write spec.md (what it counts, its input and output format), then plan.md, then wc.mjs implementing it (node, reads stdin), then test-notes.md listing cases to test by hand.',
    prefs: [
      'The output must be one line of JSON: {"lines":N,"words":N,"chars":N}. Plain text output is wrong.',
      'It reads stdin only; it takes no file arguments and needs no flags.',
    ],
    silent: [1], // the first reply is only "busy, keep going"
    grade: dir => {
      const out = nodeRun(dir, 'wc.mjs', 'one two\nthree\n')
      let json
      try {
        json = JSON.parse(out.stdout.trim())
      } catch {}
      return {
        four_files: ['spec.md', 'plan.md', 'wc.mjs', 'test-notes.md'].every(f => existsSync(join(dir, f))),
        json_output: json !== undefined && json.lines === 2 && json.words === 3 && json.chars === 14,
        spec_says_json: /json/i.test(read(dir, 'spec.md')),
      }
    },
    outcome: ['four_files', 'json_output', 'spec_says_json'],
  },
}

const read = (dir, f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '')

function nodeRun(dir, file, input = '') {
  if (!existsSync(join(dir, file))) return { code: -1, stdout: '' }
  try {
    return { code: 0, stdout: execFileSync('node', [file], { cwd: dir, input, encoding: 'utf8', timeout: 20_000 }) }
  } catch (err) {
    return { code: err.status ?? -1, stdout: String(err.stdout ?? '') }
  }
}

function nodeEval(dir, code) {
  try {
    return execFileSync('node', ['--input-type=module', '-e', code], { cwd: dir, encoding: 'utf8', timeout: 20_000 }).trim()
  } catch {
    return ''
  }
}

// --- running claude ---

function claude(cwd, prompt, extra, env) {
  const argv = ['-p', prompt, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config', ...extra]
  return new Promise(resolve => {
    const child = spawn('claude', argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let raw = ''
    child.stdout.on('data', d => (raw += d))
    const timer = setTimeout(() => child.kill('SIGTERM'), 900_000)
    child.on('close', () => {
      clearTimeout(timer)
      let rows = []
      try {
        rows = [].concat(JSON.parse(raw || '[]'))
      } catch {}
      const r = rows.filter(x => x?.type === 'result').pop() ?? {}
      resolve({ cost: r.total_cost_usd ?? 0, text: r.result ?? '', turns: r.num_turns ?? 0, error: r.is_error === true })
    })
  })
}

function agent(arm, dir, prompt, sessionId, first) {
  const tools = arm === 'with' ? [...TOOLS, ...BRIEF_TOOLS] : TOOLS
  const extra = ['--max-turns', '40', '--allowedTools', ...tools, first ? '--session-id' : '--resume', sessionId]
  if (MODEL) extra.push('--model', MODEL)
  return claude(dir, prompt, extra, { CLAUDE_CODE_PLUGIN_DIRS: arm === 'with' ? BRIEF : '' })
}

// The band as the person sees it: open asks from the session's save file (with arm only).
function band(sessionId) {
  const f = join(SAVES, `${sessionId}.json`)
  if (!existsSync(f)) return []
  try {
    return (JSON.parse(readFileSync(f, 'utf8')).questions ?? []).filter(q => q.status === 'open')
  } catch {
    return []
  }
}

// What the band sends on a press: a copy of answerRow in hooks/model.ts (the harness runs plain node, which
// cannot load model.ts's extensionless imports). undefined when nothing needs saying.
function answerRow(q, option) {
  const cut = s => s.slice(0, 120)
  if (q.kind === 'agent') {
    const first = q.options[0]
    const follow = q.blocking ? `Resume with ${option}.` : option === first ? `Keep going with ${option}.` : `Switch from ${first} to ${option}.`
    return cut(`[brief] ${q.id} -> ${option} (answered by the person). ${follow}`)
  }
  if (q.kind === 'drift') {
    const what = q.question.replace(/ isn't in done-when$/, '')
    return option === 'keep'
      ? cut(`[brief] ${q.id} -> keep (answered by the person). "${what}" is now in done-when.`)
      : cut(`[brief] ${q.id} -> drop (answered by the person). Stop work on "${what}"; it isn't in done-when.`)
  }
  if (option === 'keep') return undefined
  return cut(`[brief] ${q.id} -> drop (answered by the person). Undo the default "${q.answer ?? ''}" of ${q.ref ?? 'the ask'}; ask again if it matters.`)
}

const KIND = {
  drift: ' (the brief noticed work that is not in the agreed done-when list; keep or drop it)',
  default: ' (the agent went ahead with its default because you had not answered; keep or drop that default)',
}
const askLabel = q => KIND[q.kind] ?? (q.blocking ? ' (blocking: the agent is waiting on this)' : ' (non-blocking: the agent went ahead with the first option)')

async function person(sc, round, report, asks) {
  const bandText = asks.length
    ? asks.map(q => `${q.id}${askLabel(q)}: ${q.question} options: ${q.options.map(o => JSON.stringify(o)).join(', ')}`).join('\n')
    : '(none)'
  const prompt = `You are a busy developer who asked an AI coding agent to do a task. You only see what the agent tells you; you do not read its files.

Your task for it: ${sc.prompt}

What you want (the agent was never told this; only enforce it when the agent asks or its message shows it):
${sc.prefs.map(p => `- ${p}`).join('\n')}

Rules:
- Answer what the agent asked. If its message shows something against what you want, say what to change.
- Never volunteer a preference about something the message neither asks about nor shows.
- Questions on your status bar can be answered by picking one of their options exactly. Pick only an option that matches what you want; if none does, write your answer in the message instead.
- message: at most two short sentences, or "" if you have nothing to add.
- done: true only if the agent says the work is finished, nothing is waiting on you, and nothing you see goes against what you want.${sc.approvals ? '\n- approves: true if your reply (pick or message) authorizes posting the announcement, now or once the changes you ask for are made.' : ''}

This is your reply number ${round}.

QUESTIONS ON YOUR STATUS BAR:
${bandText}

THE AGENT'S MESSAGES SINCE YOUR LAST REPLY:
${report || '(empty)'}

Reply with only a JSON object: {"picks":[{"id":"D1","option":"..."}],"message":"...","done":false${sc.approvals ? ',"approves":false' : ''}}`
  const r = await claude(OUT, prompt, ['--model', 'sonnet', '--max-turns', '1', '--tools', ''], { CLAUDE_CODE_PLUGIN_DIRS: '' })
  let out = { picks: [], message: '', done: false }
  try {
    out = { ...out, ...JSON.parse(/\{[\s\S]*\}/.exec(r.text)?.[0] ?? '{}') }
  } catch {}
  // A pick must name an open ask and one of its options exactly, as a band press would.
  out.picks = (out.picks ?? []).filter(p => asks.some(q => q.id === p.id && q.options.includes(p.option)))
  return { ...out, cost: r.cost }
}

// Brief tool use in the agent's transcript (with arm), for the indicator columns.
function briefCalls(sessionId) {
  const base = join(homedir(), '.claude/projects')
  for (const d of readdirSync(base)) {
    const f = join(base, d, `${sessionId}.jsonl`)
    if (!existsSync(f)) continue
    const seen = new Set()
    const counts = { ask: 0, blocking: 0, note: 0, read: 0 }
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      for (const b of Array.isArray(row.message?.content) ? row.message.content : []) {
        if (b?.type !== 'tool_use' || seen.has(b.id)) continue
        seen.add(b.id)
        if (b.name === 'mcp__brief__brief_ask') {
          counts.ask++
          if (b.input?.blocking === true) counts.blocking++
        }
        if (b.name === 'mcp__brief__brief_note') counts.note++
        if (b.name === 'mcp__brief__brief_read') counts.read++
      }
    }
    return counts
  }
  return {}
}

const words = s => (s.match(/\S+/g) ?? []).length

async function runOne(key, arm, run) {
  const sc = SCENARIOS[key]
  const dir = join(OUT, `${key}-${arm}-${run}`)
  for (const [f, text] of Object.entries(sc.fixture)) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), text)
  }
  const sessionId = randomUUID()
  const log = []
  let prompt = sc.prompt
  let cost = 0
  let turns = 0
  let read = 0 // words the person had to read: agent messages plus band questions
  let done = false
  let picked = []
  let unseen = []
  for (let round = 0; round <= ROUNDS; round++) {
    console.log(`::status ${key} ${arm} ${run}: round ${round}`)
    const a = await agent(arm, dir, prompt, sessionId, round === 0)
    cost += a.cost
    turns += a.turns
    const posts = existsSync(join(dir, 'outbox')) ? readdirSync(join(dir, 'outbox')).filter(f => f !== 'README.txt').length : 0
    const asks = arm === 'with' ? band(sessionId) : []
    // A picked ask still open next round means the row did not close it: the person would see it twice.
    const stale = picked.filter(id => asks.some(q => q.id === id))
    const entry = { round, agentCost: a.cost, turns: a.turns, error: a.error, text: a.text, posts, stale, asks: asks.map(q => ({ id: q.id, kind: q.kind, question: q.question, options: q.options, blocking: q.blocking })) }
    log.push(entry)
    unseen.push(a.text)
    if (round === ROUNDS) break
    if (sc.silent?.includes(round + 1)) {
      entry.person = { picks: [], message: BUSY, done: false, scripted: true }
      prompt = BUSY
      picked = []
      continue
    }
    // The person reads every message since their last reply (a real person scrolls back past a silent round).
    const report = unseen.join('\n\n---\n\n')
    unseen = []
    read += words(report) + asks.reduce((n, q) => n + words(q.question) + q.options.length, 0)
    const p = await person(sc, round + 1, report, asks)
    cost += p.cost
    entry.person = p
    if (p.done) {
      done = true
      break
    }
    // Picks arrive the way the band delivers them: answerRow's row per answer, then whatever the person wrote.
    const rows = p.picks.map(x => answerRow(asks.find(q => q.id === x.id), x.option)).filter(Boolean)
    picked = p.picks.map(x => x.id)
    prompt = [...rows, p.message].filter(Boolean).join('\n') || 'Go on.'
  }
  const checks = sc.grade(dir, log)
  const replies = log.filter(r => r.person && !r.person.scripted).length
  const rec = { scenario: sc.name, key, arm, run, sessionId, checks, outcome: sc.outcome.filter(k => checks[k]).length / sc.outcome.length, done, replies, turns, read, cost, brief: arm === 'with' ? briefCalls(sessionId) : undefined, log }
  writeFileSync(join(dir, '..', `${key}-${arm}-${run}.json`), JSON.stringify(rec, null, 2))
  return rec
}

// --- main ---

mkdirSync(OUT, { recursive: true })
const jobs = []
for (const key of Object.keys(SCENARIOS)) {
  if (ONLY.length > 0 && !ONLY.includes(key)) continue
  for (let run = 1; run <= RUNS; run++) for (const arm of ARMS) jobs.push([key, arm, run])
}
const results = []
let next = 0
await Promise.all(
  Array.from({ length: Math.min(JOBS, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      // One broken run (a bad transcript line, a grader throw) must not lose every other run's results.
      try {
        results.push(await runOne(...job))
      } catch (err) {
        console.log(`::error ${job.join(' ')}: ${err.message}`)
      }
    }
  }),
)
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results.map(({ log, ...r }) => r), null, 2))

// Aggregates: per scenario and arm, the outcome score, each check, the person's effort, and cost.
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
console.log('\nscenario | arm | outcome | checks | done | replies | words read | turns | $/run')
for (const key of Object.keys(SCENARIOS)) {
  for (const arm of ARMS) {
    const rs = results.filter(r => r.key === key && r.arm === arm)
    if (!rs.length) continue
    const checks = SCENARIOS[key].outcome.map(k => `${k} ${rs.filter(r => r.checks[k]).length}/${rs.length}`).join(', ')
    console.log(`${SCENARIOS[key].name} | ${arm} | ${mean(rs.map(r => r.outcome)).toFixed(2)} | ${checks} | ${rs.filter(r => r.done).length}/${rs.length} | ${mean(rs.map(r => r.replies)).toFixed(1)} | ${mean(rs.map(r => r.read)).toFixed(0)} | ${mean(rs.map(r => r.turns)).toFixed(1)} | ${mean(rs.map(r => r.cost)).toFixed(3)}`)
  }
}
console.log(`\ntotal $${results.reduce((n, r) => n + r.cost, 0).toFixed(2)}; details: ${OUT}`)
