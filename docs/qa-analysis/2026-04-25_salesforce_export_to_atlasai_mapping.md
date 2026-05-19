# Salesforce Export to AtlasAI Mapping Plan

Date: 2026-04-25
Scope: review-only mapping plan for `/Users/rene/ai-dev-workspace/atlasai-backend/imports/salesforce`

## Summary

The Salesforce export is sufficient to support an AtlasAI MVP import without pulling the full Salesforce object graph. The minimum viable set is:

- `Case.csv`
- `Contact.csv`
- `Account.csv`
- `User.csv`
- `CaseHistory2.csv`
- `EmailMessage.csv`
- `Task.csv`
- `FeedPost.csv`
- `ContentDocumentLink.csv`
- `ContentVersion.csv`

This set covers:

- AtlasAI `CaseSummary`
- AtlasAI `CaseDetail`
- AtlasAI `Member`
- case timeline/history
- assignment/agent lookup
- attachment metadata linkage plus binary payload availability via the dated export

The current AtlasAI backend contracts in [src/types/models.ts](/Users/rene/ai-dev-workspace/atlasai-backend/src/types/models.ts) are close enough for a pilot case/member import, but they are not yet import-ready for the full Salesforce timeline and file-linking workflow. The main gaps are:

- no stable external-source fields for Salesforce IDs
- no timeline type for inbound email
- no timeline type for call activity
- no attachment/document model
- no explicit PHI import allowlist or masking policy in the backend contract

## Minimum Viable Objects

### Required for MVP case + member fidelity

- `Case.csv`
  - source of AtlasAI case records and worklist rows
- `Contact.csv`
  - source of member/person records
- `Account.csv`
  - source of employer/group/org metadata
- `User.csv`
  - source of agent/owner resolution

### Required for MVP timeline fidelity

- `CaseHistory2.csv`
  - case status/owner history
- `EmailMessage.csv`
  - email timeline events
- `Task.csv`
  - follow-up tasks and call activity
- `FeedPost.csv`
  - internal notes / chatter-style updates

### Required for MVP document metadata and payload linkage

- `ContentDocumentLink.csv`
  - record-to-document association
- `ContentVersion.csv`
  - latest document metadata
- `exports/2026-04-25/ContentVersion/`
  - binary payloads keyed by `ContentVersion.Id`
- `exports/2026-04-25/Attachment.csv`
  - legacy attachment metadata
- `exports/2026-04-25/Attachments/`
  - legacy attachment payloads keyed by `Attachment.Id`

## AtlasAI Contract Mapping

## `CaseSummary`

Current AtlasAI shape:

- `id`
- `caseNumber`
- `memberId`
- `memberName`
- `caseType`
- `status`
- `actionItem`
- `urgency`
- `createdAt`
- `updatedAt`
- `agent`
- `groupNumber`
- `claimNumber`
- `priority`
- optional `description`, `closedAt`, `fcr`, `resolution`, `resolutionDetails`

Proposed Salesforce mapping:

