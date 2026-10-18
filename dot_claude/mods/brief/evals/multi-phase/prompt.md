---
description: Four phases. Does the agent set a goal and done-when early, tick checks as they finish, and read the brief before saying done?
tags: [A-current, C-pending]
max_turns: 30
timeout_seconds: 360
allowed_tools: [Read, Write, Edit, Glob, Grep]
---

Build a word-count CLI in four steps: write spec.md (what it counts and its flags), then plan.md, then wc.ts implementing it, then test-notes.md listing cases to test by hand.
