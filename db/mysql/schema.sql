CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  last_login VARCHAR(64) NULL,
  source_trace JSON NULL
);

CREATE TABLE IF NOT EXISTS members (
  id VARCHAR(64) PRIMARY KEY,
  subscriber_member_id VARCHAR(64) NOT NULL,
  first_name VARCHAR(255) NULL,
  last_name VARCHAR(255) NULL,
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
  cobra TINYINT(1) NULL,
  coverage_effective_date VARCHAR(32) NULL,
  coverage_term_date VARCHAR(32) NULL,
  coverage_tier VARCHAR(64) NOT NULL,
  relationship_type VARCHAR(64) NOT NULL,
  member_status VARCHAR(32) NOT NULL,
  cob_status VARCHAR(32) NOT NULL,
  cob_coverage_types TEXT NULL,
  cob_details TEXT NULL,
  cob_reported_at VARCHAR(64) NULL,
  nifty_member_id VARCHAR(64) NULL,
  glip_channel_id VARCHAR(128) NULL,
  network VARCHAR(64) NULL,
  source_trace JSON NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id VARCHAR(64) PRIMARY KEY,
  case_number VARCHAR(64) NOT NULL UNIQUE,
  member_id VARCHAR(64) NOT NULL,
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
  first_call_resolution TINYINT(1) NULL,
  resolution VARCHAR(255) NULL,
  resolution_details TEXT NULL,
  origin VARCHAR(32) NOT NULL DEFAULT 'phone',
  due_at VARCHAR(64) NULL,
  source_trace JSON NULL,
  CONSTRAINT fk_cases_member FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS case_timeline (
  id VARCHAR(128) PRIMARY KEY,
  case_id VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL,
  author VARCHAR(255) NOT NULL,
  timestamp VARCHAR(64) NOT NULL,
  text MEDIUMTEXT NULL,
  to_status VARCHAR(32) NULL,
  subject VARCHAR(255) NULL,
  sender_from VARCHAR(255) NULL,
  recipient_to VARCHAR(255) NULL,
  recipient_cc VARCHAR(255) NULL,
  recipient_bcc VARCHAR(255) NULL,
  source_trace JSON NULL,
  CONSTRAINT fk_case_timeline_case FOREIGN KEY (case_id) REFERENCES cases(id)
);

CREATE TABLE IF NOT EXISTS case_attachments (
  id VARCHAR(128) PRIMARY KEY,
  case_id VARCHAR(64) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  link_kind VARCHAR(32) NOT NULL,
  name VARCHAR(512) NOT NULL,
  title VARCHAR(512) NULL,
  description TEXT NULL,
  mime_type VARCHAR(255) NULL,
  file_type VARCHAR(64) NULL,
  size_bytes BIGINT NULL,
  is_private TINYINT(1) NULL,
  created_at VARCHAR(64) NULL,
  owner VARCHAR(255) NULL,
  export_relative_path VARCHAR(1024) NULL,
  source_trace JSON NOT NULL,
  CONSTRAINT fk_case_attachments_case FOREIGN KEY (case_id) REFERENCES cases(id)
);

CREATE TABLE IF NOT EXISTS rbac_permissions (
  id VARCHAR(64) PRIMARY KEY,
  role VARCHAR(64) NOT NULL UNIQUE,
  permissions TEXT NOT NULL
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
  verified_member_ids JSON NOT NULL,
  INDEX idx_call_sessions_agent_started (agent_id, started_at)
);

-- ---------------------------------------------------------------------------
-- HIPAA Verification Display Policy tables (BE-075)
-- Authored: 2026-05-26 | Applied: N/A — must not apply without explicit authorization.
--
-- SECURITY non-negotiables:
--   1. default_mode defaults to 'strict' — safe for any new tenant row.
--   2. tenant_policy_change_history is append-only.
--   3. reason column is NOT NULL — enforced at the DB layer.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_verification_policies (
  id                     VARCHAR(64)   NOT NULL,
  tenant_id              VARCHAR(64)   NOT NULL,
  default_mode           VARCHAR(32)   NOT NULL DEFAULT 'strict',
  field_visibility       JSON          NOT NULL,
  created_at             VARCHAR(64)   NOT NULL,
  updated_at             VARCHAR(64)   NOT NULL,
  last_changed_by_actor  VARCHAR(64)   NOT NULL,
  last_changed_by_role   VARCHAR(64)   NOT NULL,
  last_change_reason     TEXT          NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tvp_tenant (tenant_id),
  CONSTRAINT chk_tvp_mode CHECK (default_mode IN ('strict', 'standard', 'hybrid'))
);

CREATE TABLE IF NOT EXISTS tenant_role_verification_overrides (
  id           VARCHAR(64)   NOT NULL,
  tenant_id    VARCHAR(64)   NOT NULL,
  role         VARCHAR(64)   NOT NULL,
  pinned_mode  VARCHAR(32)   NOT NULL,
  created_at   VARCHAR(64)   NOT NULL,
  set_by_actor VARCHAR(64)   NOT NULL,
  set_by_role  VARCHAR(64)   NOT NULL,
  reason       TEXT          NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trvo_tenant_role (tenant_id, role),
  CONSTRAINT chk_trvo_mode CHECK (pinned_mode IN ('strict', 'standard', 'hybrid')),
  CONSTRAINT fk_trvo_tenant FOREIGN KEY (tenant_id) REFERENCES tenant_verification_policies(tenant_id)
);

CREATE TABLE IF NOT EXISTS tenant_policy_change_history (
  id                   VARCHAR(64)   NOT NULL,
  tenant_id            VARCHAR(64)   NOT NULL,
  changed_at           VARCHAR(64)   NOT NULL,
  actor_id             VARCHAR(64)   NOT NULL,
  actor_role           VARCHAR(64)   NOT NULL,
  target_type          VARCHAR(32)   NOT NULL,
  target_identifier    VARCHAR(128)  NOT NULL,
  old_mode             VARCHAR(32)   NULL,
  new_mode             VARCHAR(32)   NOT NULL,
  old_field_visibility JSON          NULL,
  new_field_visibility JSON          NOT NULL,
  reason               TEXT          NOT NULL,
  comment              TEXT          NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_tpch_new_mode CHECK (new_mode IN ('strict', 'standard', 'hybrid')),
  INDEX idx_tpch_tenant_changed (tenant_id, changed_at)
);
