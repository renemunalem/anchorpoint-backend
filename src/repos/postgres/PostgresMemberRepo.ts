import {
  BadRequestError,
  CursorPageResult,
  IntakeCandidate,
  IntakeCandidateCob,
  IntakeCandidateEligibility,
  IntakeCandidateRole,
  IntakeSearchQuery,
  MemberListQuery,
} from "../../types/http";
import { Member } from "../../types/models";
import { MemberRepo } from "../MemberRepo";
import { getPostgresPool } from "./client";

type IntakeCandidateRow = {
  memberId: string;
  firstName: string;
  lastName: string;
  birthdate: string | null;
  subscriberMemberId: string;
  groupNumber: string;
  city: string | null;
  state: string | null;
  openCaseCount: string | number | null;
  lastContactDate: string | null;
  cobStatus: Member["cobStatus"] | null;
  memberStatus: Member["memberStatus"] | null;
  relationshipType: Member["relationshipType"] | null;
  attachmentCount: string | number | null;
};

function intakeCobFromStatus(cobStatus: Member["cobStatus"] | null): IntakeCandidateCob {
  switch (cobStatus) {
    case "Yes":
      return "secondary";
    case "No":
      return "primary";
    default:
      return "none";
  }
}

function intakeEligibilityFromStatus(memberStatus: Member["memberStatus"] | null): IntakeCandidateEligibility {
  return memberStatus === "Terminated" ? "terminated" : "active";
}

function intakeRoleFromRelationship(relationshipType: Member["relationshipType"] | null): IntakeCandidateRole {
  return relationshipType === "Subscriber" ? "subscriber" : "dependent";
}

