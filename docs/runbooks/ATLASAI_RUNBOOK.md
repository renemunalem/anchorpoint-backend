# AtlasAI Runbook (Agents + Docker + Git) — single source of truth

This runbook exists to stop “going in circles” (agents undoing each other’s work, mismatched goals, broken Docker/proxy, lost routes, etc.).

**Audience:** You (human), Claude Code (frontend), Codex (backend), Gemini (QA-only).  
**Scope:** `atlasai` frontend repo + `atlasai-backend` backend repo. **Do not touch Nexus.**

---

## 0) Golden rules (read this first)

1) **One repo per agent**
- **Claude Code = Frontend only**
  - Directory: `/Users/rene/ai-dev-workspace/atlasai`
- **Codex = Backend only**
  - Directory: `/Users/rene/ai-dev-workspace/atlasai-backend`
- **Gemini = QA only**
  - May run read-only checks, curl, Playwright smoke scripts, screenshots.
  - **Must not edit files, commit, or push.**

2) **Do not touch Nexus**
- Nexus runs at `http://localhost:3002/signin` and has its own Docker compose.
- AtlasAI must not modify Nexus folders, images, containers, or ports.

3) **Mock is reference only**
- The approved reference HTML lives here (and only here):  
  `atlasai/docs/atlasai_shell_v1.html`
- We use it as a **UI/UX reference** to **extend** the React app.
- Rule: **Extend, don’t replace** existing working React components.

4) **Docker-first for AtlasAI dev**
- Use Docker Compose from **frontend repo root** (`atlasai/`) unless explicitly instructed otherwise.
- Ports:
  - Frontend: `http://localhost:3003`
  - Backend: `http://127.0.0.1:8082`
- Frontend should call backend through Vite proxy: **browser → `/api/...`**

5) **Backend storage**
- **Current dev driver: PostgreSQL** (`REPO_DRIVER=postgres`, default).
- JSON remains available only as a lightweight fallback/bootstrap path with `REPO_DRIVER=json`.
- MySQL may remain temporarily if already present, but do not make it the default validation target.

---

## 1) What “Worklist” means

**Worklist = Cases list view** in the React app.  
Think “queue of cases an agent works on.” The mock calls it “Cases list / worklist.”

Key routes (frontend):
- `/worklist` — cases queue (Worklist)
- `/cases/:id` — Case Detail
- `/members` — members list
- `/members/profile/:id` — member “console” (profile view)

---

## 2) What “Member Console” means

**Member Console = Member Profile page** that consolidates member context, PHI gating/masking, and member-related activity.  
In the mock it’s rendered by `renderMemberConsole(id)`; in React it’s the page under `/members/profile/:id`.

---

## 3) Directory map (so no one edits the wrong repo)

### Frontend (React UI)
- Path: `/Users/rene/ai-dev-workspace/atlasai`
- Runs on: `http://localhost:3003`
- Proxy path: `http://localhost:3003/api/...` → backend inside Docker

### Backend (API server)
- Path: `/Users/rene/ai-dev-workspace/atlasai-backend`
- Runs on: `http://127.0.0.1:8082`
- Auth is cookie-session (login sets `atlasai_session`)

---

## 4) Docker Compose: how AtlasAI should be run

Run **from the frontend repo root** (`atlasai/`):

```bash
cd /Users/rene/ai-dev-workspace/atlasai

# start/rebuild
docker compose up -d --build

# stop
docker compose down

# logs
docker compose logs -f --tail=100 atlasai-frontend
docker compose logs -f --tail=100 atlasai-backend
```

Expected containers (names may include the compose prefix):
- `atlasai-atlasai-frontend-1` on `3003`
- `atlasai-atlasai-backend-1` on `8082`

---

## 5) Standard “Sanity Check” commands (run before any work)

Run these in **your Mac terminal** (not inside an agent).

### 5.1 Confirm containers are running
```bash
docker ps --format "table {{.Names}}	{{.Ports}}"
```

### 5.2 Confirm frontend serves HTML
```bash
curl -I http://localhost:3003/ | head -n 20
```

### 5.3 Confirm Vite proxy returns JSON (not HTML)
If proxy is working, `/api/v1/...` returns JSON.

```bash
curl -i http://localhost:3003/api/v1/auth/session | head -n 30
```

Expected:
- `401 Unauthorized` with JSON when logged out, OR
- `200 OK` with JSON when logged in.

**If you see `<html>`**, the proxy is broken (you are getting the Vite index.html, not the backend).

### 5.4 Confirm backend login works (direct backend)
```bash
COOKIE=/tmp/atlasai.cookies

# login
curl -i -s -c "$COOKIE"   -H "Content-Type: application/json"   -d '{"email":"admin@atlasai.local","password":"change_me"}'   http://127.0.0.1:8082/v1/auth/login | head -n 30

# session
curl -i -s -b "$COOKIE"   http://127.0.0.1:8082/v1/auth/session | head -n 30
```

### 5.5 Confirm proxy login works (through frontend)
```bash
COOKIE=/tmp/atlasai.proxy.cookies

curl -i -s -c "$COOKIE"   -H "Content-Type: application/json"   -d '{"email":"admin@atlasai.local","password":"change_me"}'   http://localhost:3003/api/v1/auth/login | head -n 30

curl -i -s -b "$COOKIE"   http://localhost:3003/api/v1/auth/session | head -n 30
```

