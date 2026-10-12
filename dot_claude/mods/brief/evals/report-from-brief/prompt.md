---
description: End-of-run report with one open question. Is the report tool read, and does Blocked on me carry the question?
tags: [report]
max_turns: 25
timeout_seconds: 300
allowed_tools: [Read, Write, Edit, Glob, Grep]
---

Add a `retries` note to README.md explaining the retries value in config.json, and create CHANGELOG.md with one entry describing that change. One thing is mine to decide: whether the default of 3 retries should become 5. Don't change it, just leave that question for me. End with a short report under exactly these three headings: **Blocked on me**, **Changed**, **Found**.
