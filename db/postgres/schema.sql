CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  last_login VARCHAR(64) NULL,
  source_trace JSONB NULL
);

CREATE TABLE IF NOT EXISTS members (
  id VARCHAR(64) PRIMARY KEY,
  subscriber_member_id VARCHAR(64) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  birthdate VARCHAR(32) NULL,
  ssn VARCHAR(32) NULL,
  phone_number VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  address_line1 VARCHAR(255) NULL,
  city VARCHAR(128) NULL,
  state VARCHAR(64) NULL,
  zip_code VARCHAR(32) NULL,
  account_group_name VARCHAR(255) NOT NULL,
  group_number VARCHAR(64) NOT NULL,
  plan_name VARCHAR(255) NULL,
  plan_id VARCHAR(64) NULL,
  cobra BOOLEAN NOT NULL,
  coverage_effective_date VARCHAR(32) NOT NULL,
  coverage_term_date VARCHAR(32) NOT NULL,
  coverage_tier VARCHAR(64) NOT NULL,
  relationship_type VARCHAR(64) NOT NULL,
  member_status VARCHAR(32) NOT NULL,
  cob_status VARCHAR(32) NOT NULL,
  cob_coverage_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  cob_details TEXT NULL,
  cob_reported_at VARCHAR(64) NOT NULL,
  nifty_member_id VARCHAR(64) NULL,
  glip_channel_id VARCHAR(128) NULL,
  network VARCHAR(64) NULL,
  source_trace JSONB NULL
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS network VARCHAR(64) NULL;

CREATE TABLE IF NOT EXISTS cases (
  id VARCHAR(64) PRIMARY KEY,
  case_number VARCHAR(64) NOT NULL UNIQUE,
  member_id VARCHAR(64) NOT NULL REFERENCES members(id),
  member_name VARCHAR(255) NOT NULL,
  case_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  action_item TEXT NULL,
  urgency_label VARCHAR(64) NOT NULL,
  urgency_tone VARCHAR(32) NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  agent VARCHAR(255) NOT NULL,
  group_number VARCHAR(64) NOT NULL,
  claim_number VARCHAR(64) NULL,
  priority VARCHAR(32) NOT NULL,
  description TEXT NULL,
  closed_at VARCHAR(64) NULL,
  fcr VARCHAR(64) NULL,
  first_call_resolution BOOLEAN NULL,
  resolution VARCHAR(255) NULL,
  resolution_details TEXT NULL,
  origin VARCHAR(32) NOT NULL DEFAULT 'phone',
  due_at VARCHAR(64) NULL,
  source_trace JSONB NULL
);

CREATE TABLE IF NOT EXISTS case_timeline (
  id VARCHAR(128) PRIMARY KEY,
  case_id VARCHAR(64) NOT NULL REFERENCES cases(id),
  type VARCHAR(32) NOT NULL,
  author VARCHAR(255) NOT NULL,
  timestamp VARCHAR(64) NOT NULL,
  in_reply_to_id VARCHAR(128) NULL,
  call_direction VARCHAR(32) NULL,
  call_duration_seconds INTEGER NULL,
  task_due_date VARCHAR(64) NULL,
  text TEXT NULL,
  to_status VARCHAR(32) NULL,
  subject VARCHAR(255) NULL,
  sender_from VARCHAR(255) NULL,
  recipient_to VARCHAR(255) NULL,
  recipient_cc VARCHAR(255) NULL,
  recipient_bcc VARCHAR(255) NULL,
  source_trace JSONB NULL
);

CREATE TABLE IF NOT EXISTS case_attachments (
  id VARCHAR(128) PRIMARY KEY,
  case_id VARCHAR(64) NOT NULL REFERENCES cases(id),
  kind VARCHAR(64) NOT NULL,
  link_kind VARCHAR(32) NOT NULL,
  name VARCHAR(512) NOT NULL,
  title VARCHAR(512) NULL,
  description TEXT NULL,
  mime_type VARCHAR(255) NULL,
  file_type VARCHAR(64) NULL,
  size_bytes BIGINT NULL,
  is_private BOOLEAN NULL,
  created_at VARCHAR(64) NULL,
  owner VARCHAR(255) NULL,
  export_relative_path VARCHAR(1024) NULL,
  source_trace JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS rbac_permissions (
  id VARCHAR(64) PRIMARY KEY,
  role VARCHAR(64) NOT NULL UNIQUE,
  permissions JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS call_sessions (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL,
  caller_phone VARCHAR(64) NULL,
  member_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  started_at VARCHAR(64) NOT NULL,
  ended_at VARCHAR(64) NULL,
  locked_at VARCHAR(64) NULL,
  verified_member_ids JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_members_subscriber_member_id
  ON members (subscriber_member_id, id);

CREATE INDEX IF NOT EXISTS idx_cases_member_id
  ON cases (member_id);

CREATE INDEX IF NOT EXISTS idx_cases_created_at_id
  ON cases (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_case_timeline_case_timestamp_id
  ON case_timeline (case_id, timestamp, id);

CREATE INDEX IF NOT EXISTS idx_case_attachments_case_created_id
  ON case_attachments (case_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_call_sessions_agent_started
  ON call_sessions (agent_id, started_at);

-- ---------------------------------------------------------------------------
-- HIPAA Verification Display Policy tables (BE-075)
-- Authored: 2026-05-26 | Applied: N/A — must not apply without explicit authorization.
--
-- SECURITY non-negotiables encoded here:
--   1. default_mode defaults to 'strict' — safe for any new tenant row.
--   2. policy_change_history is append-only (no UPDATE/DELETE in application code).
--   3. reason/comment on every history row is NOT NULL — enforced at the DB layer.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_verification_policies (
  id                     VARCHAR(64)   PRIMARY KEY,
  tenant_id              VARCHAR(64)   NOT NULL UNIQUE,
  -- 'strict' | 'standard' | 'hybrid'. Defaults to 'strict' — any unknown tenant is Strict.
  default_mode           VARCHAR(32)   NOT NULL DEFAULT 'strict',
  -- JSON object: { fieldName: 'visible' | 'partial' | 'hidden' }.
  -- Fields omitted from this map default to 'hidden' (safest).
  field_visibility       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_changed_by_actor  VARCHAR(64)   NOT NULL,
  last_changed_by_role   VARCHAR(64)   NOT NULL,
  -- Non-empty reason required; enforced at application layer (validatePolicyChangeReason).
  last_change_reason     TEXT          NOT NULL,

  CONSTRAINT chk_tvp_mode CHECK (default_mode IN ('strict', 'standard', 'hybrid'))
);

-- Per-role mode overrides (least-privilege: role can only be pinned to same or stricter mode).
CREATE TABLE IF NOT EXISTS tenant_role_verification_overrides (
  id           VARCHAR(64)   PRIMARY KEY,
  tenant_id    VARCHAR(64)   NOT NULL REFERENCES tenant_verification_policies(tenant_id),
  role         VARCHAR(64)   NOT NULL,
  pinned_mode  VARCHAR(32)   NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  set_by_actor VARCHAR(64)   NOT NULL,
  set_by_role  VARCHAR(64)   NOT NULL,
  reason       TEXT          NOT NULL,

  UNIQUE (tenant_id, role),
  CONSTRAINT chk_trvo_mode CHECK (pinned_mode IN ('strict', 'standard', 'hybrid'))
);

-- Append-only change history. Rows are NEVER updated or deleted.
-- Every policy mutation (mode change, field visibility change, role override) inserts one row.
CREATE TABLE IF NOT EXISTS tenant_policy_change_history (
  id                   VARCHAR(64)   PRIMARY KEY,
  tenant_id            VARCHAR(64)   NOT NULL,
  changed_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  actor_id             VARCHAR(64)   NOT NULL,
  actor_role           VARCHAR(64)   NOT NULL,
  -- 'tenant-policy' or 'role-override'.
  target_type          VARCHAR(32)   NOT NULL,
  -- tenantId for tenant-policy; "tenantId:role" for role-override.
  target_identifier    VARCHAR(128)  NOT NULL,
  old_mode             VARCHAR(32)   NULL,
  new_mode             VARCHAR(32)   NOT NULL,
  old_field_visibility JSONB         NULL,
  new_field_visibility JSONB         NOT NULL DEFAULT '{}'::jsonb,
  -- Required non-empty reason — NOT NULL enforced here and at application layer.
  reason               TEXT          NOT NULL,
  comment              TEXT          NULL,

  CONSTRAINT chk_tpch_new_mode CHECK (new_mode IN ('strict', 'standard', 'hybrid'))
);

CREATE INDEX IF NOT EXISTS idx_tvp_tenant_id
  ON tenant_verification_policies (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tpch_tenant_changed
  ON tenant_policy_change_history (tenant_id, changed_at DESC);
