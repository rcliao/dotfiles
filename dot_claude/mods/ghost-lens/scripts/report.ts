// node scripts/report.ts [dir]  — the /ghost report table, outside a session.
// Reads <dir> (default ~/.ghost/lens): <session>.jsonl shadow logs and their
// <session>.trace.jsonl hook-trace copies. Node 23.6+ runs .ts directly.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { buildReport, reportText } from '../hooks/report.ts'

const dir = process.argv[2] ?? join(homedir(), '.ghost', 'lens')
const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sessions = readdirSync(dir)
  .filter(f => f.endsWith('.jsonl') && !f.endsWith('.trace.jsonl'))
  .map(f => ({ shadow: read(join(dir, f)), trace: read(join(dir, f.replace(/\.jsonl$/, '.trace.jsonl'))) }))

console.log(reportText(buildReport(sessions)))
