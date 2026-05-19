import { Request } from "express";
import { env } from "../config/env";
import { CallSession, CaseDetail, CaseSummary, Member, TimelineEntry } from "../types/models";
import { HipaaVerificationStamp } from "../types/session";
import { DenialReasonCode } from "../types/http";

const CALL_SESSION_HEADER = "x-call-session-id";

export function getCallSessionIdFromHeader(req: Request): string | null {
  const raw = req.headers[CALL_SESSION_HEADER];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isCallSessionVerifiedForMember(
  session: CallSession | null | undefined,
  memberId: string | null | undefined,
): boolean {
  if (!session || !memberId) return false;
  if (session.lockedAt) return false;
  const stamp = session.verifiedMemberIds?.[memberId];
  if (!stamp) return false;
  return Date.now() - stamp.verifiedAtMs <= env.hipaaVerificationTtlMs;
}

function toNull() {
  return null;
}

export function isHipaaMaskingEnabled() {
  return env.repoDriver === "mysql" || env.repoDriver === "postgres";
}

function isStampFresh(stamp: HipaaVerificationStamp | undefined, nowMs = Date.now()) {
  if (!stamp || typeof stamp.verifiedAtMs !== "number") {
    return false;
  }
  return nowMs - stamp.verifiedAtMs <= env.hipaaVerificationTtlMs;
}

function pruneExpiredStamps(map: Record<string, HipaaVerificationStamp> | undefined) {
  if (!map) return;
  const nowMs = Date.now();
  for (const key of Object.keys(map)) {
    if (!isStampFresh(map[key], nowMs)) {
      delete map[key];
    }
  }
}

function getVerifiedMemberIds(req: Request) {
  req.session.hipaaVerifiedMemberIds ??= {};
  return req.session.hipaaVerifiedMemberIds;
}

function getVerifiedCaseIds(req: Request) {
  req.session.hipaaVerifiedCaseIds ??= {};
  return req.session.hipaaVerifiedCaseIds;
}

export function isMemberHipaaVerified(req: Request, memberId?: string | null) {
  if (!isHipaaMaskingEnabled() || !memberId) {
    return false;
  }

  const stamp = req.session.hipaaVerifiedMemberIds?.[memberId];
  return isStampFresh(stamp);
}

export function isCaseHipaaVerified(req: Request, caseId?: string | null) {
  if (!isHipaaMaskingEnabled() || !caseId) {
    return false;
  }

  const stamp = req.session.hipaaVerifiedCaseIds?.[caseId];
  return isStampFresh(stamp);
}

export function markHipaaVerified(
  req: Request,
  memberId: string,
  caseId?: string,
  method?: string,
) {
  const verifiedAtMs = Date.now();
  const stamp: HipaaVerificationStamp = { verifiedAtMs, method };
  getVerifiedMemberIds(req)[memberId] = stamp;

  if (caseId) {
    getVerifiedCaseIds(req)[caseId] = stamp;
  }
}

export function getHipaaVerificationCounts(req: Request) {
  pruneExpiredStamps(req.session.hipaaVerifiedMemberIds);
  pruneExpiredStamps(req.session.hipaaVerifiedCaseIds);
  return {
    verifiedMemberIds: Object.keys(req.session.hipaaVerifiedMemberIds ?? {}).length,
    verifiedCaseIds: Object.keys(req.session.hipaaVerifiedCaseIds ?? {}).length,
    ttlMs: env.hipaaVerificationTtlMs,
  };
}

function shouldUnmaskMember(req: Request, memberId?: string | null) {
  return isMemberHipaaVerified(req, memberId);
}

function shouldUnmaskCase(req: Request, data: Pick<CaseSummary, "id" | "memberId">) {
  return isCaseHipaaVerified(req, data.id) || isMemberHipaaVerified(req, data.memberId);
}

function maskTimelineEntry(entry: TimelineEntry): TimelineEntry {
  return {
    ...entry,
    text: toNull(),
    subject: toNull(),
    from: toNull(),
    to: toNull(),
    cc: toNull(),
    bcc: toNull(),
  };
}

// Null semantics on member demographic fields (verified GET /v1/members/:id):
// null = "not provided in source" — the member record was imported without this field.
// This is a data-quality state, NOT a policy gate. There is no "restricted" category
// in the current model; a null field here always means the source did not supply it.
// (QAS-089 confirmed this for 000114556: DOB/phone/email/address all null = SF source empty.)
function maskMemberFields(member: Member): Member {
  return {
    ...member,
    firstName: toNull(),
    lastName: toNull(),
    birthdate: toNull(),
    ssn: toNull(),
    phoneNumber: toNull(),
    email: toNull(),
    addressLine1: toNull(),
    city: toNull(),
    state: toNull(),
    zipCode: toNull(),
    planName: toNull(),
    planId: toNull(),
    cobDetails: toNull(),
    network: toNull(),
  };
}

export function maskMemberForResponse(req: Request, member: Member): Member {
  if (!isHipaaMaskingEnabled() || shouldUnmaskMember(req, member.id)) {
    return member;
  }

  return maskMemberFields(member);
}

export function maskMemberFieldsForCallSession(member: Member): Member {
  return maskMemberFields(member);
}

function maskMemberListFields(member: Member): Member {
  return {
    ...member,
    birthdate: toNull(),
    ssn: toNull(),
    phoneNumber: toNull(),
    email: toNull(),
    addressLine1: toNull(),
    city: toNull(),
    state: toNull(),
    zipCode: toNull(),
    planName: toNull(),
    planId: toNull(),
    cobDetails: toNull(),
    network: toNull(),
  };
}

export function maskMemberListForResponse(member: Member): Member {
  if (!isHipaaMaskingEnabled()) {
    return member;
  }
  return maskMemberListFields(member);
}

function maskCaseSummaryFields(summary: CaseSummary): CaseSummary {
  return {
    ...summary,
    memberName: toNull(),
    actionItem: toNull(),
    claimNumber: toNull(),
    description: toNull(),
    resolution: toNull(),
    resolutionDetails: toNull(),
  };
}

export function maskCaseSummaryForResponse(req: Request, summary: CaseSummary): CaseSummary {
  if (!isHipaaMaskingEnabled() || shouldUnmaskCase(req, summary)) {
    return summary;
  }

  return maskCaseSummaryFields(summary);
}

// Distinguishes session_expired from out_of_session_scope for structured denials (BE-062/BE-063).
// Rules:
//   - No session or member: out_of_session_scope
//   - Session active, member never verified: out_of_session_scope
//   - Session active, member verified but TTL elapsed: session_expired
//   - Session locked, member was previously verified: session_expired (ended after valid call)
//   - Session locked, member never verified: out_of_session_scope
export function determineCallSessionDenialReason(
  session: CallSession | null | undefined,
  memberId: string | null | undefined,
): DenialReasonCode {
  if (!session || !memberId) return "out_of_session_scope";
  const stamp = session.verifiedMemberIds?.[memberId];
  if (!stamp) return "out_of_session_scope";
  // Stamp exists — member was verified in this session at some point
  return "session_expired";
}

// Strip SSN from any outbound member payload and set the hasSsnOnFile capability flag.
// originalMember must be the pre-masking record so hasSsnOnFile reflects source truth.
export function omitSsnFromResponse(originalMember: Member, responsePayload: Member): Member {
  const hasSsnOnFile = typeof originalMember.ssn === "string" && originalMember.ssn.trim().length > 0;
  return { ...responsePayload, ssn: null, hasSsnOnFile };
}

export function maskCaseDetailForResponse(req: Request, detail: CaseDetail): CaseDetail {
  if (!isHipaaMaskingEnabled() || shouldUnmaskCase(req, detail)) {
    return detail;
  }

  const maskedSummary = maskCaseSummaryFields(detail);

  return {
    ...maskedSummary,
    timeline: detail.timeline.map(maskTimelineEntry),
    callerName: toNull(),
    callerContact: toNull(),
    amountBilled: toNull(),
    dateOfService: toNull(),
    claimStatus: toNull(),
    closedCaseNotes: toNull(),
    member: detail.member
      ? {
          ...detail.member,
          firstName: toNull(),
          lastName: toNull(),
          planName: toNull(),
          planId: toNull(),
        }
      : detail.member,
  };
}