| AtlasAI `CaseSummary` | Salesforce source | Notes |
| --- | --- | --- |
| `id` | `Case.Id` | Keep Salesforce case ID as the AtlasAI case primary key for MVP import. |
| `caseNumber` | `Case.CaseNumber` | Direct map. |
| `memberId` | `Case.Member_ID__c` else `Contact.Member_ID__c` else `Case.ContactId` | Prefer business member ID over raw Salesforce contact ID. |
| `memberName` | `Case.Member_Name__c` else `Case.Member_First_Name__c + Member_Last_Name__c` else `Contact.FirstName + LastName` | Use case-level denormalized value first because agents likely saw that same value in Salesforce. |
| `caseType` | `Case.Inquiry_Type__c` or fallback from `Case.Type` / `Reason` | AtlasAI currently supports `Eligibility`, `Claims`, `Prior Auth`, `Appeal`; a normalization table will be required. |
| `status` | `Case.Status` | Needs a normalization table into AtlasAI `Open` / `Waiting` / `Escalated` / `Closed`. |
| `actionItem` | derived from `Inquiry_Type__c`, `Resolution__c`, `Claim_Status__c`, `Follow_Up_Date__c` | No single direct Salesforce field currently matches AtlasAI’s `actionItem`. |
| `urgency.label` | derived from `Priority`, `Follow_Up_Date__c`, SLA fields | AtlasAI urgency is currently display-oriented and will need derivation logic. |
| `urgency.tone` | derived from normalized urgency | No direct source field. |
| `createdAt` | `Case.CreatedDate` | Direct map. |
| `updatedAt` | `Case.LastModifiedDate` | Direct map. |
| `agent` | `Case.Assigned_To__c` else `User.FirstName + LastName` via `Case.OwnerId` | Prefer owner lookup as canonical, preserve `Assigned_To__c` as imported raw text if needed. |
| `groupNumber` | `Case.Group__c` else `Account.Group__c` | `Case.Group__c` is likely the field agents used operationally. |
| `claimNumber` | `Case.Claim__c` | Direct map. |
| `priority` | `Case.Priority` | Needs normalization into AtlasAI `Normal` / `High` / `Urgent`. |
| `description` | `Case.Description` | Direct map with PHI caution. |
| `closedAt` | `Case.ClosedDate` | Direct map when `Case.IsClosed = true`. |
| `fcr` | `Case.First_Call_Resolution__c` or `Case.Was_this_case_resolved__c` | Current AtlasAI field is stringly typed; future contract should normalize this. |
| `resolution` | `Case.Resolution__c` | Direct map. |
| `resolutionDetails` | `Case.Resolution_Details__c` or `Case.Closed_Case_Notes__c` | `Closed_Case_Notes__c` may be better preserved separately too. |

Recommended import-only additions to track in contract work:

- `externalSource: "salesforce"`
- `externalId: Case.Id`
- `externalOwnerId: Case.OwnerId`
- `contactId: Case.ContactId`
- `accountId: Case.AccountId`

## `CaseDetail`

Current AtlasAI `CaseDetail` extends `CaseSummary` and adds:

- `timeline`
- `member` subset

Proposed Salesforce mapping additions:

- `member`
  - hydrate from `Contact.csv` joined through `Case.ContactId`
  - use `Case.Member_ID__c` as the preferred business key when available
- timeline
  - hydrate from `CaseHistory2.csv`, `EmailMessage.csv`, `Task.csv`, and `FeedPost.csv`

Recommended detail-specific fields to preserve in raw import staging, even if AtlasAI does not display them immediately:

- `Case.Caller_Type__c`
- `Case.Caller_Name__c`
- `Case.Caller_Contact__c`
- `Case.Amount_Billed__c`
- `Case.Date_of_Service__c`
- `Case.Claim_Status__c`
- `Case.Closed_Case_Notes__c`
- `Case.Follow_Up_Date__c`

These are high-value case-detail fields for future UI work, even if they do not belong in the MVP worklist surface.

## `Member`

Current AtlasAI shape already expects:

- member ID
- name
- birthdate
- ssn
- phone
- email
- address
- group/plan metadata
- COBRA / COB metadata

Proposed Salesforce mapping:

