import { CaseStatus } from "../types/models";

// Canonical open-case status set. Import this constant in any endpoint
// that computes "open work" counts so the definition cannot drift.
// Rule: a case is "open" when its status is NOT Closed.
export const OPEN_CASE_STATUSES: CaseStatus[] = ["Open", "Waiting", "Escalated"];

// openClaimCount is always null until a separate claims schema is implemented.
// Claims are currently represented as cases with caseType = "Claims" and
// share the same CaseStatus vocabulary; there is no claims-specific status
// (e.g. "In Review", "Voided") in the current data model.
// Tracked as a future schema addition — do not fabricate claim counts.
export interface OpenWorkCounts {
  openCaseCount: number;
  openClaimCount: null;
}
