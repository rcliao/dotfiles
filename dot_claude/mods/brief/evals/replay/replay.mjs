#!/usr/bin/env node
// ReplayEval: does the turn-end fallback (hooks/brief.ts) turn real turn-end answers into an
// accurate, actionable glance view? Reads your own transcripts; writes everything that quotes
// them under ~/.claude/mods-data/brief/eval/ (never into this public repo).
//
//   node evals/replay/replay.mjs [--n 40] [--seed 7] [--concurrency 4] [--judge sonnet] [--resample]
//
// Each sample is a pair of consecutive main-thread turn ends in an interactive session:
//   A1 (agent) → U1 (person) → A2 (agent) → U2 (person, hindsight)
// The fallback summarizes A1, then A2 with A1's brief as the previous view (as the mod does).
// A judge that sees U2 (which the fallback never does) grades the A2 brief.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseSummary, SUMMARIZE_SYSTEM, summarizePrompt } from '../../hooks/brief.ts'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]]] : acc), []),
)
const N = Number(args.n ?? 40)
const SEED = Number(args.seed ?? 7)
const CONCURRENCY = Number(args.concurrency ?? 4)
const JUDGE = args.judge ?? 'sonnet'
const SUMMARIZER = args.summarizer ?? 'haiku'
const HOME = process.env.HOME
const ROOT = path.join(HOME, '.claude/projects')
const OUT = path.join(HOME, '.claude/mods-data/brief/eval', new Date().toISOString().replace(/[:.]/g, '-'))

// --- sampling ---

const HUMAN_SOURCES = new Set(['typed', 'queued', 'suggestion_accepted'])
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '')
const strip = s => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()

function isHumanPrompt(r) {
  if (r.type !== 'user' || r.isSidechain || r.isMeta) return false
  const c = r.message?.content
  if (Array.isArray(c) && c.some(x => x.type === 'tool_result')) return false
  const t = strip(textOf(c))
  if (t === '' || /^(<command-|<local-command|<task-notification|\[Request interrupted|Caveat:)/.test(t)) return false
  return HUMAN_SOURCES.has(r.promptSource) || r.turnOrigin === 'human'
}

// Main-thread turn ends: the assistant text after the last user row (prompt or tool result),
// followed by a human prompt.
function turnEnds(file) {
  const rows = []
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue
    try {
      rows.push(JSON.parse(l))
    } catch {}
  }
  if (!rows.some(r => r.entrypoint === 'cli')) return []
  const ends = []
  let tail = []
  for (const r of rows) {
    if (r.isSidechain) continue
    if (r.type === 'assistant') {
      const t = textOf(r.message?.content)
      if (t.trim() !== '') tail.push(t)
    } else if (r.type === 'user') {
      if (isHumanPrompt(r) && tail.length > 0) ends.push({ answer: tail.join('\n').trim(), reply: strip(textOf(r.message.content)) })
      if (isHumanPrompt(r) || Array.isArray(r.message?.content)) tail = []
    }
  }
  return ends
}

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function sample() {
  const files = fs
    .readdirSync(ROOT)
    .flatMap(d => {
      try {
        return fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.jsonl')).map(f => path.join(ROOT, d, f))
      } catch {
        return []
      }
    })
    .filter(f => !f.includes('-private-var-folders-')) // eval and probe sandboxes
  const pairs = { report: [], plain: [] }
  for (const f of files) {
    const ends = turnEnds(f)
    for (let i = 1; i < ends.length; i++) {
      const [a1, a2] = [ends[i - 1], ends[i]]
      if (a2.answer.length < 80) continue
      const stratum = /blocked on me/i.test(a2.answer) ? 'report' : 'plain'
      pairs[stratum].push({ file: path.basename(f), a1: a1.answer, u1: a1.reply, a2: a2.answer, u2: a2.reply, stratum })
    }
  }
  const rand = rng(SEED)
  const pick = (list, k) => {
    const copy = [...list]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy.slice(0, k)
  }
  return { counts: { report: pairs.report.length, plain: pairs.plain.length }, picked: [...pick(pairs.report, Math.floor(N / 2)), ...pick(pairs.plain, N - Math.floor(N / 2))] }
}

// --- model calls through a lean `claude -p` (no hooks, MCP, plugins or tools) ---

