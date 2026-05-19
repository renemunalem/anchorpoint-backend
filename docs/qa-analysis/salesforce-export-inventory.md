# Salesforce Export Inventory

Date: 2026-04-25
Scope: analysis only for `/Users/rene/ai-dev-workspace/atlasai-backend/imports/salesforce`

## Safety Check

- `imports/` is **not** currently gitignored at the repo level.
- `git check-ignore -v imports imports/salesforce imports/salesforce/Case.csv` returned no match.
- `git status --short --ignored -- imports imports/salesforce` shows `?? imports/salesforce/`, which means the export directory is currently untracked but visible to Git.
- No files under `imports/` are currently tracked: `git ls-files imports imports/salesforce` returned no paths.
- No files under `imports/` are currently staged: `git diff --cached --name-only -- imports imports/salesforce` returned no paths.

Recommended `.gitignore` addition:

```gitignore
# external source exports / local import staging
imports/
```

Assessment: safe at the moment, but there is an accidental-commit risk until `imports/` is ignored.

## Export Snapshot

Notes:
- `wc -l` counts below include the header row. Approximate data rows are `wc -l - 1`.
- File size is shown in raw bytes as collected from `wc -c`.
- The list below is the most relevant subset for AtlasAI customer service import planning, not the full Salesforce export.

| File | Size (bytes) | `wc -l` | Why it matters |
| --- | ---: | ---: | --- |
| `Case.csv` | 11,354,107 | 11,459 | Primary service case record. This is the core source for AtlasAI cases, worklist state, member references, claim references, assignee hints, and resolution fields. |
| `CaseHistory2.csv` | 3,715,217 | 24,101 | Case-specific status and owner change history. Best candidate for status timeline reconstruction without mining generic audit logs. |
| `Contact.csv` | 5,199,234 | 8,269 | Member/person reference source. Includes `Member_ID__c`, demographics, contact details, and some eligibility-related fields. |
| `Account.csv` | 230,273 | 667 | Organization/group reference source. Useful for employer/group/org mapping and account-level metadata tied to a case. |
| `User.csv` | 41,453 | 51 | Assignee/owner directory. Needed to resolve `OwnerId` and possibly cross-check `Assigned_To__c`. |
| `EmailMessage.csv` | 29,713,865 | 2,692 | High-value case timeline source. Carries inbound/outbound email metadata and large message bodies that likely explain case progression. |
| `Task.csv` | 2,232,804 | 1,058 | Operational activity timeline source. Likely includes call tasks, follow-ups, wrap-up notes, and case-linked work items via `WhatId`. |
| `FeedPost.csv` | 2,119,679 | 3,112 | Chatter/feed posts tied to records. Useful as secondary case notes/timeline events when internal collaboration matters. |
| `FeedComment.csv` | 174,228 | 416 | Complements `FeedPost.csv` with threaded discussion. Lower priority than email/task, but still useful for internal context. |
| `ContentDocumentLink.csv` | 223,176 | 2,146 | Attachment linkage table. Tells us which case, email, or related record each document belongs to. |
| `ContentVersion.csv` | 391,018 | 885 | Attachment/document metadata. Needed to resolve filename, type, latest version, and document metadata after joining from `ContentDocumentLink`. |
| `CaseContactRole.csv` | 129 | 1 | Case-to-contact relationship structure. Header only right now, but important if later exports contain multiple contacts per case. |
| `AccountContactRole.csv` | 143 | 1 | Account-to-contact relationship structure. Header only now, but could help when contact/account relationships are not cleanly embedded. |
| `ContactPointEmail.csv` | 387 | 1 | Structured email contact points. Header only now. Potentially useful if contact channels need normalization beyond `Contact.Email`. |
| `ContactPointPhone.csv` | 477 | 1 | Structured phone contact points. Header only now. Potentially useful if phone normalization needs a canonical source. |
| `ContactPointAddress.csv` | 443 | 1 | Structured address contact points. Header only now. Could matter if `Contact` mailing fields are incomplete or stale. |
| `Event.csv` | 906 | 1 | Calendar/activity events. Header only now. Mappable to case timeline if populated in a future export. |
| `Note.csv` | 160 | 1 | Legacy note records. Header only now. Keep in the mapping plan because Salesforce orgs often use notes unevenly. |
| `VoiceCall.csv` | 520 | 1 | Explicit call object. Header only now, but useful if call recordings or call metadata eventually matter. |
| `RecordType.csv` | 2,269 | 11 | Small reference table. Useful for decoding object variants if record types affect case or contact semantics. |
| `AgentWork.csv` | 1,022 | 1 | Omni-channel routing/work assignment metadata. Header only now; useful only if service routing behavior matters later. |
| `PendingServiceRouting.csv` | 654 | 1 | Queue/routing metadata. Header only now; not needed for MVP import, but informative for future workload routing analysis. |

