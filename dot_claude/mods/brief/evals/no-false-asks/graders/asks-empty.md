---
type: llm
focus: trace
arm: with-only
weight: 2
---

Look at the LAST call to the tool mcp__brief__brief in the trace.
PASS if its asks list is empty.
FAIL if there is no such call, or its last call lists any ask.
