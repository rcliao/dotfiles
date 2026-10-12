#!/usr/bin/env bash
set -euo pipefail
cat > config.json <<'J'
{ "timeout": 30000, "retries": 3, "baseUrl": "https://api.example.com" }
J
cat > client.ts <<'T'
import config from './config.json'
export async function get(path: string) {
  const ctrl = new AbortController()
  setTimeout(() => ctrl.abort(), config.timeout)
  return fetch(config.baseUrl + path, { signal: ctrl.signal })
}
T
cat > README.md <<'R'
# client
Set `timeout` in config.json (milliseconds) to change the request timeout.
R
