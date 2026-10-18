#!/usr/bin/env bash
set -euo pipefail
cat >math.ts <<'T'
export const add = (a: number, b: number) => a - b
export const mul = (a: number, b: number) => a * b
T
