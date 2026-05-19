# AtlasAI Multi-Agent Queue Workflow (Nexus-style)

## Scope
This workflow coordinates 3 agents (Claude Code, Codex, Gemini) across two repos:

- Frontend repo: /Users/rene/ai-dev-workspace/atlasai
- Backend repo:  /Users/rene/ai-dev-workspace/atlasai-backend

**Source of truth for queues and QA reports lives in the backend repo:**
/Users/rene/ai-dev-workspace/atlasai-backend/docs/agent-queues/
/Users/rene/ai-dev-workspace/atlasai-backend/docs/qa-analysis/

## Roles (strict boundaries)

### Claude Code (Frontend Developer)
- Works ONLY in: /Users/rene/ai-dev-workspace/atlasai
- Owns: React/UI/routes/layouts/services/client UX
- Must NOT edit backend files.
- May read backend repo files for review only.
- If backend work is needed: write recommendation in the task output; Codex decides and queues it.

### Codex (Backend Developer + Queue Authority)
- Works ONLY in: /Users/rene/ai-dev-workspace/atlasai-backend
- Owns: API/contracts/persistence/repos/OpenAPI/backend logic
- Is the ONLY agent allowed to create/update queue entries by default.
- Converts valid findings from Claude/Gemini into official queue tasks.

### Gemini (QA / Browser Tester)
- Review + testing ONLY
- Must NOT edit source code
- Must NOT edit queue files
- Writes QA reports to: docs/qa-analysis/
- Must include: severity, reproduction steps, expected vs actual, screenshots/logs if possible, suggested next best developer prompt.

## One-task-per-run rule
- Each agent picks ONLY the first unchecked task in its queue.
- Each agent completes ONLY one task per run.
- Agents do not start another task unless Rene explicitly asks.

## How tasks move
1. Gemini tests → writes QA report (md) in docs/qa-analysis/
2. Codex reviews QA report → converts valid items into queue tasks
3. Claude executes frontend tasks → reports completion
4. Codex marks DONE / moves to DONE_LOG.md and updates BLOCKED.md if needed

## Task format (required)
Every queue item must include:

- [ ] Title
- Owner: Claude | Codex | Gemini
- Repo: atlasai | atlasai-backend
- Goal / Acceptance Criteria
- Notes (dependencies, references)
- Output expectation (what the agent must write back)

## Blocking rules
If a task is blocked:
- Do not improvise a workaround that changes scope.
- Add entry to BLOCKED.md with:
  - What is blocked
  - Why
  - Dependency needed (endpoint, field, UI component, etc.)
  - Suggested smallest unblock step

## Style rules
- Keep tasks small, safe, reversible.
- Prefer contract-first and review-first.
- Prefer Docker dev flow (frontend proxy /api).
- Avoid broad refactors without explicit approval.

## Definition of Done
A task is done when:
- Acceptance criteria are met
- Minimal verification steps are provided (curl / browser steps)
- Codex has updated DONE_LOG.md