Additional note:
- `EntityHistory.csv` is very large at 28,331,841 bytes and 178,302 lines, but it is a generic cross-object audit log. It should stay out of the MVP plan unless `CaseHistory2.csv` proves insufficient for case status reconstruction.

## Core Object Mapping

- `Case.csv` -> AtlasAI `Case` record plus derived worklist row.
  - AtlasAI case should preserve Salesforce IDs (`Id`, `CaseNumber`) and core workflow fields (`Status`, `Priority`, `Subject`, `Description`, `CreatedDate`, `ClosedDate`, `OwnerId`).
  - The worklist row should be derived from the same case record, not stored as a separate source-of-truth object.

- `Contact.csv` and `Account.csv` -> AtlasAI member/person/org references.
  - `Contact` is the best member/person record.
  - `Account` is the best org/group/employer record.
  - AtlasAI should keep raw Salesforce IDs so later timeline or attachment rows can resolve back to the same references.

- `EmailMessage.csv`, `Task.csv`, `Event.csv`, `Note.csv`, `FeedPost.csv` -> AtlasAI case timeline events.
  - Each should normalize into a common timeline/event envelope with event type, timestamp, author/owner, body/summary, and linked case.
  - `FeedComment.csv` should be treated as a child/reply event to `FeedPost.csv`, not as a standalone primary timeline source.
  - `VoiceCall.csv` can later become a call event type if the object is populated in future exports.

- `CaseHistory2.csv` -> AtlasAI status history timeline.
  - This should become system-generated timeline entries for status/owner changes.
  - It is a better first source than `EntityHistory.csv` because it is case-specific and smaller.

- `ContentDocumentLink.csv` + `ContentVersion.csv` -> AtlasAI attachments/documents.
  - Strategy: import document metadata and links first, not binary payloads.
  - `ContentDocumentLink` establishes which entity owns the document.
  - `ContentVersion` provides title, versioning, file type, publish status, and content size.
  - Actual file retrieval should be deferred because these CSVs expose metadata and IDs, not a ready-to-ingest local binary payload stream.

## Field Mapping for `Case.csv`

Core system fields that likely matter for AtlasAI:
- `Id`, `CaseNumber`: external key and human-readable case number.
- `Status`, `Priority`, `Subject`, `Description`: primary worklist and case detail display.
- `CreatedDate`, `ClosedDate`, `OwnerId`: workflow timing and assignee resolution.
- `ContactId`, `AccountId`: direct joins to member/person and org references.

Likely business-specific fields to retain:

| Salesforce field | Proposed AtlasAI mapping | Notes |
| --- | --- | --- |
| `Member_ID__c` | member external key | Best business-stable identifier for linking a case to a member, independent of Salesforce contact ID churn. |
| `Member_Name__c` | denormalized member display name | Useful for search/display, but should not replace canonical member reference resolution. |
| `Group__c` | group/org/group-plan reference | Likely useful for segmentation, routing, and filtering in case views. |
| `Claim__c` | claim reference | Important domain key for service cases tied to claims. |
| `Inquiry_Type__c` | case category / intake reason | Likely a top-level filter and reporting dimension in AtlasAI. |
| `Assigned_To__c` | legacy assignee display field | Preserve raw value, but treat `OwnerId -> User` as the canonical assignee relationship when available. |
| `Amount_Billed__c` | case financial attribute | Domain-specific field that may matter for claim/service review workflows. |
| `Date_of_Service__c` | service date | Important for claim timelines and service validation. |
| `Resolution__c` | resolution summary / disposition | Good candidate for structured case outcome. |
| `Resolution_Details__c` | detailed resolution notes | Best kept as case detail plus potentially a closing timeline entry. |
| `Closed_Case_Notes__c` | terminal notes | Likely final human-entered closeout narrative; useful for audit and review. |
| `Date_of_Birth__c` | sensitive member demographic field | Treat as PHI/PII. Keep out of worklist/search indexes by default and mask in logs. |
| `SSN__c` | highly sensitive identifier | Treat as PHI/PII. Strong candidate to exclude from pilot import or store only under strict backend-only controls. |
| `Address__c` | sensitive contact/location field | Treat as PHI/PII. Avoid broad indexing and avoid rendering in summary lists. |
| `Phone__c` | sensitive contact field | Treat as PHI/PII. Normalize for reference, but mask in logs and summaries. |