---

## 6) Login credentials (dev)

Backend seeds (expected to exist):
- `admin@atlasai.local` / `change_me`
- `agent1@atlasai.local` / `change_me`
- `agent2@atlasai.local` / `change_me`

---

## 7) Fixing the two common failure loops

### Loop A: “I can curl backend but the browser app can’t login / gets 401”
Most common causes:
- Browser cookies blocked/mismatched origin
- Frontend is not using `/api` (proxy) for API calls
- Vite proxy missing in **the container build** (different `vite.config.ts` inside Docker vs your local file)
- Backend `FRONTEND_ORIGINS` missing `http://localhost:3003`

Quick checks:
1) `curl http://localhost:3003/api/v1/auth/session` must return JSON, not HTML.
2) In DevTools → Network, login request must be to `/api/v1/auth/login` and **must include cookies** (credentials).
3) Backend container env must include `FRONTEND_ORIGINS=http://localhost:3003`.

### Loop B: “Worklist or Case Detail disappeared after another agent ran something”
Most common causes:
- Work happened on a different git branch and wasn’t merged
- Someone edited routes/menu on a branch but didn’t push/PR
- Someone rebuilt Docker image from an older commit

Rules to prevent this:
- Always confirm **git branch + commit** before editing.
- Push changes + open PR (or merge to main) before another agent starts work.
- After Docker rebuild: verify routes exist in the running container (`/worklist`, `/cases/:id`).

---

## 8) Work split: who owns what

### Claude Code (Frontend owner)
- Only work in: `/Users/rene/ai-dev-workspace/atlasai`
- Goals:
  - Extend Worklist + Case Detail + Member Console toward mock parity.
  - **Do not replace existing working components.**
  - When backend fields/endpoints are missing, build UI read-only or stubbed and mark “backend-gated.”

### Codex (Backend owner)
- Only work in: `/Users/rene/ai-dev-workspace/atlasai-backend`
- Goals:
  - Keep endpoints stable for frontend features already built.
  - Add missing fields/endpoints **only when needed** for mock parity.
  - Validate backend work against PostgreSQL by default.
  - Use JSON only as a lightweight fallback/bootstrap path.

### Gemini (QA-only)
- No edits.
- Can run:
  - curl verification
  - `npm run smoke:ui` (if present) or Playwright scripts
  - browser/manual checklists
- Output:
  - a checklist of pass/fail, screenshots, reproduction steps.

---

## 9) Mock parity policy (avoid schema wars)

**Source of truth for contracts is the backend.**  
Example: mock status taxonomy differs from backend (mock: New/In Review/In Progress; backend: Open/Waiting/Escalated/Closed).

Policy:
- Do **not** change backend status taxonomy to match the mock unless explicitly requested.
- Frontend should render backend statuses and optionally *display* a stepper UI that maps to them.

---

## 10) Case Detail parity plan (current target)

Reference: `atlasai/docs/atlasai_shell_v1.html` → `renderCaseDetail(id)` and related CSS.

Implement in phases:

### Phase 1 (frontend-only, safe)
- Restore/ensure the routed Case Detail component is the intended one.
- Sticky context bar (Case #, status badge, agent, opened, HIPAA badge placeholder).
- Two-column layout (left: meta + timeline; right: member panel + status history).
- Timeline filter pills + reverse chronological display.
- Member panel PHI masking UI (based on sessionStorage HIPAA key), **even if read-only**.

### Phase 2 (frontend + backend fields)
- Ensure backend includes/display fields: groupNumber, claimNumber, priority, createdAt, updatedAt, description.
- Add those fields to the React `Case` model and render them in metadata grid.

### Phase 3 (frontend + backend mutation endpoints)
- PATCH status, assign agent, add note/call/task/email, close/reopen.
- Wire quick-action bar and modals.

---

## 11) Git workflow (how we avoid overwriting each other)

**Why Git is involved:** it tracks changes, supports collaboration, and prevents “lost work” when multiple agents touch the code.

Rules:
1) Always start from `main` (or your feature branch) and pull latest.
2) Make a feature branch per unit of work:
   - `feat/worklist-parity-step1`
   - `feat/case-detail-context-bar`
3) Commit small, descriptive commits.
4) Push branch and open a PR.
5) Merge only when checks pass and the feature is verified.

Useful commands:
```bash
git status
git checkout -b feat/<name>
git add -A
git commit -m "Short description"
git push -u origin feat/<name>
```

---

## 12) Where to put this runbook

- Save this file in **both repos** so each agent can read it immediately:
  - Frontend: `/Users/rene/ai-dev-workspace/atlasai/RUNBOOK.md`
  - Backend:  `/Users/rene/ai-dev-workspace/atlasai-backend/RUNBOOK.md`

If you only keep one “canonical” copy, keep it in the frontend repo and paste/link it into the backend repo.

---

## 13) Copy/paste agent onboarding snippet

Use this immediately after logging into an agent:

> Read `RUNBOOK.md` in this repo. Confirm your working directory matches your role (Claude=frontend repo, Codex=backend repo, Gemini=QA only). Do not touch Nexus. Use `docs/atlasai_shell_v1.html` as reference only. Extend, don’t replace. Use Docker Compose from atlasai/ for runtime. Confirm `/api` proxy returns JSON, not HTML, before any feature work.
