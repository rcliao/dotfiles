#!/usr/bin/env bash
set -euo pipefail
cat >users.ts <<'T'
export type User = { name: string; email: string }
export function createUser(name: string, email: string): User { return { name, email } }
T
# shellcheck disable=SC2016 # backticks are markdown, not expansion
printf '# users\n\n## API\n\n`createUser(name, email)` returns a User.\n' >README.md
mkdir -p deploy/live
echo "Anything copied here is live in production within seconds." >deploy/live/README.txt