PHI handling recommendation:
- For the pilot, import only what is needed to validate relationships and case usability.
- Exclude or tightly gate `SSN__c`.
- Do not expose `Date_of_Birth__c`, `Address__c`, or `Phone__c` in worklist summaries.
- Do not print raw PHI in import logs, QA output, or debug payloads.
- Expect PHI to also appear in free-text fields such as `Description`, `Resolution_Details__c`, `Closed_Case_Notes__c`, `EmailMessage.TextBody`, and `Task.Description`.

## Relationship Strategy

- Case -> Member
  - Primary strategy: use `Case.Member_ID__c` as the AtlasAI member external key when present.
  - Fallback strategy: use `Case.ContactId -> Contact.Id`, then derive `Contact.Member_ID__c` if the case-level member ID is missing.
  - Keep both raw joins: `ContactId` for Salesforce referential integrity and `Member_ID__c` for business-level continuity.

- Case -> Account / org
  - Use `Case.AccountId -> Account.Id`.
  - Preserve `Group__c` separately because it may be a business grouping that does not fully match the Salesforce account hierarchy.

- Case -> Emails
  - Primary join: `EmailMessage.ParentId == Case.Id`.
  - Secondary fallback: evaluate `EmailMessage.RelatedToId` if any records do not populate `ParentId`.
  - Timeline event should capture direction (`Incoming`), addresses, subject, body availability, attachment flag, and message timestamp.

- Case -> Tasks
  - Primary join: `Task.WhatId == Case.Id`.
  - Secondary person join: `Task.WhoId -> Contact.Id` when task context is member-centric rather than directly case-centric.
  - Treat task rows as timeline events; preserve task status, type, due date, and description.

- Case -> Status history
  - Use `CaseHistory2.CaseId == Case.Id`.
  - Convert each history row into a timeline event carrying `Status`, `OwnerId`, `PreviousUpdate`, `LastModifiedDate`, and `LastModifiedById`.

- Case -> Attachments
  - Use `ContentDocumentLink.LinkedEntityId` to find documents linked directly to a case or indirectly to a case-related record.
  - Join `ContentDocumentLink.ContentDocumentId -> ContentVersion.ContentDocumentId`.
  - Prefer `ContentVersion.IsLatest = true` for the main document listing; keep the option to preserve all versions later if audit fidelity matters.
  - Expect some documents to link to `EmailMessage`, `FeedPost`, or other related objects rather than directly to the case.

- Case -> Additional contacts
  - If future exports populate `CaseContactRole.csv`, use `CasesId -> Case.Id` and `ContactId -> Contact.Id` to model secondary contacts on the case.

## Risks / Blockers

- Encoding
  - The export is mixed.
  - `file -I` reports `Case.csv`, `Task.csv`, and `ContentVersion.csv` as `charset=iso-8859-1`.
  - `Contact.csv` and `EmailMessage.csv` report `charset=us-ascii`.
  - Import logic will need deterministic normalization to UTF-8 before parsing/storing, especially for free-text bodies and names.

- PHI scope and masking
  - PHI is present both in structured fields (`SSN__c`, `Date_of_Birth__c`, `Address__c`, `Phone__c`) and likely in free text.
  - Pilot import should define which fields are excluded, masked, or backend-only before any load is attempted.

- Missing references / sparse supporting tables
  - Several relevant objects are header-only in this snapshot: `Event.csv`, `Note.csv`, `CaseContactRole.csv`, `ContactPoint*`, `VoiceCall.csv`, `AgentWork.csv`, `PendingServiceRouting.csv`.
  - The import plan must tolerate empty auxiliary tables without treating them as failures.

- Attachment/document complexity
  - `ContentDocumentLink.csv` and `ContentVersion.csv` give us metadata and relationships, not a straightforward local binary asset ingestion path.
  - Large attachment programs can become the longest-running and most storage-sensitive part of the migration.

- Generic audit-log sprawl
  - `EntityHistory.csv` is large and generic.
  - Pulling it into the first import would add complexity without clear evidence that `CaseHistory2.csv` is insufficient.

- What to import first
  - Minimal viable import should start with case records and enough reference data to render a usable AtlasAI case/worklist view.
  - Timeline and documents should be phased in after core case fidelity is proven.

## Next Moves

- Phase 0: pilot import
  - Import a controlled subset such as 200 cases into the JSON store.
  - Include `Case.csv`, `Contact.csv`, `Account.csv`, and `User.csv`.
  - Validate case rendering, member linking, assignee resolution, and PHI handling.

