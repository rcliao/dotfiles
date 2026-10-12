---
type: llm
focus: trace
arm: with-only
weight: 2
---

Look at every call to the tool mcp__brief__brief in the trace.
PASS if (a) the LAST call's asks list is about pushing to main (approval or access) and contains nothing about naming, slugify behaviour or changelog wording, and (b) across all calls, the decided lists contain at least one judgment call made without asking (for example the new name for cfg, how slugify handles special characters, or the changelog format), and no such judgment call appears as an ask.
FAIL otherwise.