| AtlasAI `Member` | Salesforce source | Notes |
| --- | --- | --- |
| `id` | `Contact.Member_ID__c` else `Contact.Id` | Prefer business member ID for frontend routing stability. |
| `subscriberMemberId` | `Contact.Member_ID__c` | Direct map. |
| `firstName` | `Contact.FirstName` | Direct map. |
| `lastName` | `Contact.LastName` | Direct map. |
| `birthdate` | `Contact.Birthdate` else `Case.Date_of_Birth__c` | Prefer `Contact` as canonical. |
| `ssn` | `Contact.SSN__c` else `Case.SSN__c` | PHI-sensitive; candidate to exclude from pilot import. |
| `phoneNumber` | `Contact.Phone` or `MobilePhone` else `Case.Phone__c` | Normalize to one display/canonical phone. |
| `email` | `Contact.Email` | Direct map. |
| `addressLine1` | `Contact.MailingStreet` else `Case.Address__c` | Prefer structured mailing fields. |
| `city` | `Contact.MailingCity` | Direct map. |
| `state` | `Contact.MailingState` | Direct map. |
| `zipCode` | `Contact.MailingPostalCode` | Direct map. |
| `accountGroupName` | `Account.Name` | Joined through `Contact.AccountId` or `Case.AccountId`. |
| `groupNumber` | `Contact.Group__c` else `Account.Group__c` | Prefer member/contact-level group when present. |
| `planName` | `Contact.Plan_Name__c` else `Case.Cigna_Plan__c` | Prefer contact-level source. |
| `planId` | derived placeholder or future source | No clear MVP source exists in the current export. |
| `cobra` | `Contact.COBRA_Flag__c` | Direct map if populated. |
| `coverageEffectiveDate` | `Contact.Eligibility_Start_Date__c` | Direct map. |
| `coverageTermDate` | `Contact.Eligibility_End_Date__c` | Direct map. |
| `coverageTier` | derived | No direct field in the export. |
| `relationshipType` | derive from `Member_Type__c`, `Policy_Holder__c`, `Spouse__c`, `Child__c` | Needs normalization logic. |
| `memberStatus` | derive from `Eligibility__c` and end date | AtlasAI currently expects `Active` / `Terminated`. |
| `cobStatus` | not directly available | Keep default / unknown unless another source is identified. |
| `cobCoverageTypes` | not directly available | Likely unavailable in this export. |
| `cobDetails` | `Contact.Alerts__c` only if semantically relevant | Weak source; do not overfit. |
| `cobReportedAt` | no clear source | Leave empty/default in MVP unless another source is identified. |

Contract gap:

- The current `Member` model is richer than the exported Salesforce member data in some areas and weaker in others.
- `planId`, `coverageTier`, and COB-specific fields do not have strong direct mappings in the current export.
- PHI-heavy fields exist and should not be copied into every downstream display object.

## Timeline Entry Mapping

Current AtlasAI timeline contract:

- `note`
- `status`
- `email-out`
- `close`
- `open`

This is not sufficient for the Salesforce export. MVP import should target the following event mapping:

| AtlasAI timeline event | Salesforce source | Proposed mapping |
| --- | --- | --- |
| `open` | `Case.CreatedDate` | Synthetic case-open event from the case record itself. |
| `status` | `CaseHistory2.csv` | One entry per history row. `toStatus` comes from normalized `CaseHistory2.Status`. |
| `close` | `Case.ClosedDate` and/or `CaseHistory2` | Synthetic close event when case closes. |
| `email-out` | `EmailMessage.csv` where `Incoming = false` | Map `Subject`, `TextBody`, `ToAddress`, sender name, and timestamp. |
| `email-in` | `EmailMessage.csv` where `Incoming = true` | Needed new backend enum value. |
| `note` | `FeedPost.csv` and selected `Task.csv` rows | Internal case notes / updates. |
| `call` | `Task.csv` where call fields are populated or `Type` / `CallType` indicates a call | Needed new backend enum value. |

Recommended timeline field mapping:

- `id`
  - source object ID (`EmailMessage.Id`, `Task.Id`, `FeedPost.Id`, `CaseHistory2.Id`) with prefixing only if collisions are possible
- `author`
  - resolve from `CreatedById`, `OwnerId`, or `InsertedById` joined through `User.csv`
- `timestamp`
  - `CreatedDate`, `MessageDate`, `ActivityDate`, `CompletedDateTime`, or `LastModifiedDate` depending on source
- `text`
  - note body, task description, close note, or status summary text
- `subject`
  - email subject or task subject
- `to`
  - recipient email (`ToAddress`) for email events