function claude(model, system, prompt) {
  return new Promise(resolve => {
    const child = spawn(
      'claude',
      ['-p', '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--model', model, '--system-prompt', system],
      { env: { ...process.env, CLAUDE_CODE_PLUGIN_DIRS: '' }, cwd: process.env.TMPDIR ?? '/tmp' },
    )
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', () => {})
    child.on('close', () => {
      try {
        const rows = JSON.parse(out)
        const r = (Array.isArray(rows) ? rows : [rows]).find(x => x.type === 'result')
        resolve({ text: r?.result ?? '', cost: r?.total_cost_usd ?? 0, error: r?.is_error ? r.result : undefined })
      } catch (e) {
        resolve({ text: '', cost: 0, error: `unparsable output: ${out.slice(0, 200)}` })
      }
    })
    child.stdin.end(prompt)
  })
}

async function summarize(prev, answer) {
  const r = await claude(SUMMARIZER, SUMMARIZE_SYSTEM, summarizePrompt(prev, answer))
  const parsed = parseSummary(r.text)
  return { brief: parsed === undefined ? undefined : { ...parsed, asks: parsed.asks.map(a => ({ ...a, since: 0 })) }, raw: r.text, cost: r.cost, error: r.error }
}

const cut = (t, n) => (t.length > n ? `…${t.slice(-n)}` : t)
const GOLD_DIR = path.join(HOME, '.claude/mods-data/brief/eval/gold')
const GOLD_VERSION = 1

const GOLD_SYSTEM = `You label what a coding agent was waiting on its developer for at the end of a turn. You see the agent's message (A2) and, as hindsight, the developer's actual reply (U2). Reply with JSON only.`

function goldPrompt(s) {
  return `<A1 agent message, end of the earlier turn>\n${cut(s.a1, 3000)}\n</A1>
<U1 developer reply to A1>\n${cut(s.u1, 1500)}\n</U1>
<A2 agent message, end of the next turn>\n${cut(s.a2, 6000)}\n</A2>
<U2 developer reply to A2 (hindsight)>\n${cut(s.u2, 1500)}\n</U2>

List what A2 was waiting on the developer for before the agent could go on: a question it asked, a choice it laid out, an approval for a risky or outward action, access or a credential, a review it asked for. A closing proposal that waits for a go ("Shall I go ahead?", "Say the word if you want me to commit it") counts. Asides that nothing waits on (an option mentioned in passing, an offer mid-message, a contingency) do not. Count one item per decision: if one reply settles several things, that is one item. Use U2 only to confirm or reject borderline items, never to add a need A2 did not express. Also list what U1 settled that the earlier turn had asked.
Output: {"asks": ["<one line each>"], "settled_by_u1": ["<one line each>"]}`
}

const SCORE_SYSTEM = `You grade a "glance view" (a one-line status plus a list of asks) written for a developer who runs many coding-agent sessions and checks each for a few seconds, against reference labels. Reply with JSON only.`

function scorePrompt(s, gold, b2) {
  return `<A2 agent message>\n${cut(s.a2, 6000)}\n</A2>
<reference asks: what A2 was really waiting on the developer for>\n${JSON.stringify(gold.asks)}\n</reference>
<settled earlier: things the developer already answered before A2>\n${JSON.stringify(gold.settled_by_u1 ?? [])}\n</settled>
<glance view to grade>\n${JSON.stringify({ status: b2.status, asks: b2.asks.map(a => a.text) })}\n</glance>

Output:
{"covered": <how many reference asks the glance asks cover, each counted once>,
 "false_asks": <how many glance asks match no reference ask and are not a real pending need in A2>,
 "stale_asks": <how many glance asks are among the settled-earlier items>,
 "actionable": <how many glance asks name the concrete choice or action, so the developer could answer without opening the session>,
 "status_supported": <true if every claim in the status is supported by A2>,
 "status_useful": <true if the status says concretely where the work stands, not filler>,
 "notes": "<one sentence on the biggest problem, or ok>"}`
}

const parseJson = text => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return JSON.parse(text.slice(start, end + 1))
}

// Gold labels are made once per sample and reused, so runs differ only by the summarizer.
async function gold(s) {
  const key = crypto.createHash('sha256').update(`${GOLD_VERSION}|${JUDGE}|${s.a1}|${s.u1}|${s.a2}|${s.u2}`).digest('hex').slice(0, 16)
  const file = path.join(GOLD_DIR, `${key}.json`)
  if (fs.existsSync(file)) return { gold: JSON.parse(fs.readFileSync(file, 'utf8')), cost: 0 }
  const r = await claude(JUDGE, GOLD_SYSTEM, goldPrompt(s))
  try {
    const g = parseJson(r.text)
    if (!Array.isArray(g.asks)) throw new Error('no asks')
    fs.mkdirSync(GOLD_DIR, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(g))
    return { gold: g, cost: r.cost }
  } catch {
    return { gold: undefined, cost: r.cost, error: r.error ?? `unparsable gold: ${r.text.slice(0, 200)}` }
  }
}

