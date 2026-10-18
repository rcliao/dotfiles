#!/usr/bin/env bash
set -euo pipefail
cat >weather.ts <<'T'
export async function fetchForecast(city: string) { throw new Error('todo') }
T
echo "# no keys here yet" >.env.local
