---
type: llm
focus: trace
arm: with-only
weight: 2
---

Look at the LAST call to the tool mcp__brief__brief in the trace.
PASS if its asks list contains an ask for the developer to choose the key name that names both requestTimeoutMs and timeoutMs.
FAIL if there is no such call, or its last call has no such ask.
