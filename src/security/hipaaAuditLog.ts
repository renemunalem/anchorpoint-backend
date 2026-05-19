import fs from "fs";
import path from "path";
import { env } from "../config/env";

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

function resolveLogPath() {
  const configured = env.hipaaAuditLogPath;
  if (!configured) {
    return null;
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
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
