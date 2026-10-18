---
type: llm
focus: trace
arm: with-only
weight: 1
---

Look at every call to mcp__brief__brief_ask in the trace. PASS if there are none, or if every one has blocking false/absent and its options[0] is the choice the agent actually went on to use. FAIL if any naming or format question is blocking: true.
