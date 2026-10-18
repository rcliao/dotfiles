#!/usr/bin/env node
// Is the brief a short, faithful picture of the session? Offline over sessions that `evals/ab/run.mjs` recorded
// (no new agent runs). For each round of each with-brief run, the brief is the last `brief_read` result in that
// round: the text the person would see. A reader that sees only one picture of the session answers four
// questions a person glancing at a pane would ask; a grader with the round's full record scores each answer.
// The brief is compared with two other pictures of the same moment: the last two lines of the agent's message
// (what a glance at the pane shows) and the whole message (an upper bound).
//
//   node evals/summary/run.mjs --from ~/.cache/brief-eval/ab/<stamp> [-j 6]
//
// Lean haiku reader and sonnet grader, no tools or settings. Results go to <from>/summary.json.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const FROM = opt('--from', undefined)
const JOBS = Number(opt('-j', '6'))
if (!FROM || !existsSync(FROM)) {
  console.error('usage: node evals/summary/run.mjs --from <evals/ab results dir>')
  process.exit(2)
}

const QUESTIONS = {
  goal: 'What is the agent working on?',
  done: 'What has been finished so far?',
  waiting: 'What, if anything, is waiting on you (a decision, an approval, something to provide)? Say "nothing" if nothing is.',
  status: 'Is the work finished, still in progress, or blocked on you?',
}

function claude(prompt, model) {
  const argv = ['-p', prompt, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config', '--model', model, '--max-turns', '1', '--tools', '']
  return new Promise(resolve => {
    const child = spawn('claude', argv, { cwd: FROM, env: { ...process.env, CLAUDE_CODE_PLUGIN_DIRS: '' }, stdio: ['ignore', 'pipe', 'ignore'] })
    let raw = ''
    child.stdout.on('data', d => (raw += d))
    child.on('close', () => {
      let rows = []
      try {
        rows = [].concat(JSON.parse(raw || '[]'))
      } catch {}
      const r = rows.filter(x => x?.type === 'result').pop() ?? {}
      resolve({ text: r.result ?? '', cost: r.total_cost_usd ?? 0 })
    })
  })
}

const json = text => {
  try {
    return JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '{}')
  } catch {
    return {}
  }
}

// The last brief_read result in each round, by counting the prompts the harness sent (one per round).
function briefsByRound(sessionId) {
  const base = join(homedir(), '.claude/projects')
  for (const d of readdirSync(base)) {
    const f = join(base, d, `${sessionId}.jsonl`)
    if (!existsSync(f)) continue
    const byRound = []
    const reads = new Set()
    let round = -1
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      const c = row.message?.content
      const isPrompt = row.type === 'user' && !row.isMeta && (typeof c === 'string' || (Array.isArray(c) && c.some(b => b.type === 'text') && !c.some(b => b.type === 'tool_result')))
      if (isPrompt) round++
      if (!Array.isArray(c)) continue
      for (const b of c) {
        if (b.type === 'tool_use' && b.name === 'mcp__brief__brief_read') reads.add(b.id)
        if (b.type === 'tool_result' && reads.has(b.tool_use_id)) byRound[round] = typeof b.content === 'string' ? b.content : (b.content ?? []).map(x => x.text ?? '').join('')
      }
    }
    return { byRound, prompts: round + 1 }
  }
  return { byRound: [], prompts: 0 }
}

