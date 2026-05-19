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