- `toStatus`
  - normalized case status for `status` events

Important contract gaps:

- current backend has no `email-in`
- current backend has no `call`
- current backend does not track source object IDs on timeline rows
- current backend has no attachment/document reference on timeline entries

## Attachment / Document Strategy

The new dated export now includes binary payloads:

- `imports/salesforce/exports/2026-04-25/ContentVersion/` contains 893 payload files keyed by `ContentVersion.Id`
- `imports/salesforce/exports/2026-04-25/Attachments/` contains 15 legacy payload files keyed by `Attachment.Id`

That removes the earlier "missing binaries" blocker. The remaining work is contract-first linkage: how AtlasAI will represent and join those files to `Case`, `EmailMessage`, `FeedPost`, or other related entities.

Recommended MVP strategy:

- Phase 1
  - define attachment/document contract and linkage rules
  - keep:
    - `ContentDocumentId`
    - latest `ContentVersion.Id`
    - `Title`
    - `PathOnClient`
    - `FileType`
    - `ContentSize`
    - `LinkedEntityId`
    - export-relative binary path for `ContentVersion` payloads
    - legacy `Attachment.Id`, `ParentId`, `Name`, `ContentType`, and export-relative binary path
- Phase 2
  - decide whether AtlasAI needs actual file payloads copied into dev JSON storage or whether AtlasAI should reference export-local files during pilot work

Recommended backend contract addition:

- a small `CaseAttachmentSummary` model or attachment metadata array on `CaseDetail`
- source-link fields that distinguish:
  - legacy `Attachment`
  - `ContentDocumentLink` + `ContentVersion`
  - direct case link vs related-record link

This should be separate from timeline work so case/member import is not blocked by document payload ambiguity.

## Risks

### Encoding

- Prior inventory work confirmed mixed encodings in the export.
- `Case.csv`, `Task.csv`, and `ContentVersion.csv` were reported as `iso-8859-1`.
- `Contact.csv` and `EmailMessage.csv` were reported as `us-ascii`.
- Import work must normalize to UTF-8 before parsing and persistence.

### PHI / HIPAA

- PHI exists in structured fields:
  - `SSN__c`
  - `Date_of_Birth__c`
  - `Address__c`
  - `Phone__c`
- PHI also likely exists in free text:
  - `Case.Description`
  - `Resolution_Details__c`
  - `Closed_Case_Notes__c`
  - `EmailMessage.TextBody`
  - `Task.Description`

Recommendation:

- define a backend import allowlist before any import implementation
- keep PHI out of logs and worklist summaries
- strongly consider excluding SSN from the pilot import entirely

### Volume / performance

- `Case.csv` is moderate for JSON-store MVP use.
- `EmailMessage.csv` and `EntityHistory.csv` are much larger and can dominate load/memory if fully hydrated up front.
- Timeline import should be phased after core cases and members.

### Missing or partial sources

- binaries are now present in the dated export, so file presence is no longer the blocker
- attachment/linkage rules still need to be defined before importer work
- `Event.csv`, `Note.csv`, `ContactPoint*`, `VoiceCall.csv`, and some relationship tables are header-only in the current export
- some current AtlasAI fields have no clean Salesforce source:
  - `planId`
  - `coverageTier`
  - full COB fields

## Recommended Queue Follow-Ups

The mapping review supports three small backend follow-ups:

1. Define import-safe Salesforce MVP contract changes for `CaseSummary`, `CaseDetail`, and `Member`.
2. Extend the backend timeline contract to support `email-in` and `call`, with source-object traceability.
3. Add backend safety guardrails for Salesforce import work: `imports/` gitignore, UTF-8 normalization rules, and PHI allowlist/masking.

Updated attachment-specific follow-up:

4. Define attachment/document linkage contract for the dated export so AtlasAI can map `Attachment.csv` and `ContentVersion.csv` payloads back to cases without implementing the importer yet.

These are contract-first and import-prep tasks only. They should happen before any real import implementation.
