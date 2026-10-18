#!/usr/bin/env bash
set -euo pipefail
cat > utils.ts <<'T'
export const cfg = { retries: 3, timeoutMs: 30000 }
export function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
T
cat > client.ts <<'T'
import { cfg } from './utils'
export const opts = { ...cfg }
T
echo "# Changelog" > CHANGELOG.md