function digitsOnly(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function intakeInitials(firstName: string, lastName: string) {
  const first = (firstName ?? "").trim().charAt(0).toUpperCase();
  const last = (lastName ?? "").trim().charAt(0).toUpperCase();
  return `${first}${first ? "." : ""}${last}${last ? "." : ""}`.trim() || "?";
}

function intakeDobYear(birthdate: string | null): number | null {
  if (!birthdate) return null;
  const match = /^(\d{4})/.exec(birthdate);
  return match ? Number.parseInt(match[1], 10) : null;
}

function intakeSubscriberLast4(subscriberMemberId: string): string | null {
  const digits = digitsOnly(subscriberMemberId);
  if (digits.length < 4) {
    return subscriberMemberId ? `****${subscriberMemberId.slice(-4)}` : null;
  }
  return `****${digits.slice(-4)}`;
}

function mapIntakeCandidateRow(row: IntakeCandidateRow): IntakeCandidate {
  return {
    memberId: row.memberId,
    initials: intakeInitials(row.firstName, row.lastName),
    dobYear: intakeDobYear(row.birthdate),
    subscriberLast4: intakeSubscriberLast4(row.subscriberMemberId),
    groupCode: row.groupNumber,
    city: row.city,
    state: row.state,
    openCaseCount: Number(row.openCaseCount ?? 0),
    lastContactDate: row.lastContactDate,
    cob: intakeCobFromStatus(row.cobStatus),
    planTier: null,
    eligibility: intakeEligibilityFromStatus(row.memberStatus),
    role: intakeRoleFromRelationship(row.relationshipType),
    attachmentCount: Number(row.attachmentCount ?? 0),
  };
}

type MemberRow = {
  id: string;
  subscriberMemberId: string;
  firstName: string;
  lastName: string;
  birthdate: string | null;
  ssn: string | null;
  phoneNumber: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  accountGroupName: string;
  groupNumber: string;
  planName: string | null;
  planId: string | null;
  cobra: boolean;
  coverageEffectiveDate: string;
  coverageTermDate: string;
  coverageTier: Member["coverageTier"];
  relationshipType: Member["relationshipType"];
  memberStatus: Member["memberStatus"];
  cobStatus: Member["cobStatus"];
  cobCoverageTypes: unknown;
  cobDetails: string | null;
  cobReportedAt: string;
  niftyMemberId: string | null;
  glipChannelId: string | null;
  network: string | null;
  sourceTrace: unknown;
  openCaseCount: number | null;
  lastUpdatedAt: string | null;
};

type MemberCursorPayload = {
  subscriberMemberId: string;
  id: string;
};

function parseSourceTrace(value: unknown) {
  if (!value) {
    return undefined;
  }

  return typeof value === "string" ? JSON.parse(value) : value;
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function encodeMemberCursor(cursor: MemberCursorPayload) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeMemberCursor(cursor: string): MemberCursorPayload {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<MemberCursorPayload>;

    if (typeof decoded.subscriberMemberId !== "string" || typeof decoded.id !== "string") {
      throw new Error("invalid");
    }

    return {
      subscriberMemberId: decoded.subscriberMemberId,
      id: decoded.id,
    };
  } catch {
    throw new BadRequestError("Invalid cursor for members pagination");
  }
}

function mapMemberRow(row: MemberRow): Member {
  const cobCoverageTypes = row.cobCoverageTypes
    ? typeof row.cobCoverageTypes === "string"
      ? JSON.parse(row.cobCoverageTypes)
      : row.cobCoverageTypes
    : [];

  return {
    id: row.id,
    subscriberMemberId: row.subscriberMemberId,
    firstName: row.firstName,
    lastName: row.lastName,
    birthdate: row.birthdate,
    ssn: row.ssn,
    phoneNumber: row.phoneNumber,
    email: row.email,
    addressLine1: row.addressLine1,
    city: row.city,
    state: row.state,
    zipCode: row.zipCode,
    accountGroupName: row.accountGroupName,
    groupNumber: row.groupNumber,
    planName: row.planName,
    planId: row.planId,
    cobra: Boolean(row.cobra),
    coverageEffectiveDate: row.coverageEffectiveDate,
    coverageTermDate: row.coverageTermDate,
    coverageTier: row.coverageTier,
    relationshipType: row.relationshipType,
    memberStatus: row.memberStatus,
    cobStatus: row.cobStatus,
    cobCoverageTypes: cobCoverageTypes as string[],
    cobDetails: row.cobDetails,
    cobReportedAt: row.cobReportedAt,
    niftyMemberId: row.niftyMemberId,
    glipChannelId: row.glipChannelId,
    network: row.network,
    sourceTrace: parseSourceTrace(row.sourceTrace),
    openCaseCount: row.openCaseCount ?? null,
    lastUpdatedAt: row.lastUpdatedAt ?? null,
  };
}

function buildMemberSearchClauses(params: MemberListQuery) {
  const whereClauses: string[] = [];
  const values: Array<number | string> = [];

  if (params.subscriberMemberId) {
    whereClauses.push(`subscriber_member_id = $${values.push(params.subscriberMemberId)}`);
  }

  if (params.memberId) {
    whereClauses.push(`id = $${values.push(params.memberId)}`);
  }

  if (params.q) {
    const escaped = escapeLikePattern(params.q);
    const prefixPattern = `${escaped}%`;
    const containsPattern = `%${escaped}%`;
    const firstNameParam = `$${values.push(prefixPattern)}`;
    const lastNameParam = `$${values.push(prefixPattern)}`;
    const fullNameParam = `$${values.push(containsPattern)}`;
    whereClauses.push(
      "("
      + `first_name ILIKE ${firstNameParam} ESCAPE '\\' `
      + `OR last_name ILIKE ${lastNameParam} ESCAPE '\\' `
      + `OR CONCAT_WS(' ', first_name, last_name) ILIKE ${fullNameParam} ESCAPE '\\'`
      + ")",
    );
  }

  if (params.hasOpenCases) {
    whereClauses.push(
      `(SELECT COUNT(*)::int FROM cases WHERE cases.member_id = members.id AND cases.status <> 'Closed') > 0`,
    );
  }

  return {
    whereClauses,
    values,
  };
}

const MEMBER_SELECT = `
  SELECT
    id,
    subscriber_member_id AS "subscriberMemberId",
    first_name AS "firstName",
    last_name AS "lastName",
    birthdate,
    ssn,
    phone_number AS "phoneNumber",
    email,
    address_line1 AS "addressLine1",
    city,
    state,
    zip_code AS "zipCode",
    account_group_name AS "accountGroupName",
    group_number AS "groupNumber",
    plan_name AS "planName",
    plan_id AS "planId",
    cobra,
    coverage_effective_date AS "coverageEffectiveDate",
    coverage_term_date AS "coverageTermDate",
    coverage_tier AS "coverageTier",
    relationship_type AS "relationshipType",
    member_status AS "memberStatus",
    cob_status AS "cobStatus",
    cob_coverage_types AS "cobCoverageTypes",
    cob_details AS "cobDetails",
    cob_reported_at AS "cobReportedAt",
    nifty_member_id AS "niftyMemberId",
    glip_channel_id AS "glipChannelId",
    network,
    source_trace AS "sourceTrace",
    (SELECT COUNT(*)::int FROM cases WHERE cases.member_id = members.id AND cases.status <> 'Closed') AS "openCaseCount",
    (SELECT MAX(ts) FROM (
      SELECT updated_at AS ts FROM cases WHERE cases.member_id = members.id
      UNION ALL
      SELECT created_at AS ts FROM cases WHERE cases.member_id = members.id
    ) AS member_ts) AS "lastUpdatedAt"
  FROM members
`;

export class PostgresMemberRepo implements MemberRepo {
  async list(): Promise<Member[]> {
    const pool = getPostgresPool();
    const { rows } = await pool.query<MemberRow>(
      `
        ${MEMBER_SELECT}
        ORDER BY subscriber_member_id ASC, id ASC
      `,
    );

    return rows.map(mapMemberRow);
  }

  async listPage(params: MemberListQuery): Promise<CursorPageResult<Member>> {
    const pool = getPostgresPool();
    const { whereClauses, values } = buildMemberSearchClauses(params);

    if (params.cursor) {
      const cursor = decodeMemberCursor(params.cursor);
      const subscriberMemberIdParam = `$${values.push(cursor.subscriberMemberId)}`;
      const repeatedSubscriberMemberIdParam = `$${values.push(cursor.subscriberMemberId)}`;
      const idParam = `$${values.push(cursor.id)}`;
      whereClauses.push(
        `(subscriber_member_id > ${subscriberMemberIdParam} OR (subscriber_member_id = ${repeatedSubscriberMemberIdParam} AND id > ${idParam}))`,
      );
    }

    const limitParam = `$${values.push(params.limit + 1)}`;
    const { rows } = await pool.query<MemberRow>(
      `
        ${MEMBER_SELECT}
        ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
        ORDER BY subscriber_member_id ASC, id ASC
        LIMIT ${limitParam}
      `,
      values,
    );

    const hasNext = rows.length > params.limit;
    const pageRows = hasNext ? rows.slice(0, params.limit) : rows;
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows.map(mapMemberRow),
      pageInfo: {
        hasNext,
        nextCursor: hasNext && lastRow
          ? encodeMemberCursor({
              subscriberMemberId: lastRow.subscriberMemberId,
              id: lastRow.id,
            })
          : null,
      },
    };
  }

  async getById(id: string): Promise<Member | null> {
    const pool = getPostgresPool();
    const { rows } = await pool.query<MemberRow>(
      `
        ${MEMBER_SELECT}
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );

    return rows[0] ? mapMemberRow(rows[0]) : null;
  }

  async searchIntakeCandidates(query: IntakeSearchQuery): Promise<IntakeCandidate[]> {
    const { q, type, limit } = query;
    const trimmed = q.trim();
    if (!trimmed) return [];
    if (type === "caseId" || type === "claimId") return [];

    const pool = getPostgresPool();
    const queryDigits = digitsOnly(trimmed);
    const looksNumeric = queryDigits.length >= 4 && queryDigits.length === trimmed.replace(/[\s\-().+]/g, "").length;

    const whereClauses: string[] = [];
    const values: Array<string | number> = [];

    const addParam = (value: string | number) => `$${values.push(value)}`;

    if (type === "phone" || (type === "auto" && looksNumeric && queryDigits.length >= 7)) {
      whereClauses.push(
        `REGEXP_REPLACE(COALESCE(phone_number, ''), '\\D', '', 'g') LIKE '%' || ${addParam(queryDigits)}`,
      );
    } else if (type === "memberId") {
      const escaped = escapeLikePattern(trimmed);
      whereClauses.push(`(id ILIKE ${addParam(`${escaped}%`)} OR subscriber_member_id ILIKE ${addParam(`${escaped}%`)})`);
    } else if (type === "name") {
      const escaped = escapeLikePattern(trimmed);
      whereClauses.push(
        `(first_name ILIKE ${addParam(`${escaped}%`)} OR last_name ILIKE ${addParam(`${escaped}%`)} OR (first_name || ' ' || last_name) ILIKE ${addParam(`%${escaped}%`)})`,
      );
    } else {
      const escaped = escapeLikePattern(trimmed);
      whereClauses.push(
        `(id ILIKE ${addParam(`${escaped}%`)} OR subscriber_member_id ILIKE ${addParam(`${escaped}%`)} OR first_name ILIKE ${addParam(`${escaped}%`)} OR last_name ILIKE ${addParam(`${escaped}%`)} OR (first_name || ' ' || last_name) ILIKE ${addParam(`%${escaped}%`)})`,
      );
    }

    const limitParam = addParam(limit);
    const sql = `
      SELECT
        m.id AS "memberId",
        m.first_name AS "firstName",
        m.last_name AS "lastName",
        m.birthdate,
        m.subscriber_member_id AS "subscriberMemberId",
        m.group_number AS "groupNumber",
        m.city,
        m.state,
        m.cob_status AS "cobStatus",
        m.member_status AS "memberStatus",
        m.relationship_type AS "relationshipType",
        (SELECT COUNT(*)::int FROM cases WHERE cases.member_id = m.id AND cases.status <> 'Closed') AS "openCaseCount",
        (
          SELECT COUNT(*)::int
          FROM case_attachments
          JOIN cases ON cases.id = case_attachments.case_id
          WHERE cases.member_id = m.id
        ) AS "attachmentCount",
        (
          SELECT MAX(ts)
          FROM (
            SELECT updated_at AS ts FROM cases WHERE cases.member_id = m.id
            UNION ALL
            SELECT created_at AS ts FROM cases WHERE cases.member_id = m.id
            UNION ALL
            SELECT case_timeline.timestamp AS ts
              FROM case_timeline
              JOIN cases ON cases.id = case_timeline.case_id
              WHERE cases.member_id = m.id
          ) AS member_activity
        ) AS "lastContactDate"
      FROM members m
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY m.subscriber_member_id ASC, m.id ASC
      LIMIT ${limitParam}
    `;

    const { rows } = await pool.query<IntakeCandidateRow>(sql, values);
    return rows.map(mapIntakeCandidateRow);
  }
}
