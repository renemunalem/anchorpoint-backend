# AtlasAI Backend

This backend uses PostgreSQL as the primary local runtime while keeping cookie-session auth unchanged. JSON remains available as a lightweight fallback/bootstrap path with `REPO_DRIVER=json`, and MySQL remains temporarily available with `REPO_DRIVER=mysql`.

## Development

```bash
npm run db:pg:init
npm run dev
```

The backend listens on:

```text
http://127.0.0.1:8082
```

Default PostgreSQL settings are:

```text
PGHOST=127.0.0.1
PGPORT=5433
PGDATABASE=atlasai
PGUSER=atlasai
PGPASSWORD=change_me
```

The JSON fallback database file is:

```text
data/atlasai-dev.json
```

Use JSON explicitly only for fallback/bootstrap checks:

```bash
REPO_DRIVER=json npm run db:init
REPO_DRIVER=json npm run dev
```

The seed includes:
- users
- members
- cases
- minimal RBAC permissions

For demo persona prep against the running JSON dev DB (ensures each `Active` `Agent` user owns at least 2 cases so "My queue" is non-empty on first sign-in):

```bash
REPO_DRIVER=json npx tsx scripts/assign-demo-agent-cases.ts
```

The script is idempotent and only mutates `data/atlasai-dev.json`.

For the curated "Alice Johnson" (M1001) demo persona — 2 Open / 3 Closed cases with mixed FCR and ≥3 attachments distributed across cases — run:

```bash
REPO_DRIVER=json npx tsx scripts/seed-demo-alice.ts   # JSON dev DB
REPO_DRIVER=postgres npx tsx scripts/seed-demo-alice.ts   # PostgreSQL
```

The script is idempotent (Postgres path replaces by id within a transaction; JSON path replaces by id and writes back).

## Auth Endpoints

Auth endpoints return a small fixed set of user-safe error codes:

```text
AUTH_INVALID_CREDENTIALS
AUTH_SESSION_REQUIRED
AUTH_INVALID_REQUEST
AUTH_ACCOUNT_LOCKED
AUTH_INTERNAL
```

Diagnostic details are written server-side only.

Sign-in lockout is enforced in memory per normalized email address:

- 5 failed attempts within 15 minutes locks sign-in for that email.
- Lockout lasts 15 minutes.
- `AUTH_INVALID_CREDENTIALS` includes `remainingAttempts`.
- `AUTH_ACCOUNT_LOCKED` returns `429` with `retryAfterSeconds` and `lockedUntil`.

Login accepts an optional persistence flag:

```json
{ "email": "agent1@atlasai.local", "password": "change_me", "keepMeLoggedIn": true }
```

When the flag is omitted or false, the backend issues a browser-session cookie. When true, it issues a persistent 30-day cookie. `rememberMe` and `persistSession` are accepted as aliases for compatibility.

Password reset requests are accepted at:

```text
POST /v1/auth/password-reset
```

Body:

```json
{ "email": "agent1@atlasai.local" }
```

The response is always user-safe and does not reveal whether the account exists.

## Repository seam

Persistence now sits behind repository interfaces in `src/repos/*.ts`.

The default implementation is PostgreSQL-backed:

- `src/repos/postgres/PostgresUserRepo.ts`
- `src/repos/postgres/PostgresMemberRepo.ts`
- `src/repos/postgres/PostgresCaseRepo.ts`
- `src/repos/postgres/PostgresRbacRepo.ts`

`src/app.ts` wires repo implementations into services/controllers/routes. Controllers and routes no longer import the JSON store directly.

## How To Add MySQL Next

To add MySQL later without changing endpoint behavior:

1. Set `REPO_DRIVER=mysql`
2. Configure:
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_DATABASE`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`
   - optional `MYSQL_CONNECTION_LIMIT`
3. The first real MySQL-backed repos are now:
   - `src/repos/mysql/MySqlUserRepo.ts`
   - `src/repos/mysql/MySqlMemberRepo.ts`
   - `src/repos/mysql/MySqlCaseRepo.ts`
4. `MySqlUserRepo` expects a `users` table with snake_case columns:
   - `id`
   - `first_name`
   - `last_name`
   - `email`
   - `password`
   - `role`
   - `status`
   - `last_login`
5. `MySqlMemberRepo` expects a `members` table with snake_case columns matching the current `Member` model, including:
   - `subscriber_member_id`
   - `phone_number`
   - `address_line1`
   - `zip_code`
   - `account_group_name`
   - `group_number`
   - `plan_name`
   - `plan_id`
   - `coverage_effective_date`
   - `coverage_term_date`
   - `coverage_tier`
   - `relationship_type`
   - `member_status`
   - `cob_status`
   - `cob_coverage_types` as JSON text
   - `cob_details`
   - `cob_reported_at`
6. `MySqlCaseRepo` expects:
   - a `cases` table with snake_case columns:
     - `id`
     - `case_number`
     - `member_id`
     - `member_name`
     - `case_type`
     - `status`
     - `action_item`
     - `urgency_label`
     - `urgency_tone`
     - `created_at`
     - `updated_at`
     - `agent`
     - `group_number`
     - `claim_number`
     - `priority`
     - `description`
     - `closed_at`
     - `fcr`
     - `resolution`
     - `resolution_details`
   - a `case_timeline` table with:
     - `id`
     - `case_id`
     - `type`
     - `author`
     - `timestamp`
     - `text`
     - `to_status`
     - `subject`
     - `recipient_to`
7. `MySqlRbacRepo` expects an `rbac_permissions` table with:
   - `id`
   - `role`
   - `permissions` as JSON text
8. Replace the remaining scaffold methods under `src/repos/mysql/` if you add more repo types later
9. Implement the same interfaces:
   - `UserRepo`
   - `MemberRepo`
   - `CaseRepo`
   - `RbacRepo`
10. Keep service and controller contracts unchanged.
11. `src/repos/createRepos.ts` already switches between PostgreSQL, JSON, and MySQL drivers.
12. `src/config/mysql.ts` is the central place for MySQL env parsing and validation.
13. Leave routes/controllers/services untouched unless a new persistence capability genuinely changes behavior

Example env:

```bash
REPO_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=atlasai
MYSQL_USER=atlasai
MYSQL_PASSWORD=change_me
MYSQL_CONNECTION_LIMIT=10
```

## MySQL schema and seed

A starter MySQL schema is included at:

```text
db/mysql/schema.sql
```

To initialize and seed MySQL with the same dev data used by the JSON store:

```bash
npm run db:mysql:init
```

That command will:
- create the required tables if they do not exist
- clear existing seeded rows
- insert users, members, cases, case timeline entries, and RBAC permissions

It uses the current `MYSQL_*` environment variables and does not change the default PostgreSQL runtime unless `REPO_DRIVER=mysql` is set.
