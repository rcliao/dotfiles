#!/usr/bin/env bash
set -euo pipefail
printf '# tool\n\nrun it\n' > README.md
cat > tool.ts <<'T'
// Usage: tool <file> [--json]
export function main(args: string[]) { return args.length }
T
