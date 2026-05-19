# LOCAL_DEV_POLICY

## Purpose

This file defines the standard local development runtime policy for our projects so frontend, backend, and QA agents stay aligned and do not make incorrect assumptions about what is running where.

---

## Standard Local Development Model

### Default rule

- **Backend runs in Docker**
- **Frontend runs locally via Vite**
- Do **not** assume the frontend is running in Docker unless it was explicitly started there

This is the default policy for local development unless a project explicitly documents a different setup.

---

## Project Runtime Conventions

### NEXUS

- **Frontend:** `http://localhost:3002`
- **Backend:** `http://127.0.0.1:8081`

### AtlasAI

- **Frontend:** `http://localhost:3003`
- **Backend:** `http://127.0.0.1:8082`

### Reserved future conventions

#### Billing system
- **Frontend:** `http://localhost:3004`
- **Backend:** `http://127.0.0.1:8083`

#### Website / marketing site
- **Frontend:** `http://localhost:3005`

---

## Docker vs Local Process Clarification

A project may be **dockerized** without being **currently running in Docker**.

### Definitions

#### Dockerized
The repo contains Docker support such as:
- `Dockerfile`
- `Dockerfile.dev`
- `docker-compose.yml`

#### Running in Docker
The service is actually started via:
- `docker compose up`
- or equivalent container runtime command

### Important distinction

- A frontend may be dockerized
- but still be running locally through `npm run dev` / Vite
- in that case, Docker Desktop will **not** show the frontend container as running

---

## Agent Responsibilities

### Codex
Owns:
- backend runtime checks
- Docker/container checks
- backend port alignment
- compose/runtime diagnostics
- backend health verification

### Claude
Owns:
- frontend code
- frontend Vite config
- frontend port alignment
- frontend dev-server expectations
- frontend-only local runtime assumptions

### Gemini
Owns:
- QA/browser verification
- confirming the actual active runtime
- stating clearly which URL/port was tested
- distinguishing real runtime validation from code/build-only inspection

---

## Verification Rules

Agents must **not** assume runtime health from documentation alone.

### Backend verification
Before claiming backend validation success, verify at least:
- `GET /health` on the expected backend URL

Examples:
- NEXUS backend: `http://127.0.0.1:8081/health`
- AtlasAI backend: `http://127.0.0.1:8082/health`

### Frontend verification
Before claiming frontend/browser validation success, verify:
- the expected frontend URL is reachable

Examples:
- NEXUS frontend: `http://localhost:3002`
- AtlasAI frontend: `http://localhost:3003`

### Reporting requirement
Every agent must state clearly whether validation was performed against:
- live Docker-backed backend
- live local Vite frontend
- both
- or only code/build inspection

---

## Port Policy

### Frontend ports
- NEXUS frontend → `3002`
- AtlasAI frontend → `3003`
- Billing frontend → `3004`
- Website frontend → `3005`

### Backend ports
- NEXUS backend → `8081`
- AtlasAI backend → `8082`
- Billing backend → `8083`

### Database ports (only if intentionally exposed)
- NEXUS MySQL → `3307`
- NEXUS Postgres → `5434`

Additional project DB ports should be explicitly assigned and documented if exposed.

---

## Vite Policy

Frontend local dev servers must use fixed assigned ports.

### Requirements
- Each frontend must bind to its assigned port
- Prefer `strictPort: true` so Vite fails loudly instead of silently moving to another port
- Silent fallback from `3002` to `5173/5174/...` is not acceptable for team consistency

---

## Runtime Truth Policy

Unless explicitly overridden:

- **Backend = Docker**
- **Frontend = local Vite**

This is the default working assumption for:
- Claude
- Codex
- Gemini

### Important
“Docker Desktop is running” does **not** mean:
- frontend is in Docker
- backend is healthy
- the expected app is already reachable

Live checks are still required in-session.

---

## Real-Backend Validation Policy

For signoff-quality backend validation:
- backend must be reachable live
- correct project URL/port must be verified in-session
- the active runtime mode must be stated honestly

Example:
- “Validated against live NEXUS backend on `http://127.0.0.1:8081`”
- “Validated against live NEXUS frontend on `http://localhost:3002`”
- “Code/build inspection only; browser runtime not verified”

---

## Multi-Project Safety Rule

Because multiple repos may exist on the same machine, agents must always confirm:

1. current working directory
2. current project
3. expected local frontend/backend port for that project

Agents must not assume that a running service belongs to the current project without checking the port and process context.

---

## Recommended Manual Checks

### Docker containers
```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
