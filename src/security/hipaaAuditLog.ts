import fs from "fs";
import path from "path";
import { env } from "../config/env";
import type { VerificationDisplayMode, VerificationField, FieldVisibility } from "./tenantPolicy";

// ---------------------------------------------------------------------------
// Verification Display Audit — nine SECURITY-required event types
// (auto-ratified by SECURITY-01, 2026-05-26; no further approval needed)
//
// No-PHI-in-logs rule (non-negotiable, extends to all nine event types):
//   - field-outcome: log field NAME and outcome — NEVER the stored value or caller-stated value.
//   - policy-changed: log old/new mode labels — NEVER field values.
//   - phi-unlock / phi-relock: log field NAME and session ID — NEVER the value.
//   - All other events: log session/actor/role identifiers only.
//
// AUDIT_BEFORE_PHI_SEND invariant (Standard/Hybrid activation path):
//   appendVerificationDisplayAuditEvent() MUST succeed before any PHI field value
//   is serialized into a response. If the write throws, the caller must return HTTP 500
//   and NOT transmit the PHI value. See tenantPolicy.ts for the full invariant contract.
// ---------------------------------------------------------------------------

/**
 * The nine SECURITY-required verification display audit event types.
 *   policy-changed        — Any write to tenant policy settings (mode or field visibility).
 *   verification-started  — HIPAA verification step initiated for a call session.
 *   field-outcome         — Per-field result: verified / not-verified / declined.
 *   verification-completed — All required fields passed; full verification success.
 *   verification-failed   — Agent marked "Failed Verification" explicitly.
 *   phi-unlock            — A PHI field value was sent to the client (Standard/Hybrid only).
 *   phi-relock            — Verified session ended; PHI access revoked.
 *   refused-pre-verify    — Caller declined verification before it started.
 *   intake.viewed         — Agent viewed the member intake panel (pre-verify safe context).
 */
export type VerificationDisplayAuditEventType =
  | "policy-changed"
  | "verification-started"
  | "field-outcome"
  | "verification-completed"
  | "verification-failed"
  | "phi-unlock"
  | "phi-relock"
  | "refused-pre-verify"
  | "intake.viewed";

export type FieldOutcome = "verified" | "not-verified" | "declined";

/**
 * Structured audit entry for all nine verification display event types.
 * Fields are kept PHI-free by design — see no-PHI-in-logs rule above.
 */
export interface VerificationDisplayAuditEntry {
  timestamp: string;
  eventType: VerificationDisplayAuditEventType;
  tenantId?: string;
  callSessionId?: string;
  actorId?: string;
  actorRole?: string;
  memberId?: string;

  // field-outcome / phi-unlock / phi-relock — field name only, never the value.
  fieldName?: VerificationField | string;
  // field-outcome — result of this field's evaluation.
  fieldOutcome?: FieldOutcome;

  // policy-changed — mode transition; old/new mode labels, never field values.
  oldMode?: VerificationDisplayMode | null;
  newMode?: VerificationDisplayMode;
  // policy-changed — field visibility delta (field names + visibility labels only).
  oldFieldVisibility?: Partial<Record<string, FieldVisibility>> | null;
  newFieldVisibility?: Partial<Record<string, FieldVisibility>>;
  // policy-changed — required non-empty reason.
  reason?: string;

  // Additional safe context (never PHI values).
  detail?: string;
}

function resolveLogPath() {
  const configured = env.hipaaAuditLogPath;
  if (!configured) return null;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

/**
 * Appends a verification display audit event to the HIPAA audit log.
 *
 * IMPORTANT — AUDIT_BEFORE_PHI_SEND:
 * For phi-unlock events in Standard/Hybrid mode this function MUST be called (and
 * must not throw) before the PHI value is included in the response. If this function
 * throws, the caller must return HTTP 500 and withhold the PHI value.
 *
 * This function re-throws on write failure when eventType === "phi-unlock" so that
 * the caller can enforce the invariant. For all other event types it logs to stderr
 * and does not break the request path (same as the existing appendHipaaAuditEntry).
 */
export function appendVerificationDisplayAuditEvent(
  entry: VerificationDisplayAuditEntry,
): void {
  const logPath = resolveLogPath();
  if (!logPath) return;

  const line = `${JSON.stringify({ ...entry, timestamp: entry.timestamp || new Date().toISOString() })}\n`;

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line, "utf8");
  } catch (error) {
    const msg = `[hipaa-audit] failed to write verification display event (${entry.eventType}): ${
      error instanceof Error ? error.message : String(error)
    }`;
    // phi-unlock failure is fatal — re-throw so callers enforce audit-before-send.
    if (entry.eventType === "phi-unlock") {
      throw new Error(msg);
    }
    console.error(msg);
  }
}

export type HipaaAuditResult =
  | "ok"
  | "member-not-found"
  | "case-not-found"
  | "case-member-mismatch"
  | "masking-disabled"
  | "session-started"
  | "session-locked"
  | "case-closed-on-call"
  | "case-mutation-on-call"
  | "ssn-reveal"
  | "session-extended"
  | "case-access-denied"
  | "failed"
  | "refused";

export type CaseMutationKind =
  | "assign"
  | "patch-status"
  | "patch-agent"
  | "patch-fcr"
  | "patch-first-call-resolution"
  | "status"
  | "note"
  | "call"
  | "task"
  | "email"
  | "glip-out"
  | "nifty-out"
  | "reopen";

export interface HipaaAuditEntry {
  timestamp: string;
  actor: {
    id?: string;
    email?: string;
  };
  memberId: string | null;
  caseId: string | null;
  method: string | null;
  result: HipaaAuditResult;
  detail?: string;
  callSessionId?: string;
  reason?: string;
}

export function appendHipaaAuditEntry(entry: HipaaAuditEntry) {
  const logPath = resolveLogPath();
  if (!logPath) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    // Audit logging must not break the request path; surface to stderr only.
    console.error(
      `[hipaa-audit] failed to write entry: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
