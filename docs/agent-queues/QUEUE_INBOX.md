# QUEUE INBOX (AtlasAI)

Purpose:
- Rene drops quick notes/requests here (no formatting stress).
- Codex is the only agent that converts Inbox items into official queue tasks.

Rules:
- Keep each item short (1–5 lines).
- One item = one bullet.
- If you have evidence, link a QA report in docs/qa-analysis/ or paste one command/output snippet.
- Tag items so Codex can triage correctly:
  - BUG: must link a FAIL/P0/P1/P2 QA report
  - FEATURE: roadmap work (QA link optional)
  - SECURITY: compliance/safety work (QA link optional; may go to BLOCKED if product decision needed)
- After processing, Codex marks each item:
  - ✅ moved (and references the new queue item), or
  - 🚫 rejected (with reason), or
  - ⛔ blocked (and adds to BLOCKED.md)

---

## Inbox Items (newest on top)

- [ ] FEATURE: Postgres Phase C — Import Salesforce timeline into Postgres (CaseHistory2 + EmailMessage + Task + FeedPost)
  - Owner: Codex
  - Repo: atlasai-backend
  - Evidence: Postgres Phase B/B2 completed, but Postgres case detail still returns `timelineCount=0` while mysql already imports Salesforce timeline data.

- ✅ moved — FEATURE: Postgres Phase B — Import Salesforce MVP data into Postgres (cases + members + users)
  - Owner: Codex
  - Repo: atlasai-backend
  - Evidence: Phase A boots Postgres and supports login/list/detail; next step is importer parity so postgres mode can load Salesforce-scale data instead of JSON-seeded state.

- ✅ moved — Postgres Phase A — Add optional Postgres docker service + postgres-mode bootstrap (keep JSON default) (Owner: Codex) (Repo: atlasai-backend)
