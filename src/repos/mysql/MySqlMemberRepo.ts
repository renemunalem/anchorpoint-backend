import { MemberRepo } from "../MemberRepo";
import { Member } from "../../types/models";
import { RowDataPacket } from "mysql2/promise";
import {
  BadRequestError,
  CursorPageResult,
  IntakeCandidate,
  IntakeCandidateCob,
  IntakeCandidateEligibility,
  IntakeCandidateRole,
  IntakeSearchQuery,
  MemberListQuery,
  MemberSortField,
  SortDir,
} from "../../types/http";
import { getMySqlPool } from "./client";

type IntakeCandidateRow = RowDataPacket & {
  memberId: string;
  firstName: string;
  lastName: string;
  birthdate: string | null;
  subscriberMemberId: string;
  groupNumber: string;
  city: string | null;
  state: string | null;
  openCaseCount: number | string | null;
  lastContactDate: string | null;
  cobStatus: Member["cobStatus"] | null;
  memberStatus: Member["memberStatus"] | null;
  relationshipType: Member["relationshipType"] | null;
  attachmentCount: number | string | null;
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

type MemberRow = RowDataPacket & {
  id: string;
  subscriberMemberId: string;
  firstName: string;
  lastName: string;
  birthdate: string;
  ssn: string;
  phoneNumber: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  accountGroupName: string;
  groupNumber: string;
  planName: string;
  planId: string;
  cobra: number;
  coverageEffectiveDate: string;
  coverageTermDate: string;
  coverageTier: Member["coverageTier"];
  relationshipType: Member["relationshipType"];
  memberStatus: Member["memberStatus"];
  cobStatus: Member["cobStatus"];
  cobCoverageTypes: string | null;
  cobDetails: string;
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

type SortedMemberCursorPayload = {
  kind: "sorted";
  field: MemberSortField;
  dir: SortDir;
  value: number | string | null;
  id: string;
};

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildMemberSearchClauses(params: MemberListQuery) {
  const whereClauses: string[] = [];
  const values: Array<number | string> = [];

  if (params.subscriberMemberId) {
    whereClauses.push("subscriber_member_id = ?");
    values.push(params.subscriberMemberId);
  }

  if (params.memberId) {
    whereClauses.push("id = ?");
    values.push(params.memberId);
  }

  if (params.q) {
    const escaped = escapeLikePattern(params.q);
    const prefixPattern = `${escaped}%`;
    const containsPattern = `%${escaped}%`;
    whereClauses.push(
      "("
      + "first_name LIKE ? ESCAPE '\\\\' "
      + "OR last_name LIKE ? ESCAPE '\\\\' "
      + "OR CONCAT_WS(' ', first_name, last_name) LIKE ? ESCAPE '\\\\'"
      + ")",
    );
    values.push(prefixPattern, prefixPattern, containsPattern);
  }

  if (params.hasOpenCases) {
    whereClauses.push(
      `(SELECT COUNT(*) FROM cases WHERE cases.member_id = members.id AND cases.status <> 'Closed') > 0`,
    );
  }

  return {
    whereClauses,
    values,
  };
}

function parseSourceTrace(value: unknown) {
  if (!value) {
    return undefined;
  }

  return typeof value === "string" ? JSON.parse(value) : value;
}

function mapMemberRow(row: MemberRow): Member {
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
    cobCoverageTypes: row.cobCoverageTypes ? JSON.parse(row.cobCoverageTypes) : [],
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

function encodeSortedMemberCursor(cursor: SortedMemberCursorPayload) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSortedMemberCursor(cursor: string): SortedMemberCursorPayload {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<SortedMemberCursorPayload>;

    if (
      decoded.kind !== "sorted"
      || (decoded.field !== "openCaseCount" && decoded.field !== "lastUpdatedAt")
      || (decoded.dir !== "asc" && decoded.dir !== "desc")
      || typeof decoded.id !== "string"
    ) {
      throw new Error("invalid");
    }

    return decoded as SortedMemberCursorPayload;
  } catch {
    throw new BadRequestError("Invalid cursor for members pagination");
  }
}

function buildMySqlSortedCursorClause(
  cursor: SortedMemberCursorPayload,
  values: Array<string | number>,
): string {
  const { field, dir, value, id } = cursor;

  if (field === "openCaseCount") {
    const numVal = (value as number | null) ?? 0;
    values.push(numVal, numVal, id);
    const col = "m.openCaseCount";
    return dir === "desc"
      ? `(${col} < ? OR (${col} = ? AND m.id > ?))`
      : `(${col} > ? OR (${col} = ? AND m.id > ?))`;
  }

  // lastUpdatedAt — nulls last (MySQL: use IS NULL check)
  const col = "m.lastUpdatedAt";
  const strVal = value as string | null;

  if (strVal === null) {
    values.push(id);
    return `(${col} IS NULL AND m.id > ?)`;
  }

  values.push(strVal, strVal, id);
  return dir === "desc"
    ? `(${col} < ? OR ${col} IS NULL OR (${col} = ? AND m.id > ?))`
    : `(${col} > ? OR ${col} IS NULL OR (${col} = ? AND m.id > ?))`;
}

export class MySqlMemberRepo implements MemberRepo {
  async list(): Promise<Member[]> {
    const pool = getMySqlPool();
    const [rows] = await pool.query<MemberRow[]>(
      `
        SELECT
          id,
          subscriber_member_id AS subscriberMemberId,
          first_name AS firstName,
          last_name AS lastName,
          birthdate,
          ssn,
          phone_number AS phoneNumber,
          email,
          address_line1 AS addressLine1,
          city,
          state,
          zip_code AS zipCode,
          account_group_name AS accountGroupName,
          group_number AS groupNumber,
          plan_name AS planName,
          plan_id AS planId,
          cobra,
          coverage_effective_date AS coverageEffectiveDate,
          coverage_term_date AS coverageTermDate,
          coverage_tier AS coverageTier,
          relationship_type AS relationshipType,
          member_status AS memberStatus,
          cob_status AS cobStatus,
          cob_coverage_types AS cobCoverageTypes,
          cob_details AS cobDetails,
          cob_reported_at AS cobReportedAt,
          nifty_member_id AS niftyMemberId,
          glip_channel_id AS glipChannelId,
          network,
          source_trace AS sourceTrace,
          (SELECT COUNT(*) FROM cases WHERE cases.member_id = members.id AND cases.status <> 'Closed') AS openCaseCount,
          (SELECT MAX(ts) FROM (
            SELECT updated_at AS ts FROM cases WHERE cases.member_id = members.id
            UNION ALL
            SELECT created_at AS ts FROM cases WHERE cases.member_id = members.id
          ) AS member_ts) AS lastUpdatedAt
        FROM members
        ORDER BY subscriber_member_id ASC, id ASC
      `,
    );

    return rows.map(mapMemberRow);
  }

  async listPage(params: MemberListQuery): Promise<CursorPageResult<Member>> {
    if (params.sortBy) {
      return this._listPageSorted(params as MemberListQuery & { sortBy: MemberSortField });
    }

    const pool = getMySqlPool();
    const { whereClauses, values } = buildMemberSearchClauses(params);

    if (params.cursor) {
      const cursor = decodeMemberCursor(params.cursor);
      whereClauses.push("(subscriber_member_id > ? OR (subscriber_member_id = ? AND id > ?))");
      values.push(cursor.subscriberMemberId, cursor.subscriberMemberId, cursor.id);
    }

    values.push(params.limit + 1);

    const [rows] = await pool.query<MemberRow[]>(
      `
        SELECT
          id,
          subscriber_member_id AS subscriberMemberId,
          first_name AS firstName,
          last_name AS lastName,
          birthdate,
          ssn,
          phone_number AS phoneNumber,
          email,
          address_line1 AS addressLine1,
          city,
          state,
          zip_code AS zipCode,
          account_group_name AS accountGroupName,
          group_number AS groupNumber,
          plan_name AS planName,
          plan_id AS planId,
          cobra,
          coverage_effective_date AS coverageEffectiveDate,
          coverage_term_date AS coverageTermDate,
          coverage_tier AS coverageTier,
          relationship_type AS relationshipType,
          member_status AS memberStatus,
          cob_status AS cobStatus,
          cob_coverage_types AS cobCoverageTypes,
          cob_details AS cobDetails,
          cob_reported_at AS cobReportedAt,
          nifty_member_id AS niftyMemberId,
          glip_channel_id AS glipChannelId,
          network,
          source_trace AS sourceTrace,
          (SELECT COUNT(*) FROM cases WHERE cases.member_id = members.id AND cases.status <> 'Closed') AS openCaseCount,
          (SELECT MAX(ts) FROM (
            SELECT updated_at AS ts FROM cases WHERE cases.member_id = members.id
            UNION ALL
            SELECT created_at AS ts FROM cases WHERE cases.member_id = members.id
          ) AS member_ts) AS lastUpdatedAt
        FROM members
        ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
        ORDER BY subscriber_member_id ASC, id ASC
        LIMIT ?
      `,
      values,
    );

    const hasNext = rows.length > params.limit;
    const pageRows = hasNext ? rows.slice(0, params.limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];

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

  private async _listPageSorted(
    params: MemberListQuery & { sortBy: MemberSortField },
  ): Promise<CursorPageResult<Member>> {
    const pool = getMySqlPool();
    const sortDir = params.sortDir ?? "desc";
    const values: Array<string | number> = [];
    const whereClauses: string[] = [];

    if (params.subscriberMemberId) {
      whereClauses.push("m.subscriberMemberId = ?");
      values.push(params.subscriberMemberId);
    }
    if (params.memberId) {
      whereClauses.push("m.id = ?");
      values.push(params.memberId);
    }
    if (params.q) {
      const escaped = escapeLikePattern(params.q);
      whereClauses.push(
        "(m.firstName LIKE ? ESCAPE '\\\\' OR m.lastName LIKE ? ESCAPE '\\\\' OR CONCAT_WS(' ', m.firstName, m.lastName) LIKE ? ESCAPE '\\\\')",
      );
      values.push(`${escaped}%`, `${escaped}%`, `%${escaped}%`);
    }
    if (params.hasOpenCases) {
      whereClauses.push("m.openCaseCount > 0");
    }
    if (params.cursor) {
      const cursor = decodeSortedMemberCursor(params.cursor);
      whereClauses.push(buildMySqlSortedCursorClause(cursor, values));
    }

    const orderDir = sortDir.toUpperCase();
    // MySQL does not support NULLS LAST — use `col IS NULL ASC` to push nulls last
    const orderExpr = params.sortBy === "openCaseCount"
      ? `m.openCaseCount ${orderDir}, m.id ASC`
      : `m.lastUpdatedAt IS NULL ASC, m.lastUpdatedAt ${orderDir}, m.id ASC`;

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    values.push(params.limit + 1);

    const [rows] = await pool.query<MemberRow[]>(
      `
        SELECT * FROM (
          SELECT
            id,
            subscriber_member_id AS subscriberMemberId,
            first_name AS firstName,
            last_name AS lastName,
            birthdate,
            ssn,
            phone_number AS phoneNumber,
            email,
            address_line1 AS addressLine1,
            city,
            state,
            zip_code AS zipCode,
            account_group_name AS accountGroupName,
            group_number AS groupNumber,
            plan_name AS planName,
            plan_id AS planId,
            cobra,
            coverage_effective_date AS coverageEffectiveDate,
            coverage_term_date AS coverageTermDate,
            coverage_tier AS coverageTier,
            relationship_type AS relationshipType,
            member_status AS memberStatus,
            cob_status AS cobStatus,
            cob_coverage_types AS cobCoverageTypes,
            cob_details AS cobDetails,
            cob_reported_at AS cobReportedAt,
            nifty_member_id AS niftyMemberId,
            glip_channel_id AS glipChannelId,
            network,
            source_trace AS sourceTrace,
            (SELECT COUNT(*) FROM cases WHERE cases.member_id = members.id AND cases.status <> 'Closed') AS openCaseCount,
            (SELECT MAX(ts) FROM (
              SELECT updated_at AS ts FROM cases WHERE cases.member_id = members.id
              UNION ALL
              SELECT created_at AS ts FROM cases WHERE cases.member_id = members.id
            ) AS member_ts) AS lastUpdatedAt
          FROM members
        ) AS m
        ${whereClause}
        ORDER BY ${orderExpr}
        LIMIT ?
      `,
      values,
    );

    const hasNext = rows.length > params.limit;
    const pageRows = hasNext ? rows.slice(0, params.limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map(mapMemberRow),
      pageInfo: {
        hasNext,
        nextCursor: hasNext && lastRow
          ? encodeSortedMemberCursor({
              kind: "sorted",
              field: params.sortBy,
              dir: sortDir,
              value: params.sortBy === "openCaseCount"
                ? (lastRow.openCaseCount ?? null)
                : (lastRow.lastUpdatedAt ?? null),
              id: lastRow.id,
            })
          : null,
      },
    };
  }

  async getById(id: string): Promise<Member | null> {
    const pool = getMySqlPool();
    const [rows] = await pool.query<MemberRow[]>(
      `
        SELECT
          id,
          subscriber_member_id AS subscriberMemberId,
          first_name AS firstName,
          last_name AS lastName,
          birthdate,
          ssn,
          phone_number AS phoneNumber,
          email,
          address_line1 AS addressLine1,
          city,
          state,
          zip_code AS zipCode,
          account_group_name AS accountGroupName,
          group_number AS groupNumber,
          plan_name AS planName,
          plan_id AS planId,
          cobra,
          coverage_effective_date AS coverageEffectiveDate,
          coverage_term_date AS coverageTermDate,
          coverage_tier AS coverageTier,
          relationship_type AS relationshipType,
          member_status AS memberStatus,
          cob_status AS cobStatus,
          cob_coverage_types AS cobCoverageTypes,
          cob_details AS cobDetails,
          cob_reported_at AS cobReportedAt,
          nifty_member_id AS niftyMemberId,
          glip_channel_id AS glipChannelId,
          network,
          source_trace AS sourceTrace
        FROM members
        WHERE id = ?
        LIMIT 1
      `,
      [id],
    );

    const row = rows[0];
    return row ? mapMemberRow(row) : null;
  }

  async searchIntakeCandidates(query: IntakeSearchQuery): Promise<IntakeCandidate[]> {
    const { q, type, limit } = query;
    const trimmed = q.trim();
    if (!trimmed) return [];
    if (type === "caseId" || type === "claimId") return [];

    const pool = getMySqlPool();
    const queryDigits = digitsOnly(trimmed);
    const looksNumeric = queryDigits.length >= 4 && queryDigits.length === trimmed.replace(/[\s\-().+]/g, "").length;

    const whereClauses: string[] = [];
    const values: Array<string | number> = [];

    if (type === "phone" || (type === "auto" && looksNumeric && queryDigits.length >= 7)) {
      whereClauses.push(
        `REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '') LIKE CONCAT('%', ?)`,
      );
      values.push(queryDigits);
    } else if (type === "memberId") {
      const escaped = escapeLikePattern(trimmed);
      whereClauses.push(`(id LIKE ? OR subscriber_member_id LIKE ?)`);
      values.push(`${escaped}%`, `${escaped}%`);
    } else if (type === "name") {
      const escaped = escapeLikePattern(trimmed);
      whereClauses.push(
        `(first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ?)`,
      );
      values.push(`${escaped}%`, `${escaped}%`, `%${escaped}%`);
    } else {
      const escaped = escapeLikePattern(trimmed);
      whereClauses.push(
        `(id LIKE ? OR subscriber_member_id LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ?)`,
      );
      values.push(`${escaped}%`, `${escaped}%`, `${escaped}%`, `${escaped}%`, `%${escaped}%`);
    }

    values.push(limit);

    const sql = `
      SELECT
        m.id AS memberId,
        m.first_name AS firstName,
        m.last_name AS lastName,
        m.birthdate,
        m.subscriber_member_id AS subscriberMemberId,
        m.group_number AS groupNumber,
        m.city,
        m.state,
        m.cob_status AS cobStatus,
        m.member_status AS memberStatus,
        m.relationship_type AS relationshipType,
        (SELECT COUNT(*) FROM cases WHERE cases.member_id = m.id AND cases.status <> 'Closed') AS openCaseCount,
        (
          SELECT COUNT(*)
          FROM case_attachments
          JOIN cases ON cases.id = case_attachments.case_id
          WHERE cases.member_id = m.id
        ) AS attachmentCount,
        (
          SELECT MAX(ts) FROM (
            SELECT updated_at AS ts FROM cases WHERE cases.member_id = m.id
            UNION ALL
            SELECT created_at AS ts FROM cases WHERE cases.member_id = m.id
            UNION ALL
            SELECT case_timeline.timestamp AS ts
              FROM case_timeline
              JOIN cases ON cases.id = case_timeline.case_id
              WHERE cases.member_id = m.id
          ) AS member_activity
        ) AS lastContactDate
      FROM members m
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY m.subscriber_member_id ASC, m.id ASC
      LIMIT ?
    `;

    const [rows] = await pool.query<IntakeCandidateRow[]>(sql, values);
    return rows.map(mapIntakeCandidateRow);
  }
}
