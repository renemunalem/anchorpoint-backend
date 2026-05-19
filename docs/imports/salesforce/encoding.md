# Salesforce Export Encoding Rules

Date: 2026-04-25
Scope: AtlasAI backend import planning only. No importer logic is defined here.

## Rules

- Treat imported Salesforce text as UTF-8 at the AtlasAI application boundary.
- If an export file is detected as `ISO-8859-1` or another non-UTF-8 encoding, convert it explicitly during import as a deliberate step.
- Never silently accept mojibake or mangled characters in case notes, member names, email bodies, feed posts, or filenames.
- If encoding cannot be identified with confidence, fail the import step loudly and record the file name plus detection result.

## Current expectations

- The 2026-04-25 export inventory has already identified mixed encodings in source CSVs.
- Future importer work must normalize text before persistence in the JSON dev store or any later MySQL store.
- Binary payload folders under `imports/` are local-only staging material and are out of scope for any text-encoding conversion.

## Minimum future importer behavior

- Detect source charset per file when needed.
- Convert non-UTF-8 CSV content to UTF-8 before parsing/mapping.
- Preserve original characters exactly where possible.
- Refuse lossy fallback behavior that replaces unknown characters without an explicit audit trail.
