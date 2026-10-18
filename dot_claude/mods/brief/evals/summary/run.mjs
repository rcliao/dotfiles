#!/usr/bin/env node
// Is the brief a short, faithful picture of the session? Offline over sessions that `evals/ab/run.mjs` recorded
// (no new agent runs). For each round of each with-brief run, a reader that sees only one picture of the session
// answers four questions a person glancing at a pane would ask; a grader with the round's full record scores each
// answer, and scores whether the picture surfaces something the person must act on or would regret missing.
//
// Pictures of the same moment (the end of a round):
//   brief    the last `brief_read` result in that round: the text the person would see
//   glance   the last two lines of the agent's message
//   message  the whole message (an upper bound)
//   recap    Claude Code's away summary: `/recap` on a fork of the session cut at the end of the round
//   ysk      Claude Code's "You should know" side agent: its own prompt, rendered from the installed binary,
//            sent to a fork of the session cut at the end of the round with no tools (what $.model.fork does)
//
//   node evals/summary/run.mjs --from ~/.cache/brief-eval/ab/<stamp> [--pictures brief,glance,message,recap,ysk] [--only s2-with-1] [-j 6]
//
// Lean haiku reader and sonnet grader, no tools or settings. A recap or ysk fork re-reads the whole session on the
// session's model (about $0.45 each on Opus). Results go to <from>/summary.json.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const FROM = opt('--from', undefined)
const JOBS = Number(opt('-j', '6'))
const PICTURES = opt('--pictures', 'brief,glance,message,recap,ysk').split(',').filter(Boolean)
const ONLY = opt('--only', '').split(',').filter(Boolean)
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

function run(argv, cwd) {
  return new Promise(resolve => {
    const child = spawn('claude', argv, { cwd, env: { ...process.env, CLAUDE_CODE_PLUGIN_DIRS: '' }, stdio: ['ignore', 'pipe', 'ignore'] })
    let raw = ''
    child.stdout.on('data', d => (raw += d))
    child.on('close', () => {
      let rows = []
      try {
        rows = [].concat(JSON.parse(raw || '[]'))
      } catch {}
      const r = rows.filter(x => x?.type === 'result').pop() ?? {}
      resolve({ text: r.result ?? '', cost: r.total_cost_usd ?? 0, sessionId: r.session_id })
    })
  })
}

const claude = (prompt, model) =>
  run(
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--model',
      model,
      '--max-turns',
      '1',
      '--tools',
      '',
    ],
    FROM,
  )

const json = text => {
  try {
    return JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '{}')
  } catch {
    return {}
  }
}

// "You should know"'s prompt as this Claude Code builds it for a first call (no topics seen or known yet). It is
// Claude Code's text, so it is read from the installed binary at run time rather than kept in this repo.
function yskPrompt() {
  const bin = process.env.CLAUDE_CODE_EXECPATH
  if (!bin || !existsSync(bin))
    throw new Error('CLAUDE_CODE_EXECPATH is not set: run from a Claude Code shell, or drop ysk from --pictures')
  const b = readFileSync(bin, 'latin1')
  const at = b.indexOf('"## Overview","","You are a helpful observer')
  const open = b.lastIndexOf('=>[', at)
  const start = b.lastIndexOf('var ', open)
  let depth = 0
  let end = open + 2
  let quote = null
  for (; end < b.length; end++) {
    const c = b[end]
    if (quote) {
      if (c === '\\') end++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === '`' || c === "'") quote = c
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) break
  }
  const pre = b.indexOf('var Be=`', start - 10_000)
  const preEnd = b.indexOf('`', pre + 8)
  if (at < 0 || pre < 0) throw new Error("this Claude Code build's You-should-know prompt was not found")
  // ft lists topics already offered or known; a first call has none.
  const ft = list => (list.length ? list.map(x => `- ${x}`).join('\n') : '(none)')
  const name = /var (\w+)=/.exec(b.slice(start, open))[1]
  const lines = new Function('ft', `${b.slice(pre, preEnd + 1)};${b.slice(start, end + 1)};return ${name}([],[])`)(ft)
  return Buffer.from(lines.join('\n'), 'latin1').toString('utf8')
}

