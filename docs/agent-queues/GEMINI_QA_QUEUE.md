# Gemini QA Queue (AtlasAI)

Rules:
- Gemini picks ONLY the first unchecked task.
- Gemini completes ONLY one task per run.
- Gemini must NOT edit code.
- Gemini must NOT edit queue files.
- Gemini writes QA reports ONLY into: docs/qa-analysis/

---

## Queue

- [ ] Retest TimelineCompose mutations after `authenticatedFetch` header fix
  - Owner: Gemini
  - Repo: Review-only
  - Goal:
    - Re-test TimelineCompose against the real backend after the frontend `authenticatedFetch` regression is fixed.
    - Confirm UI-driven compose mutations no longer fail with `400 Bad Request`.
  - Acceptance criteria:
    - On case `500Hu00002QF3EdIAL`, UI-driven compose actions succeed:
      - log call
      - create task
      - patch status
      - patch agent
      - close case with notes
    - Network requests no longer send duplicated `Content-Type` values.
    - Timeline updates are visible after successful mutations.
  - Notes:
    - Failure evidence: `docs/qa-analysis/2026-04-26_timeline_compose_parity_retest.md`
    - Keep the retest focused on the P0 regression and its directly affected compose flows.
  - Output:
    - Write a focused retest report in `docs/qa-analysis/` with pass/fail, affected case IDs, and request/response evidence.

- [x] ✅ (Seed) Browser smoke + critical path QA (Docker dev)
  - Owner: Gemini
  - Repo: Review-only
  - Goal:
    - Test as a real user on http://localhost:5174
    - Validate login and core navigation:
      1) Sign in (admin + agent)
      2) Open Worklist
      3) Open a case detail
      4) Open member profile from case/worklist
      5) Complete HIPAA verification
      6) Return to case and confirm Email unlock behavior
    - Record console/network issues and any broken routes.
  - Output:
    - Write a report file:
      docs/qa-analysis/YYYY-MM-DD_atlasai_smoke_report.md
    - Include:
      - Environment (Docker containers, URLs)
      - Steps, expected vs actual
      - Severity labels (P0/P1/P2)
      - Repro steps
      - Suggested next-best developer prompt

- [x] Retest HIPAA verification and email unlock after fix
  - Owner: Gemini
  - Repo: Review-only
  - Goal:
    - Re-run the exact Case Detail HIPAA path from `docs/qa-analysis/2026-04-25_atlasai_retest_hipaa_case_detail.md` after Claude's fix lands.
    - Confirm whether `Authorize & Access` enables under the intended rules and whether Email unlocks afterward.
  - Output:
    - Write a focused retest report in `docs/qa-analysis/`
    - Include pass/fail, exact case used, and whether the original P0 is resolved or still reproducible.

- [x] QA Salesforce MVP importer for cases, members, and users
  - Owner: Gemini
  - Repo: Review-only
  - Goal:
    - Validate the first implementation-phase Salesforce importer against `imports/salesforce/exports/2026-04-25/`.
    - Confirm that core cases, members, and users import correctly into the JSON-driver dev environment and that timeline/attachments are still intentionally absent in this phase.
  - Acceptance criteria:
    - Imported counts for cases, members, and users are plausible against the export and sample records map correctly in AtlasAI.
    - Sample case detail and member views show the expected core imported fields and Salesforce traceability identifiers.
    - Missing timeline rows and attachments are recorded as out of scope for this MVP phase, not failures.
  - Notes:
    - Docker-only dev. `REPO_DRIVER=json`.
    - Use the dated export at `imports/salesforce/exports/2026-04-25/` as the validation source of truth.
  - Output:
    - Write a QA report in `docs/qa-analysis/` with sample IDs, counts, pass/fail, and mismatches.

- [x] QA Salesforce timeline and attachment import phases after implementation
  - Owner: Gemini
  - Repo: Review-only
  - Goal:
    - After the timeline and attachment phases land, validate that imported case timelines and attachment metadata match the 2026-04-25 Salesforce export.
    - Confirm that attachment links distinguish direct case links vs related-record links and that export-relative file paths resolve to the expected payload locations.
  - Acceptance criteria:
    - Sample cases show imported `CaseHistory2`, `EmailMessage`, `Task`, and `FeedPost` timeline rows with expected event types and source traceability.
    - Sample cases show linked attachment/document metadata populated from both legacy and modern Salesforce export chains.
    - Attachment metadata points to the expected `Attachments/` or `ContentVersion/` export-relative paths without requiring binary relocation.
  - Notes:
    - Run this only after both importer follow-up phases land.
    - Use `imports/salesforce/exports/2026-04-25/` as the validation source of truth.
  - Output:
    - Write a QA report in `docs/qa-analysis/` with sample case IDs, linkage checks, and pass/fail findings.

- [x] ✅ Retest Salesforce attachment rendering after frontend Case Detail fix
  - Owner: Gemini
  - Repo: Review-only
  - Goal:
    - Re-test the attachment rendering gap reported in `docs/qa-analysis/2026-04-25_salesforce_timeline_and_attachments_validation.md` after the frontend Case Detail attachment UI lands.
    - Confirm imported attachments are visible for both direct case links and related-record links.
  - Acceptance criteria:
    - `/cases/500Hu00002QF3ExIAL` shows the single imported direct case attachment.
    - `/cases/500Hu00002Qox7zIAB` shows mixed direct and related-record attachments.
    - `/cases/500Hu00002RUXy5IAH` shows the high-volume related-record attachment set.
    - Rendered attachment rows still align with backend metadata, including `kind`, `linkKind`, and `exportRelativePath`.
  - Notes:
    - Backend API already returns attachments for these cases; treat missing UI output as a frontend regression until proven fixed.
  - Output:
    - Write a focused retest report in `docs/qa-analysis/` with sample case IDs, visible counts, pass/fail, and any rendering regressions.

- [x] Smoke test Salesforce attachment downloads after backend endpoint lands
  - Owner: Gemini
  - Repo: Review-only
  - Goal:
    - Re-test the Case Detail `Download` action after the backend attachment download endpoint is implemented.
    - Confirm both Salesforce content-version files and legacy attachments download successfully from the UI.
  - Acceptance criteria:
    - `/cases/500Hu00002Qox7zIAB` downloads the content-version file behind `sf-content-link-06AHu000013ndHdMAI`.
    - `/cases/500Hu00002Qox7zIAB` downloads the legacy attachment behind `sf-attachment-00PHu00002lajW7MAI`.
    - Browser/network shows `200` responses with a usable filename and non-JSON content type.
  - Notes:
    - Failure evidence: `docs/qa-analysis/2026-04-25_atlasai_attachments_download_smoke.md`
    - Run this only after the backend download endpoint task lands.
  - Output:
    - Write a focused QA report in `docs/qa-analysis/` with status codes, filenames, and any download regressions.
  - Completion:
    - Verified PASS in:
      - `docs/qa-analysis/2026-04-25_atlasai_attachments_download_retest.md`
      - `docs/qa-analysis/2026-04-25_atlasai_mysql_attachment_download_smoke.md`
