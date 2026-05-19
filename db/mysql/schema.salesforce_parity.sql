-- db/mysql/schema.salesforce_parity.sql
-- AtlasAI MySQL schema aligned to current src/types/models.ts (Salesforce parity)
-- Notes:
-- - Uses VARCHAR/ TEXT for timestamp strings to match existing JSON behavior.
-- - Keeps enums as VARCHAR for now (can add CHECKs later).
-- - Adds case_attachments table to represent CaseDetail.attachments + SalesforceAttachmentTrace.

-- =========================
-- USERS
-- =========================
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  last_login VARCHAR(64) NULL,

  -- SalesforceUserTrace (optional)
  source VARCHAR(32) NULL,           -- "salesforce"
  external_id VARCHAR(128) NULL,     -- sourceTrace.externalId
  alias VARCHAR(64) NULL,            -- sourceTrace.alias
  user_type VARCHAR(64) NULL         -- sourceTrace.userType
);

CREATE INDEX idx_users_external_id ON users(external_id);

-- =========================
-- MEMBERS
-- =========================
CREATE TABLE IF NOT EXISTS members (
  id VARCHAR(64) PRIMARY KEY,
  subscriber_member_id VARCHAR(64) NOT NULL,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  birthdate VARCHAR(32) NOT NULL,
  ssn VARCHAR(32) NOT NULL,
  phone_number VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  city VARCHAR(128) NOT NULL,
  state VARCHAR(64) NOT NULL,
  zip_code VARCHAR(32) NOT NULL,
  account_group_name VARCHAR(255) NOT NULL,
  group_number VARCHAR(64) NOT NULL,
  plan_name VARCHAR(255) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  cobra TINYINT(1) NOT NULL,
  coverage_effective_date VARCHAR(32) NOT NULL,
  coverage_term_date VARCHAR(32) NOT NULL,
  coverage_tier VARCHAR(64) NOT NULL,
  relationship_type VARCHAR(64) NOT NULL,
  member_status VARCHAR(32) NOT NULL,
  cob_status VARCHAR(32) NOT NULL,
  cob_coverage_types TEXT NOT NULL,
  cob_details TEXT NOT NULL,
  cob_reported_at VARCHAR(64) NOT NULL,

  -- SalesforceMemberTrace (optional)
  source VARCHAR(32) NULL,           -- "salesforce"
  external_id VARCHAR(128) NULL,     -- sourceTrace.externalId
  sf_account_id VARCHAR(128) NULL    -- sourceTrace.accountId
);

CREATE INDEX idx_members_external_id ON members(external_id);
CREATE INDEX idx_members_group_number ON members(group_number);