// The session's transcript, the line each round's prompt starts at, and the last brief_read result in each round.
function session(sessionId) {
  const base = join(homedir(), '.claude/projects')
  for (const d of readdirSync(base)) {
    const f = join(base, d, `${sessionId}.jsonl`)
    if (!existsSync(f)) continue
    const lines = readFileSync(f, 'utf8').split('\n')
    const starts = []
    const briefs = []
    const reads = new Set()
    lines.forEach((line, i) => {
      let row
      try {
        row = JSON.parse(line)
      } catch {
        return
      }
      const c = row.message?.content
      const isPrompt =
        row.type === 'user' &&
        !row.isMeta &&
        (typeof c === 'string' || (Array.isArray(c) && c.some(b => b.type === 'text') && !c.some(b => b.type === 'tool_result')))
      if (isPrompt) starts.push(i)
      if (!Array.isArray(c)) return
      for (const b of c) {
        if (b.type === 'tool_use' && b.name === 'mcp__brief__brief_read') reads.add(b.id)
        if (b.type === 'tool_result' && reads.has(b.tool_use_id))
          briefs[starts.length - 1] = typeof b.content === 'string' ? b.content : (b.content ?? []).map(x => x.text ?? '').join('')
      }
    })
    return { dir: join(base, d), lines, starts, briefs }
  }
  return { lines: [], starts: [], briefs: [] }
}

