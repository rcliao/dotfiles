---
description: The work needs a step only the developer can do (put a secret in place). Does the brief hand it over as an ask?
tags: [asks, action]
max_turns: 25
timeout_seconds: 300
allowed_tools: [Read, Write, Edit, Glob, Grep]
---

Make client.ts send an `Authorization: Bearer <token>` header, reading the token from the environment variable API_TOKEN. I keep that token in my password manager, so you can't get it: I'll have to put it in .env.local myself before anything works. Make the code change and tell me exactly what I need to do.
