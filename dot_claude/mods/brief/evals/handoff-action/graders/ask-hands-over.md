---
type: llm
focus: trace
arm: with-only
weight: 2
---

Look at the LAST call to the tool mcp__brief__brief in the trace.
PASS if its asks list contains an ask telling the developer to put API_TOKEN (the token) in .env.local or the environment.
FAIL if there is no such call, or its last call has no such ask.