-- =========================
-- CASES
-- =========================
CREATE TABLE IF NOT EXISTS cases (
  id VARCHAR(64) PRIMARY KEY,
  case_number VARCHAR(64) NOT NULL UNIQUE,
  member_id VARCHAR(64) NOT NULL,
  member_name VARCHAR(255) NOT NULL,
  case_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  action_item TEXT NOT NULL,
  urgency_label VARCHAR(64) NOT NULL,
  urgency_tone VARCHAR(32) NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  agent VARCHAR(255) NOT NULL,
  group_number VARCHAR(64) NOT NULL,
  claim_number VARCHAR(64) NOT NULL,
  priority VARCHAR(32) NOT NULL,
  description TEXT NULL,
  closed_at VARCHAR(64) NULL,
  fcr VARCHAR(64) NULL,
  resolution VARCHAR(255) NULL,
  resolution_details TEXT NULL,

  -- SalesforceCaseTrace (optional)
  source VARCHAR(32) NULL,              -- "salesforce"
  external_id VARCHAR(128) NULL,        -- sourceTrace.externalId
  sf_contact_id VARCHAR(128) NULL,      -- sourceTrace.contactId
  sf_account_id VARCHAR(128) NULL,      -- sourceTrace.accountId
  sf_owner_id VARCHAR(128) NULL,        -- sourceTrace.ownerId
  member_external_id VARCHAR(128) NULL, -- sourceTrace.memberExternalId

  CONSTRAINT fk_cases_member FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX idx_cases_external_id ON cases(external_id);
CREATE INDEX idx_cases_sf_account_id ON cases(sf_account_id);
CREATE INDEX idx_cases_sf_contact_id ON cases(sf_contact_id);
CREATE INDEX idx_cases_member_id ON cases(member_id);
CREATE INDEX idx_cases_group_number ON cases(group_number);

-- =========================
-- CASE TIMELINE
-- (TimelineEntry + TimelineSourceTrace)
-- =========================
CREATE TABLE IF NOT EXISTS case_timeline (
  id VARCHAR(128) PRIMARY KEY,
  case_id VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL,         -- TimelineEntryType
  author VARCHAR(255) NOT NULL,
  timestamp VARCHAR(64) NOT NULL,
  text TEXT NULL,
  to_status VARCHAR(32) NULL,
  subject VARCHAR(255) NULL,

  -- TimelineEntry email metadata (additive)
  from_addr VARCHAR(255) NULL,
  to_addrs TEXT NULL,
  cc_addrs TEXT NULL,
  bcc_addrs TEXT NULL,

  -- TimelineSourceTrace (optional)
  source VARCHAR(32) NULL,              -- "salesforce"
  source_external_id VARCHAR(128) NULL, -- sourceTrace.externalId
  source_object VARCHAR(32) NULL,       -- SalesforceTimelineObject
  source_parent_id VARCHAR(128) NULL,   -- sourceTrace.parentId
  source_related_to_id VARCHAR(128) NULL, -- sourceTrace.relatedToId

  CONSTRAINT fk_case_timeline_case FOREIGN KEY (case_id) REFERENCES cases(id)
);

CREATE INDEX idx_case_timeline_case_id ON case_timeline(case_id);
CREATE INDEX idx_case_timeline_timestamp ON case_timeline(timestamp);
CREATE INDEX idx_case_timeline_source_ext ON case_timeline(source_external_id);
CREATE INDEX idx_case_timeline_source_obj ON case_timeline(source_object);

-- =========================
-- CASE ATTACHMENTS
-- (CaseAttachmentSummary + SalesforceAttachmentTrace)
-- =========================
CREATE TABLE IF NOT EXISTS case_attachments (
  id VARCHAR(128) PRIMARY KEY,          -- CaseAttachmentSummary.id (e.g. sf-content-link-..., sf-attachment-...)
  case_id VARCHAR(64) NOT NULL,

  -- attachment summary fields
  kind VARCHAR(32) NOT NULL,            -- "legacy-attachment" | "content-version"
  name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NULL,
  description TEXT NULL,
  mime_type VARCHAR(128) NULL,
  file_type VARCHAR(64) NULL,
  size_bytes BIGINT NULL,
  is_private TINYINT(1) NULL,
  created_at VARCHAR(64) NULL,
  owner VARCHAR(255) NULL,
  export_relative_path VARCHAR(512) NULL,

  -- trace (SalesforceAttachmentTrace) - required in TS
  source VARCHAR(32) NOT NULL,                  -- "salesforce"
  source_external_id VARCHAR(128) NOT NULL,     -- trace.externalId
  source_object VARCHAR(32) NOT NULL,           -- "Attachment" | "ContentDocumentLink" | "ContentVersion"
  source_attachment_kind VARCHAR(32) NOT NULL,  -- mirrors kind
  source_link_kind VARCHAR(32) NOT NULL,        -- "case-direct" | "related-record"

  linked_case_id VARCHAR(64) NULL,
  linked_entity_id VARCHAR(128) NULL,
  linked_entity_type VARCHAR(64) NULL,          -- "Case" | "EmailMessage" | "FeedPost" | "Task" | "Unknown"

  attachment_id VARCHAR(128) NULL,
  content_document_link_id VARCHAR(128) NULL,
  content_document_id VARCHAR(128) NULL,
  content_version_id VARCHAR(128) NULL,
  parent_id VARCHAR(128) NULL,

  CONSTRAINT fk_case_attachments_case FOREIGN KEY (case_id) REFERENCES cases(id)
);

CREATE INDEX idx_case_attachments_case_id ON case_attachments(case_id);
CREATE INDEX idx_case_attachments_export_path ON case_attachments(export_relative_path);
CREATE INDEX idx_case_attachments_source_ext ON case_attachments(source_external_id);
CREATE INDEX idx_case_attachments_linked_entity ON case_attachments(linked_entity_id);

-- =========================
-- RBAC PERMISSIONS
-- =========================
CREATE TABLE IF NOT EXISTS rbac_permissions (
  id VARCHAR(64) PRIMARY KEY,
  role VARCHAR(64) NOT NULL UNIQUE,
  permissions TEXT NOT NULL
);