- Phase 1: full case import
  - Import all case rows plus the minimum reference tables required for stable joins.
  - Keep the first full pass focused on case detail and worklist fidelity, not timeline exhaustiveness.

- Phase 2: timeline import
  - Add `CaseHistory2.csv`, `EmailMessage.csv`, `Task.csv`, `FeedPost.csv`, and optionally `FeedComment.csv`.
  - Normalize everything into a common AtlasAI timeline schema.

- Phase 3: attachments/documents
  - Add document metadata from `ContentDocumentLink.csv` and `ContentVersion.csv`.
  - Decide separately whether actual file payload migration is required and how the binaries will be sourced.

## Commands Run

```bash
rg -n "(^|/)imports(/|$)|^imports/?$" .gitignore .git/info/exclude 2>/dev/null
git ls-files imports imports/salesforce
git diff --cached --name-only -- imports imports/salesforce
find imports/salesforce -maxdepth 1 -type f | sed 's#^#/#' | sort
ls -la .gitignore .git/info/exclude 2>/dev/null
git check-ignore -v imports imports/salesforce imports/salesforce/Case.csv
for f in imports/salesforce/Case.csv imports/salesforce/CaseHistory2.csv imports/salesforce/EmailMessage.csv imports/salesforce/Task.csv imports/salesforce/Event.csv imports/salesforce/Note.csv imports/salesforce/FeedPost.csv imports/salesforce/ContentDocumentLink.csv imports/salesforce/ContentVersion.csv imports/salesforce/Contact.csv imports/salesforce/Account.csv imports/salesforce/User.csv imports/salesforce/CaseContactRole.csv imports/salesforce/ContactPointEmail.csv imports/salesforce/ContactPointPhone.csv imports/salesforce/ContactPointAddress.csv imports/salesforce/AccountContactRole.csv imports/salesforce/VoiceCall.csv; do if [ -f "$f" ]; then printf "%s\t" "$f"; wc -l < "$f" | tr -d '\n'; printf "\t"; wc -c < "$f" | tr -d '\n'; printf "\n"; fi; done
for f in imports/salesforce/Case.csv imports/salesforce/CaseHistory2.csv imports/salesforce/EmailMessage.csv imports/salesforce/Task.csv imports/salesforce/Event.csv imports/salesforce/Note.csv imports/salesforce/FeedPost.csv imports/salesforce/ContentDocumentLink.csv imports/salesforce/ContentVersion.csv imports/salesforce/Contact.csv imports/salesforce/Account.csv imports/salesforce/User.csv imports/salesforce/CaseContactRole.csv imports/salesforce/ContactPointEmail.csv imports/salesforce/ContactPointPhone.csv imports/salesforce/ContactPointAddress.csv imports/salesforce/AccountContactRole.csv imports/salesforce/VoiceCall.csv; do if [ -f "$f" ]; then printf "=== %s ===\n" "$f"; sed -n '1p' "$f"; fi; done
sed -n '1,200p' .gitignore
sed -n '1,200p' .git/info/exclude
git status --short --ignored -- imports imports/salesforce
for f in imports/salesforce/FeedComment.csv imports/salesforce/AgentWork.csv imports/salesforce/PendingServiceRouting.csv imports/salesforce/CaseServiceProcess.csv imports/salesforce/Incident.csv imports/salesforce/ContactRequest.csv imports/salesforce/RecordType.csv imports/salesforce/EntityHistory.csv imports/salesforce/CaseRelatedIssue.csv imports/salesforce/ActivityEngagementRollup.csv; do if [ -f "$f" ]; then printf "%s\t" "$f"; wc -l < "$f" | tr -d '\n'; printf "\t"; wc -c < "$f" | tr -d '\n'; printf "\n"; fi; done
for f in imports/salesforce/FeedComment.csv imports/salesforce/AgentWork.csv imports/salesforce/PendingServiceRouting.csv imports/salesforce/CaseServiceProcess.csv imports/salesforce/Incident.csv imports/salesforce/ContactRequest.csv imports/salesforce/RecordType.csv imports/salesforce/EntityHistory.csv imports/salesforce/CaseRelatedIssue.csv; do if [ -f "$f" ]; then printf "=== %s ===\n" "$f"; sed -n '1p' "$f"; fi; done
file -I imports/salesforce/Case.csv imports/salesforce/Contact.csv imports/salesforce/EmailMessage.csv imports/salesforce/Task.csv imports/salesforce/ContentVersion.csv
```