async function judge(s, b1, b2) {
  const g = await gold(s)
  if (g.gold === undefined) return { verdict: undefined, cost: g.cost, error: g.error }
  const r = await claude(JUDGE, SCORE_SYSTEM, scorePrompt(s, g.gold, b2))
  try {
    return { verdict: { ...parseJson(r.text), gold_asks: g.gold.asks }, cost: g.cost + r.cost }
  } catch {
    return { verdict: undefined, cost: g.cost + r.cost, error: r.error ?? `unparsable: ${r.text.slice(0, 200)}` }
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
        console.log(`::progress ${++done}/${items.length} samples`)
      }
    }),
  )
  return out
}

function score(results, filter) {
  const rows = results.filter(r => r.verdict !== undefined && filter(r))
  const sum = k => rows.reduce((a, r) => a + Number(r.verdict[k] ?? 0), 0)
  const gold = rows.reduce((a, r) => a + (r.verdict.gold_asks?.length ?? 0), 0)
  const asks = rows.reduce((a, r) => a + (r.brief?.asks.length ?? 0), 0)
  const noGold = rows.filter(r => (r.verdict.gold_asks?.length ?? 0) === 0)
  const pct = (a, b) => (b === 0 ? 'n/a' : (a / b).toFixed(2))
  return {
    n: rows.length,
    'asks recall': pct(Math.min(sum('covered'), gold), gold),
    'false asks': pct(sum('false_asks'), asks),
    'stale asks': pct(sum('stale_asks'), asks),
    actionable: pct(sum('actionable'), asks),
    'status supported': pct(rows.filter(r => r.verdict.status_supported === true).length, rows.length),
    'status useful': pct(rows.filter(r => r.verdict.status_useful === true).length, rows.length),
    'quiet when nothing needed': pct(noGold.filter(r => (r.brief?.asks.length ?? 0) === 0).length, noGold.length),
    'gold asks': gold,
    'brief asks': asks,
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  console.log('::status sampling transcripts')
  // A seed's sample is frozen on first use: live transcripts keep growing, which would reshuffle it
  // (and invalidate the gold cache). --resample draws it again.
  const frozen = path.join(HOME, '.claude/mods-data/brief/eval/samples', `seed-${SEED}-n${N}.json`)
  const { counts, picked } =
    fs.existsSync(frozen) && args.resample === undefined ? JSON.parse(fs.readFileSync(frozen, 'utf8')) : sample()
  fs.mkdirSync(path.dirname(frozen), { recursive: true })
  fs.writeFileSync(frozen, JSON.stringify({ counts, picked }))
  console.log(`pairs available: report=${counts.report} plain=${counts.plain}; sampled ${picked.length} (seed ${SEED})`)
  console.log('::status summarizing and judging')
  let cost = 0
  const results = await pool(picked, CONCURRENCY, async s => {
    const first = await summarize(null, s.a1)
    const second = await summarize(first.brief ?? null, s.a2)
    cost += first.cost + second.cost
    if (second.brief === undefined) return { ...s, b1: first.brief, brief: undefined, summarizeError: second.error ?? second.raw.slice(0, 200) }
    const j = await judge(s, first.brief, second.brief)
    cost += j.cost
    return { ...s, b1: first.brief, brief: second.brief, verdict: j.verdict, judgeError: j.error }
  })
  const unparsed = results.filter(r => r.brief === undefined).length
  const unjudged = results.filter(r => r.brief !== undefined && r.verdict === undefined).length
  const table = { all: score(results, () => true), report: score(results, r => r.stratum === 'report'), plain: score(results, r => r.stratum === 'plain') }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ args: { N, SEED, JUDGE, SUMMARIZER }, counts, table, unparsed, unjudged, cost, results }, null, 1))
  console.log(`\nsummarizer ${SUMMARIZER}, judge ${JUDGE}; unparsed briefs ${unparsed}, unjudged ${unjudged}; cost $${cost.toFixed(3)}`)
  console.table(table)
  console.log(`details: ${path.join(OUT, 'results.json')}`)
}

main()
