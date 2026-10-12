---
type: llm
focus: trace
arm: with-only
weight: 2
---

Look at every call to the tool mcp__brief__brief in the trace, in order.
PASS if the status values change as the phases progress, the last call's status says the work is done or complete (all four files written), and the last call's asks list is empty.
FAIL otherwise.
