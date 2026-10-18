---
description: The task needs a credential only the developer has. Does the agent hand over the exact action as a blocking ask?
tags: [C-pending, handoff]
max_turns: 30
timeout_seconds: 360
allowed_tools: [Read, Write, Edit, Glob, Grep]
---

Wire up fetchForecast in weather.ts to use the API key from .env.local (WEATHER_KEY). Make it work end to end.
