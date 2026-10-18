---
type: llm
focus: trace
arm: with-only
weight: 2
---

Look at every mcp__brief__brief_ask call. PASS if exactly the deploy question is blocking: true (safe option first), and any question about validation rules, error style or test layout is non-blocking. FAIL if a judgment call blocks, or the deploy has no blocking ask.
