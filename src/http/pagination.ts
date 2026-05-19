import { BadRequestError, CaseListQuery, CursorPaginationRequest, MemberListQuery } from "../types/http";
import { CaseStatus } from "../types/models";

const VALID_CASE_STATUSES = new Set<string>(["Open", "Waiting", "Escalated", "Closed"]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function getSingleQueryValue(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function getTrimmedQueryValue(query: Record<string, unknown>, key: string) {
  const raw = getSingleQueryValue(query[key]);
  if (raw === undefined) {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseCursorPagination(query: Record<string, unknown>): CursorPaginationRequest {
  const rawLimit = getSingleQueryValue(query.limit);
  const rawCursor = getSingleQueryValue(query.cursor);

  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new BadRequestError("limit must be a positive integer");
    }

    limit = Math.min(parsed, MAX_LIMIT);
  }

  return {
    limit,
    cursor: rawCursor,
  };
}

export function parseCaseListQuery(query: Record<string, unknown>): CaseListQuery {
  const pagination = parseCursorPagination(query);

  let statuses: CaseStatus[] | undefined;
  const rawStatuses = query.statuses;
  if (rawStatuses !== undefined && rawStatuses !== null && rawStatuses !== "") {
    const parts = (Array.isArray(rawStatuses) ? rawStatuses.join(",") : String(rawStatuses))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (!VALID_CASE_STATUSES.has(part)) {
        throw new BadRequestError(`statuses contains invalid value: "${part}". Must be one of: ${[...VALID_CASE_STATUSES].join(", ")}`);
      }
    }
    if (parts.length > 0) {
      statuses = parts as CaseStatus[];
    }
  }

  return {
    ...pagination,
    caseNumber: getTrimmedQueryValue(query, "caseNumber"),
    caseId: getTrimmedQueryValue(query, "caseId"),
    memberId: getTrimmedQueryValue(query, "memberId"),
    groupNumber: getTrimmedQueryValue(query, "groupNumber"),
    claimNumber: getTrimmedQueryValue(query, "claimNumber"),
    q: getTrimmedQueryValue(query, "q"),
    statuses,
  };
}

export function parseMemberListQuery(query: Record<string, unknown>): MemberListQuery {
  const pagination = parseCursorPagination(query);
  const q = getTrimmedQueryValue(query, "q");

  if (q && q.length < 2) {
    throw new BadRequestError("q must be at least 2 characters for member search");
  }

  return {
    ...pagination,
    subscriberMemberId: getTrimmedQueryValue(query, "subscriberMemberId"),
    memberId: getTrimmedQueryValue(query, "memberId"),
    q,
    hasOpenCases: query["hasOpenCases"] === "true" ? true : undefined,
  };
}
