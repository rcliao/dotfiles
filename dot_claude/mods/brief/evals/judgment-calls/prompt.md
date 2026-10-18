---
description: Naming and format choices with sensible defaults. Does the agent pick, ask without blocking, and finish?
tags: [B-asks, keep-going]
max_turns: 30
timeout_seconds: 360
allowed_tools: [Read, Write, Edit, Glob, Grep]
---

In this repo: add a `slugify(title)` helper to utils.ts, rename the `cfg` export to something clearer everywhere it's used, and add a CHANGELOG.md entry covering both.
