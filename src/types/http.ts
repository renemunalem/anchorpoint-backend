import { CaseStatus } from "./models";

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_ERROR";

export type AuthErrorCode =
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_SESSION_REQUIRED"
  | "AUTH_INVALID_REQUEST"
  | "AUTH_ACCOUNT_LOCKED"
  | "AUTH_INTERNAL"
  | "AUTH_HIPAA_REQUIRED";

export interface CursorPaginationRequest {
  limit: number;
  cursor?: string;
}

export interface CaseListQuery extends CursorPaginationRequest {
  caseNumber?: string;
  caseId?: string;
  memberId?: string;
  groupNumber?: string;
  claimNumber?: string;
  q?: string;
  statuses?: CaseStatus[];
}

export interface MemberListQuery extends CursorPaginationRequest {
  subscriberMemberId?: string;
  memberId?: string;
  q?: string;
  hasOpenCases?: boolean;
}

export type IntakeSearchType =
  | "auto"
  | "phone"
  | "memberId"
  | "caseId"
  | "claimId"
  | "name";

export interface IntakeSearchQuery {
  q: string;
  type: IntakeSearchType;
  limit: number;
}

export type IntakeCandidateCob = "primary" | "secondary" | "none";
export type IntakeCandidateEligibility = "active" | "terminated" | "pending";
export type IntakeCandidateRole = "subscriber" | "dependent";

export interface IntakeCandidate {
  memberId: string;
  initials: string;
  dobYear: number | null;
  subscriberLast4: string | null;
  groupCode: string;
  city: string | null;
  state: string | null;
  openCaseCount: number;
  lastContactDate: string | null;
  cob: IntakeCandidateCob;
  planTier: string | null;
  eligibility: IntakeCandidateEligibility;
  role: IntakeCandidateRole;
  attachmentCount: number;
}

export interface CursorPageInfo {
  nextCursor: string | null;
  hasNext: boolean;
}

export interface PaginatedListResponse<T> {
  items: T[];
  pageInfo: CursorPageInfo;
}

export type CursorPageResult<T> = PaginatedListResponse<T>;

export interface CaseStatusCounts {
  open: number;
  waiting: number;
  escalated: number;
  closed: number;
}

export interface DashboardSummary {
  openCasesCount: number;
  fcrRateToday: number | null;
  membersCount: number;
  verificationsToday: number;
  asOf: string;
}

export interface HipaaMetrics {
  range: string;
  ok: number;
  failed: number;
  refused: number;
  attemptLimitExceeded: number;
  total: number;
  asOf: string;
}

export interface AgentDashboardSummary {
  myOpenCasesCount: number;
  myOverdueCasesCount: number;
  myDueSoonCasesCount: number;
  myFcrRateLast30d: number | null;
  myVerificationsToday: number;
  asOf: string;
}

export interface FcrTrendDay {
  date: string;
  fcrYes: number;
  fcrNo: number;
  total: number;
}

export interface FcrTrend {
  range: string;
  days: FcrTrendDay[];
  totalFcrYes: number;
  totalFcrNo: number;
  fcrRate: number | null;
  asOf: string;
}

export type SlaTier = "past-due" | "within-24h" | "beyond-24h" | "no-deadline";

export interface CaseSlaRow {
  priority: "Urgent" | "High" | "Normal";
  tier: SlaTier;
  count: number;
}

export interface CaseSlaGrid {
  rows: CaseSlaRow[];
  totalOpen: number;
  asOf: string;
}

// 403 vs 404 policy for case access endpoints:
// - 404 / not_found       : case does not exist in the tenant. Never expose
//                           this code for restricted cases — use 403 instead.
// - 403 / out_of_session_scope : call session present but not verified for this member.
// - 403 / session_expired  : HIPAA verification TTL elapsed (same gate, TTL-specific label).
// - 403 / case_restricted  : no call session; HIPAA masking on; caller not session-verified.
// - 403 / role_denied      : caller role lacks permission (future; included for completeness).
export type DenialReasonCode =
  | "not_found"
  | "out_of_session_scope"
  | "session_expired"
  | "case_restricted"
  | "role_denied";

export interface DenialBody {
  status: number;
  reasonCode: DenialReasonCode;
  correlationId: string;
  retriable: boolean;
}

export function denialBody(
  status: number,
  reasonCode: DenialReasonCode,
  correlationId: string,
  retriable = false,
): DenialBody {
  return { status, reasonCode, correlationId, retriable };
}

export class BadRequestError extends Error {
  readonly code = "BAD_REQUEST" as const;
  readonly status = 400;
}

export class ConflictError extends Error {
  readonly code = "CONFLICT" as const;
  readonly status = 409;
}

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

export function authErrorBody(
  code: AuthErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}