const words = s => (s.match(/\S+/g) ?? []).length
const glance = text => text.split('\n').map(l => l.trim()).filter(Boolean).slice(-2).join('\n')
// A field the mod cut short: the goal at 80 characters, a check at 40, a line at 120.
const cutShort = brief => {
  const goal = /^goal: (.*)$/m.exec(brief)?.[1] ?? ''
  const checks = (/^done when: (.*)$/m.exec(brief)?.[1] ?? '').split(/\s{2}(?=\[)/)
  return { goal: goal.length >= 80, checks: checks.filter(c => c.replace(/^\[.\] /, '').length >= 40).length, line: brief.split('\n').some(l => l.length >= 120) }
}

async function grade(item, picture) {
  const read = await claude(
    `You are glancing at an AI coding agent's terminal pane. This is all you can see:\n\n${picture}\n\nAnswer from what you see only; say "can't tell" when it doesn't say. Reply with only a JSON object with keys goal, done, waiting, status:\n${Object.entries(QUESTIONS).map(([k, q]) => `- ${k}: ${q}`).join('\n')}`,
    'haiku',
  )
  const answers = json(read.text)
  const g = await claude(
    `A person glanced at a summary of an AI coding agent's session and answered four questions from it. Grade each answer against the full record of that moment.

FULL RECORD
Task the person gave: ${item.task}
Questions open on the person's status bar: ${item.asks || '(none)'}
The agent's whole last message:
${item.message}

ANSWERS
${Object.entries(QUESTIONS).map(([k, q]) => `- ${k} (${q}): ${JSON.stringify(answers[k] ?? '')}`).join('\n')}

Score each 1 (right and enough to act on), 0.5 (right but missing something that matters, or "can't tell" where the record has it), 0 (wrong, or would mislead the person into a wrong action). Also set misleading: true if any answer states something false that would make the person act wrongly (approve, ignore, or think it done). Reply with only JSON: {"goal":1,"done":1,"waiting":1,"status":1,"misleading":false,"why":"one sentence"}`,
    'sonnet',
  )
  const s = json(g.text)
  return { answers, scores: Object.fromEntries(Object.keys(QUESTIONS).map(k => [k, Number(s[k] ?? 0)])), misleading: s.misleading === true, why: s.why ?? '', cost: read.cost + g.cost }
}

// --- main ---

const items = []
for (const f of readdirSync(FROM).filter(f => /^s\d-with-\d+\.json$/.test(f))) {
  const rec = JSON.parse(readFileSync(join(FROM, f), 'utf8'))
  const { byRound, prompts } = briefsByRound(rec.sessionId)
  // The harness sends one prompt per round; a mismatch means a prompt it did not send (skip, not guess).
  if (prompts !== rec.log.length) {
    console.log(`::skip ${f}: ${prompts} prompts for ${rec.log.length} rounds`)
    continue
  }
  for (const entry of rec.log) {
    const brief = byRound[entry.round]
    items.push({
      run: f.replace('.json', ''),
      round: entry.round,
      task: `${rec.scenario} (scenario ${rec.key})`,
      asks: entry.asks.map(q => `${q.id}${q.blocking ? ' (blocking)' : ''}: ${q.question} [${q.options.join(' / ')}]`).join('; '),
      message: entry.text,
      brief,
    })
  }
}

const results = []
let next = 0
await Promise.all(
  Array.from({ length: JOBS }, async () => {
    while (next < items.length) {
      const it = items[next++]
      const out = { run: it.run, round: it.round, hasBrief: it.brief !== undefined }
      try {
        const pictures = { glance: glance(it.message), message: it.message }
        if (it.brief !== undefined) pictures.brief = it.brief
        for (const [name, pic] of Object.entries(pictures)) {
          out[name] = { text: pic, words: words(pic), lines: pic.split('\n').length, ...(await grade(it, pic)) }
        }
        if (it.brief !== undefined) out.cut = cutShort(it.brief)
        console.log(`::status ${it.run} r${it.round}`)
      } catch (err) {
        out.error = err.message
      }
      results.push(out)
    }
  }),
)
writeFileSync(join(FROM, 'summary.json'), JSON.stringify(results, null, 2))

// Aggregates over rounds that have a brief (the same rounds for every picture), then coverage and cuts.
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const withBrief = results.filter(r => r.hasBrief && r.brief)
console.log(`\nrounds ${results.length}; with a brief_read that round ${withBrief.length}`)
console.log('picture | words | goal | done | waiting | status | overall | misleading')
for (const name of ['brief', 'glance', 'message']) {
  const rs = withBrief.map(r => r[name]).filter(Boolean)
  const col = k => mean(rs.map(r => r.scores[k])).toFixed(2)
  const overall = mean(rs.map(r => mean(Object.values(r.scores)))).toFixed(2)
  console.log(`${name} | ${mean(rs.map(r => r.words)).toFixed(0)} | ${col('goal')} | ${col('done')} | ${col('waiting')} | ${col('status')} | ${overall} | ${rs.filter(r => r.misleading).length}/${rs.length}`)
}
const cuts = withBrief.map(r => r.cut)
console.log(`\nbrief cut short: goal ${cuts.filter(c => c.goal).length}/${cuts.length}, a check ${cuts.filter(c => c.checks > 0).length}/${cuts.length}, a line at 120 ${cuts.filter(c => c.line).length}/${cuts.length}`)
console.log(`total $${results.reduce((n, r) => n + ['brief', 'glance', 'message'].reduce((m, k) => m + (r[k]?.cost ?? 0), 0), 0).toFixed(2)}; details: ${join(FROM, 'summary.json')}`)
