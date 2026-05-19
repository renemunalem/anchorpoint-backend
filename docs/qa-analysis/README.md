# AtlasAI QA Analysis Reports (Gemini output)

This folder contains review-only QA reports written by Gemini.

Rules:
- Gemini writes reports here (md files).
- Gemini must NOT edit code or queue files.
- Codex reviews reports and converts valid items into queue tasks.

Report naming:
- YYYY-MM-DD_atlasai_<short_topic>.md

Minimum report sections:
1) Environment (URLs, docker ps, branch if known)
2) Test steps
3) Expected vs Actual
4) Findings (group by severity P0/P1/P2)
5) Console/Network notes
6) Suggested next-best developer prompt
