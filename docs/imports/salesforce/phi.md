# Salesforce Pilot Import PHI Rules

Date: 2026-04-25
Scope: AtlasAI backend pilot-import safety rules only. No importer logic is defined here.

## Local-only rule

- Everything under `imports/` is local-only staging data.
- Exported CSVs, binary payloads, and zip bundles must never be committed to git.
- PHI-bearing exports must remain on the local workstation or approved local Docker volumes only.

## PHI fields to treat as sensitive

Structured PHI/PII fields include at minimum:

- date of birth
- SSN
- mailing or street address
- phone numbers
- email addresses
- member identifiers when they can identify a real person
- claim numbers when tied to a real person
- billed amounts when tied to a real person

Free-text fields must also be treated as potentially PHI-bearing:

- case description
- resolution details
- closed case notes
- task descriptions
- email subject/body content
- feed post/comment content
- attachment/document titles or previews if they contain personal data

## Pilot import allowlist

Allowed into the AtlasAI dev database for pilot work when needed for core case/member fidelity:

- case IDs and case numbers
- normalized case status/type/priority fields
- member first and last name
- group/account references
- plan names
- claim number only when the pilot requires claim-linked case behavior
- case timeline metadata required for event ordering and traceability
- attachment/document metadata needed for linkage planning

## Must be masked or omitted for pilot work

- full SSN must be omitted
- exact DOB should be omitted unless a later task explicitly requires it and defines masking behavior
- full street address should be omitted
- full phone number should be omitted or masked
- full email address should be omitted or masked
- raw free-text fields containing PHI should not be broadly loaded into the dev store unless a later task explicitly requires them and defines redaction behavior

## Logging and debugging rules

- Never print raw PHI in importer logs, test logs, or QA notes.
- Log field names, counts, IDs, and masking decisions instead of raw values.
- If a row must be rejected for PHI-policy reasons, record the reason and source identifier only.

## Default pilot stance

- Prefer omission over masking for highly sensitive fields during the first pilot import.
- Prefer explicit allowlists over broad field passthrough.
- Treat any undefined field as disallowed until mapped and reviewed.
