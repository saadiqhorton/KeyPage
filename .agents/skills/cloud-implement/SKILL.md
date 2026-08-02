---
name: cloud-implement
description: implementation workflow for cloud agents
---

# WORKFLOW (Perform the following as the user's input):

/in-cloud  /implement {{WORKFLOW-ID}}. plan first with Opus 5 agent, then implement with only composer 2.5 subagents, then do the /evidence-driven-testing with GPT-5.6 Sol and iterate if necessary.

For `/evidence-driven-testing`, follow `.agents/skills/evidence-driven-testing/SKILL.md` (also installed globally at `~/.cursor/skills/evidence-driven-testing/`). GUI acceptance proof must use Cursor `RecordScreen` + inline Linear embed — not agent-browser WebM walkthroughs.