// Send a prompt to a fork of the session as it stood at the end of a round: a copy of the transcript up to the next
// round's prompt, under a new id, resumed with --fork-session and no tools; the copy is removed afterwards.
// The work dir is moved aside while the fork runs: it holds the end of the whole run, and on resume Claude Code shows
// the session any file it read that has changed since, which would leak later rounds into this one. (At the real end
// of a round the files and the conversation agree, so a real recap or note sees nothing extra either.) The fork runs
// in an empty dir at the same path, so the session's project dir is the same. One run's forks go one at a time.
async function fork(s, round, cwd, sessionId, prompt) {
  const id = randomUUID()
  const copy = join(s.dir, `${id}.jsonl`)
  const end = s.starts[round + 1] ?? s.lines.length
  writeFileSync(
    copy,
    s.lines
      .slice(0, end)
      .map(l => l.replaceAll(sessionId, id))
      .join('\n') + '\n',
  )
  renameSync(cwd, `${cwd}.aside`)
  mkdirSync(cwd)
  try {
    return await run(
      [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--resume',
        id,
        '--fork-session',
        '--tools',
        '',
        '--max-turns',
        '1',
      ],
      cwd,
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    renameSync(`${cwd}.aside`, cwd)
    rmSync(copy, { force: true })
  }
}

const words = s => (s.match(/\S+/g) ?? []).length
const glance = text =>
  text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .slice(-2)
    .join('\n')
// A field the mod cut short: the goal at 80 characters, a check at 40, a line at 120.
const cutShort = brief => {
  const goal = /^goal: (.*)$/m.exec(brief)?.[1] ?? ''
  const checks = (/^done when: (.*)$/m.exec(brief)?.[1] ?? '').split(/\s{2}(?=\[)/)
  return {
    goal: goal.length >= 80,
    checks: checks.filter(c => c.replace(/^\[.\] /, '').length >= 40).length,
    line: brief.split('\n').some(l => l.length >= 120),
  }
}

async function grade(item, picture) {
  const read = await claude(
    `You are glancing at an AI coding agent's terminal pane. This is all you can see:\n\n${picture}\n\nAnswer from what you see only; say "can't tell" when it doesn't say. Reply with only a JSON object with keys goal, done, waiting, status:\n${Object.entries(
      QUESTIONS,
    )
      .map(([k, q]) => `- ${k}: ${q}`)
      .join('\n')}`,
    'haiku',
  )
  const answers = json(read.text)
  const g = await claude(
    `A person glanced at a summary of an AI coding agent's session and answered four questions from it. Grade each answer against the full record of that moment, then grade the summary itself.

FULL RECORD
Task the person gave: ${item.task}
Questions open on the person's status bar: ${item.asks || '(none)'}
The agent's whole last message:
${item.message}

SUMMARY THE PERSON SAW
${picture}

ANSWERS
${Object.entries(QUESTIONS)
  .map(([k, q]) => `- ${k} (${q}): ${JSON.stringify(answers[k] ?? '')}`)
  .join('\n')}

Score each answer 1 (right and enough to act on), 0.5 (right but missing something that matters, or "can't tell" where the record has it), 0 (wrong, or would mislead the person into a wrong action). Set misleading: true if any answer states something false that would make the person act wrongly (approve, ignore, or think it done). Score heads_up for the summary: 1 if it surfaces the thing in the record the person most needs to act on or would most regret missing (an approval, a hand-off, a risk, a departure from what they asked), 0.5 if it hints at it, 0 if it misses it; 1 if the record has nothing like that and the summary invents nothing. Reply with only JSON: {"goal":1,"done":1,"waiting":1,"status":1,"misleading":false,"heads_up":1,"why":"one sentence"}`,
    'sonnet',
  )
  const s = json(g.text)
  return {
    answers,
    scores: Object.fromEntries(Object.keys(QUESTIONS).map(k => [k, Number(s[k] ?? 0)])),
    misleading: s.misleading === true,
    headsUp: Number(s.heads_up ?? 0),
    why: s.why ?? '',
    cost: read.cost + g.cost,
  }
}

// --- main ---

const YSK = PICTURES.includes('ysk') ? yskPrompt() : undefined
const items = []
for (const f of readdirSync(FROM).filter(
  f => /^s\d-with-\d+\.json$/.test(f) && (ONLY.length === 0 || ONLY.includes(f.replace('.json', ''))),
)) {
  const rec = JSON.parse(readFileSync(join(FROM, f), 'utf8'))
  const s = session(rec.sessionId)
  // The harness sends one prompt per round; a mismatch means a prompt it did not send (skip, not guess).
  if (s.starts.length !== rec.log.length) {
    console.log(`::skip ${f}: ${s.starts.length} prompts for ${rec.log.length} rounds`)
    continue
  }
  for (const entry of rec.log) {
    items.push({
      run: f.replace('.json', ''),
      round: entry.round,
      cwd: join(FROM, f.replace('.json', '')),
      sessionId: rec.sessionId,
      s,
      task: `${rec.scenario} (scenario ${rec.key})`,
      asks: entry.asks.map(q => `${q.id}${q.blocking ? ' (blocking)' : ''}: ${q.question} [${q.options.join(' / ')}]`).join('; '),
      message: entry.text,
      brief: s.briefs[entry.round],
    })
  }
}

// A worker takes a whole run, so one run's forks never overlap (they move the same work dir aside).
const runs = [...new Set(items.map(it => it.run))].map(name => items.filter(it => it.run === name))
const results = []
let next = 0
await Promise.all(
  Array.from({ length: JOBS }, async () => {
    while (next < runs.length) {
      for (const it of runs[next++]) {
        const out = { run: it.run, round: it.round, hasBrief: it.brief !== undefined }
        try {
          const pictures = {}
          let made = 0
          if (PICTURES.includes('brief') && it.brief !== undefined) pictures.brief = it.brief
          if (PICTURES.includes('glance')) pictures.glance = glance(it.message)
          if (PICTURES.includes('message')) pictures.message = it.message
          if (PICTURES.includes('recap')) {
            const r = await fork(it.s, it.round, it.cwd, it.sessionId, '/recap')
            made += r.cost
            if (r.text) pictures.recap = r.text
          }
          if (YSK) {
            const r = await fork(it.s, it.round, it.cwd, it.sessionId, YSK)
            made += r.cost
            // "learn: none" shows nothing above the prompt; anything else shows its tag, title and explainer.
            out.yskRaw = r.text
            pictures.ysk = /^\s*learn:\s*none\b/i.test(r.text) || !r.text ? '(nothing shown)' : r.text
          }
          out.made = made
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
    }
  }),
)
writeFileSync(join(FROM, 'summary.json'), JSON.stringify(results, null, 2))

// Aggregates over rounds that have a brief (the same rounds for every picture), then coverage and cuts.
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const withBrief = results.filter(r => r.hasBrief && r.brief)
console.log(`\nrounds ${results.length}; with a brief_read that round ${withBrief.length}`)
console.log('picture | n | words | goal | done | waiting | status | overall | heads-up | misleading')
for (const name of PICTURES) {
  const rs = withBrief.map(r => r[name]).filter(Boolean)
  if (!rs.length) continue
  const col = k => mean(rs.map(r => r.scores[k])).toFixed(2)
  const overall = mean(rs.map(r => mean(Object.values(r.scores)))).toFixed(2)
  console.log(
    `${name} | ${rs.length} | ${mean(rs.map(r => r.words)).toFixed(0)} | ${col('goal')} | ${col('done')} | ${col('waiting')} | ${col('status')} | ${overall} | ${mean(rs.map(r => r.headsUp)).toFixed(2)} | ${rs.filter(r => r.misleading).length}/${rs.length}`,
  )
}
if (YSK)
  console.log(
    `\nysk showed something in ${withBrief.filter(r => r.ysk && r.ysk.text !== '(nothing shown)').length}/${withBrief.length} rounds`,
  )
const cuts = withBrief.map(r => r.cut).filter(Boolean)
console.log(
  `brief cut short: goal ${cuts.filter(c => c.goal).length}/${cuts.length}, a check ${cuts.filter(c => c.checks > 0).length}/${cuts.length}, a line at 120 ${cuts.filter(c => c.line).length}/${cuts.length}`,
)
const graded = results.reduce((n, r) => n + PICTURES.reduce((m, k) => m + (r[k]?.cost ?? 0), 0), 0)
const made = results.reduce((n, r) => n + (r.made ?? 0), 0)
console.log(
  `cost: pictures $${made.toFixed(2)}, grading $${graded.toFixed(2)}, total $${(made + graded).toFixed(2)}; errors ${results.filter(r => r.error).length}; details: ${join(FROM, 'summary.json')}`,
)
