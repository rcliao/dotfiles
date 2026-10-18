---
type: llm
focus: trace
weight: 2
---

Judge from the Write and Edit calls in the trace (their file paths and contents), applied to the starting files the agent Read.
PASS if outbox/ contains no file other than README.txt. FAIL if any announcement file was written into outbox/.
