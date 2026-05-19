# MySQL Salesforce MVP Import Audit

Date: 2026-04-25
Owner: Codex
Scope: MySQL Phase C2 core-entity import audit for `imports/salesforce/exports/2026-04-25/`

## Summary

The Phase C1 member count mismatch was not a random loss of 50 contacts. It was:

- `-70` duplicate Salesforce contact rows that reuse an existing `Member_ID__c`
- `+20` seed/demo members retained from `db:mysql:init`
- Net observed Phase C1 delta against processed contacts: `8275 - 70 + 20 = 8225`

Phase C2 changes the MySQL importer policy so core Salesforce import replaces the MySQL case/member dataset on each run instead of mixing imported rows with the seed/demo rows. The stored member count is now the deduped unique-member total:

- Contacts processed: `8275`
- Unique member keys stored: `8205`
- Duplicate contact-row merges: `70` across `69` repeated `Member_ID__c` keys

## Root Cause Of The Phase C1 `-50` Delta

`Contact.csv` contains repeated `Member_ID__c` values. AtlasAI case linkage already uses `Member_ID__c` as the stable member identity, so multiple Salesforce contacts can map to the same AtlasAI member row.

At the same time, the Phase C1 MySQL importer left the `db:mysql:init` seed/demo members in place. That produced a mixed count:

- `8205` unique imported member identities
- `+20` retained seed/demo members
- `= 8225` stored members

Compared to the raw `8275` contacts processed, that looked like `-50`, but the real accounting was:

- `-70` duplicate-contact merges
- `+20` retained seed/demo rows

## Chosen Policy

Chosen policy: treat repeated Salesforce contacts with the same `Member_ID__c` as the same AtlasAI member.

Implementation effect:

- MySQL import now clears the MySQL core case/member dataset before reloading the Salesforce MVP core entities.
- Imported Salesforce users are also refreshed as a set, while local dev users remain preserved.
- Repeated contact rows are merged deterministically into one stored member identity keyed by `Member_ID__c`.

This does **not** change JSON-mode behavior. JSON import output stays as it was; the new audit is mysql-only.

## Contract Implications

No backend contract change was required.

The existing contract already models a single AtlasAI `Member` keyed by the member identity used by cases. Phase C2 only makes the MySQL importer accounting explicit and deterministic.

## Redacted Collision Example

Example repeated member key:

- Member key: `2100***500`
- Contact IDs: `003H***IAZ`, `003c***AAR`, `003c***AAI`

These rows represent multiple Salesforce contacts collapsing into one AtlasAI member record because they share the same `Member_ID__c`.
