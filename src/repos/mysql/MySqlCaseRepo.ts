import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { CaseRepo } from "../CaseRepo";
import { BadRequestError, CaseListQuery, CaseStatusCounts, ConflictError, CursorPageResult } from "../../types/http";
import { CallDirection, CaseAttachmentSummary, CaseDetail, CaseOrigin, CaseStatus, CaseSummary, TimelineEntry } from "../../types/models";
import { getMySqlPool } from "./client";
import { env } from "../../config/env";

const CASE_DETAIL_MEMBER_SELECT = `
  SELECT
    id,
    subscriber_member_id AS subscriberMemberId,
    first_name AS firstName,
    last_name AS lastName,
    account_group_name AS accountGroupName,
    group_number AS groupNumber,
    plan_name AS planName,
    plan_id AS planId,
    coverage_tier AS coverageTier,
    relationship_type AS relationshipType,
    member_status AS memberStatus,
    cob_status AS cobStatus
  FROM members
  WHERE id = ?
  LIMIT 1
`;

type CaseRow = RowDataPacket & {
  id: string;
  caseNumber: string;
  memberId: string;
  memberName: string;
  caseType: CaseSummary["caseType"];
  status: CaseStatus;
  actionItem: string;
  urgencyLabel: string;
  urgencyTone: CaseSummary["urgency"]["tone"];
  createdAt: string;
  updatedAt: string;
  agent: string;
  groupNumber: string;
  claimNumber: string;
  priority: CaseSummary["priority"];
  description: string | null;
  closedAt: string | null;
  fcr: string | null;
  firstCallResolution: number | null;
  resolution: string | null;
  resolutionDetails: string | null;
  origin: CaseOrigin | null;
  attachmentCount: number | string | null;
  dueAt: string | null;
  sourceTrace: unknown;
};

function parseSourceTrace(value: unknown) {
  if (!value) {
    return undefined;
  }

  return typeof value === "string" ? JSON.parse(value) : value;
}

function parseTimelineSourceTrace(value: unknown) {
  const parsed = parseSourceTrace(value);
  if (
    parsed
    && typeof parsed === "object"
    && typeof (parsed as { source?: unknown }).source === "string"
    && typeof (parsed as { externalId?: unknown }).externalId === "string"
  ) {
    return parsed;
  }

  return undefined;
}

type TimelineRow = RowDataPacket & {
  id: string;
  type: TimelineEntry["type"];
  author: string;
  timestamp: string;
  inReplyToId: string | null;
  callDirection: CallDirection | null;
  callDurationSeconds: number | null;
  taskDueDate: string | null;
  text: string | null;
  toStatus: CaseStatus | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  bcc: string | null;
  sourceTrace: unknown;
};

type AttachmentRow = RowDataPacket & {
  id: string;
  kind: CaseAttachmentSummary["kind"];
  linkKind: "case-direct" | "related-record";
  name: string;
  title: string | null;
  description: string | null;
  mimeType: string | null;
  fileType: string | null;
  sizeBytes: number | null;
  isPrivate: number | null;
  createdAt: string | null;
  owner: string | null;
  exportRelativePath: string | null;
  sourceTrace: unknown;
};

type CaseMemberRow = RowDataPacket & NonNullable<CaseDetail["member"]>;
type CaseStatusCountRow = RowDataPacket & {
  status: CaseStatus;
  count: number;
};

type CaseCursorPayload = {
  createdAt: string;
  id: string;
};

function buildCaseSearchClauses(params: CaseListQuery) {
  const whereClauses: string[] = [];
  const values: Array<number | string> = [];

  if (params.caseNumber) {
    whereClauses.push("case_number = ?");
    values.push(params.caseNumber);
  }

  if (params.caseId) {
    whereClauses.push("id = ?");
    values.push(params.caseId);
  }

  if (params.memberId) {
    whereClauses.push("member_id = ?");
    values.push(params.memberId);
  }

  if (params.groupNumber) {
    whereClauses.push("group_number = ?");
    values.push(params.groupNumber);
  }

  if (params.claimNumber) {
    whereClauses.push("claim_number = ?");
    values.push(params.claimNumber);
  }

  if (params.q) {
    const pattern = `%${params.q.replace(/[\\%_]/g, "\\$&")}%`;
    whereClauses.push(
      "(id LIKE ? OR case_number LIKE ? OR member_name LIKE ? OR member_id LIKE ? OR group_number LIKE ? OR COALESCE(claim_number, '') LIKE ?)",
    );
    values.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  if (params.statuses && params.statuses.length > 0) {
    whereClauses.push(`status IN (${params.statuses.map(() => "?").join(",")})`);
    values.push(...params.statuses);
  }

  return {
    whereClauses,
    values,
  };
}

function mapCaseSummary(row: CaseRow): CaseSummary {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    memberId: row.memberId,
    memberName: row.memberName,
    caseType: row.caseType,
    status: row.status,
    actionItem: row.actionItem,
    urgency: {
      label: row.urgencyLabel,
      tone: row.urgencyTone,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    agent: row.agent,
    groupNumber: row.groupNumber,
    claimNumber: row.claimNumber,
    priority: row.priority,
    description: row.description ?? undefined,
    closedAt: row.closedAt ?? undefined,
    fcr: row.fcr ? row.fcr.toLowerCase() : (row.fcr ?? undefined),
    firstCallResolution: row.firstCallResolution === null ? null : Boolean(row.firstCallResolution),
    resolution: row.resolution ?? undefined,
    resolutionDetails: row.resolutionDetails ?? undefined,
    origin: row.origin ?? "phone",
    dueAt: row.dueAt ?? null,
    attachmentCount: Number(row.attachmentCount ?? 0),
    sourceTrace: parseSourceTrace(row.sourceTrace),
  };
}

function mapTimelineRow(row: TimelineRow): TimelineEntry {
  return {
    id: row.id,
    type: row.type,
    author: row.author,
    timestamp: row.timestamp,
    inReplyToId: row.inReplyToId ?? undefined,
    callDirection: row.callDirection ?? undefined,
    callDurationSeconds: row.callDurationSeconds ?? undefined,
    taskDueDate: row.taskDueDate ?? undefined,
    text: row.text ?? undefined,
    toStatus: row.toStatus ?? undefined,
    subject: row.subject ?? undefined,
    from: row.from ?? undefined,
    to: row.to ?? undefined,
    cc: row.cc ?? undefined,
    bcc: row.bcc ?? undefined,
    sourceTrace: parseTimelineSourceTrace(row.sourceTrace),
  };
}

function mapAttachmentRow(row: AttachmentRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    mimeType: row.mimeType ?? undefined,
    fileType: row.fileType ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    isPrivate: row.isPrivate === null ? undefined : Boolean(row.isPrivate),
    createdAt: row.createdAt ?? undefined,
    owner: row.owner ?? undefined,
    exportRelativePath: row.exportRelativePath ?? undefined,
    sourceTrace: parseSourceTrace(row.sourceTrace),
  };
}

function encodeCaseCursor(cursor: CaseCursorPayload) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCaseCursor(cursor: string): CaseCursorPayload {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CaseCursorPayload>;

    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") {
      throw new Error("invalid");
    }

    return {
      createdAt: decoded.createdAt,
      id: decoded.id,
    };
  } catch {
    throw new BadRequestError("Invalid cursor for cases pagination");
  }
}

function emptyCaseStatusCounts(): CaseStatusCounts {
  return {
    open: 0,
    waiting: 0,
    escalated: 0,
    closed: 0,
  };
}

async function getCaseSummaryRow(id: string): Promise<CaseRow | null> {
  const pool = getMySqlPool();
  const [rows] = await pool.query<CaseRow[]>(
    `
      SELECT
        id,
        case_number AS caseNumber,
        member_id AS memberId,
        member_name AS memberName,
        case_type AS caseType,
        status,
        action_item AS actionItem,
        urgency_label AS urgencyLabel,
        urgency_tone AS urgencyTone,
        created_at AS createdAt,
        updated_at AS updatedAt,
        agent,
        group_number AS groupNumber,
        claim_number AS claimNumber,
        priority,
        description,
        closed_at AS closedAt,
        fcr,
        resolution,
        resolution_details AS resolutionDetails,
        origin,
        due_at AS dueAt,
        (SELECT COUNT(*) FROM case_attachments WHERE case_attachments.case_id = cases.id) AS attachmentCount,
        source_trace AS sourceTrace
      FROM cases
      WHERE id = ?
      LIMIT 1
    `,
    [id],
  );

  return rows[0] ?? null;
}

async function getTimelineRows(caseId: string): Promise<TimelineEntry[]> {
  const pool = getMySqlPool();
  const [rows] = await pool.query<TimelineRow[]>(
    `
      SELECT
        id,
        type,
        author,
        timestamp,
        JSON_UNQUOTE(JSON_EXTRACT(source_trace, '$.inReplyToId')) AS inReplyToId,
        JSON_UNQUOTE(JSON_EXTRACT(source_trace, '$.callDirection')) AS callDirection,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(source_trace, '$.callDurationSeconds')) AS SIGNED) AS callDurationSeconds,
        JSON_UNQUOTE(JSON_EXTRACT(source_trace, '$.taskDueDate')) AS taskDueDate,
        text,
        to_status AS toStatus,
        subject,
        sender_from AS \`from\`,
        recipient_to AS \`to\`,
        recipient_cc AS cc,
        recipient_bcc AS bcc,
        source_trace AS sourceTrace
      FROM case_timeline
      WHERE case_id = ?
      ORDER BY timestamp ASC, id ASC
    `,
    [caseId],
  );

  return rows.map(mapTimelineRow);
}

async function getAttachmentRows(caseId: string) {
  const pool = getMySqlPool();
  const [rows] = await pool.query<AttachmentRow[]>(
    `
      SELECT
        id,
        kind,
        link_kind AS linkKind,
        name,
        title,
        description,
        mime_type AS mimeType,
        file_type AS fileType,
        size_bytes AS sizeBytes,
        is_private AS isPrivate,
        created_at AS createdAt,
        owner,
        export_relative_path AS exportRelativePath,
        source_trace AS sourceTrace
      FROM case_attachments
      WHERE case_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [caseId],
  );

  return rows.map(mapAttachmentRow);
}

async function getCaseMember(caseId: string): Promise<CaseDetail["member"] | undefined> {
  const summary = await getCaseSummaryRow(caseId);

  if (!summary) {
    return undefined;
  }

  const pool = getMySqlPool();
  const [rows] = await pool.query<CaseMemberRow[]>(CASE_DETAIL_MEMBER_SELECT, [summary.memberId]);
  return rows[0] ?? undefined;
}

async function hydrateCase(id: string): Promise<CaseDetail | null> {
  const summary = await getCaseSummaryRow(id);

  if (!summary) {
    return null;
  }

  const [timeline, attachments, member] = await Promise.all([
    getTimelineRows(id),
    getAttachmentRows(id),
    getCaseMember(id),
  ]);

  return {
    ...mapCaseSummary(summary),
    timeline,
    attachments,
    member,
  };
}

export class MySqlCaseRepo implements CaseRepo {
  async list(): Promise<CaseSummary[]> {
    const pool = getMySqlPool();
    const [rows] = await pool.query<CaseRow[]>(
      `
        SELECT
          id,
          case_number AS caseNumber,
          member_id AS memberId,
          member_name AS memberName,
          case_type AS caseType,
          status,
          action_item AS actionItem,
          urgency_label AS urgencyLabel,
          urgency_tone AS urgencyTone,
          created_at AS createdAt,
          updated_at AS updatedAt,
          agent,
          group_number AS groupNumber,
          claim_number AS claimNumber,
          priority,
          description,
          closed_at AS closedAt,
          fcr,
          first_call_resolution AS firstCallResolution,
          resolution,
          resolution_details AS resolutionDetails,
          origin,
          (SELECT COUNT(*) FROM case_attachments WHERE case_attachments.case_id = cases.id) AS attachmentCount,
          source_trace AS sourceTrace
        FROM cases
        ORDER BY created_at DESC, id DESC
      `,
    );

    return rows.map(mapCaseSummary);
  }

  async listPage(params: CaseListQuery): Promise<CursorPageResult<CaseSummary>> {
    const pool = getMySqlPool();
    const { whereClauses, values } = buildCaseSearchClauses(params);

    if (params.cursor) {
      const cursor = decodeCaseCursor(params.cursor);
      whereClauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }

    values.push(params.limit + 1);

    const [rows] = await pool.query<CaseRow[]>(
      `
        SELECT
          id,
          case_number AS caseNumber,
          member_id AS memberId,
          member_name AS memberName,
          case_type AS caseType,
          status,
          action_item AS actionItem,
          urgency_label AS urgencyLabel,
          urgency_tone AS urgencyTone,
          created_at AS createdAt,
          updated_at AS updatedAt,
          agent,
          group_number AS groupNumber,
          claim_number AS claimNumber,
          priority,
          description,
          closed_at AS closedAt,
          fcr,
          first_call_resolution AS firstCallResolution,
          resolution,
          resolution_details AS resolutionDetails,
          origin,
          (SELECT COUNT(*) FROM case_attachments WHERE case_attachments.case_id = cases.id) AS attachmentCount,
          source_trace AS sourceTrace
        FROM cases
        ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      values,
    );

    const hasNext = rows.length > params.limit;
    const pageRows = hasNext ? rows.slice(0, params.limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map(mapCaseSummary),
      pageInfo: {
        hasNext,
        nextCursor: hasNext && lastRow
          ? encodeCaseCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
          : null,
      },
    };
  }

  async countByStatus(): Promise<CaseStatusCounts> {
    const pool = getMySqlPool();
    const [rows] = await pool.query<CaseStatusCountRow[]>(
      `
        SELECT status, COUNT(*) AS count
        FROM cases
        GROUP BY status
      `,
    );

    return rows.reduce((counts, row) => {
      if (row.status === "Open") {
        counts.open = Number(row.count);
      } else if (row.status === "Waiting") {
        counts.waiting = Number(row.count);
      } else if (row.status === "Escalated") {
        counts.escalated = Number(row.count);
      } else if (row.status === "Closed") {
        counts.closed = Number(row.count);
      }

      return counts;
    }, emptyCaseStatusCounts());
  }

  async getById(id: string): Promise<CaseDetail | null> {
    return hydrateCase(id);
  }

  async assign(id: string, agent: string, author: string): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [previousRows] = await connection.execute<RowDataPacket[]>(
        `SELECT agent FROM cases WHERE id = ? LIMIT 1`,
        [id],
      );

      if ((previousRows as Array<unknown>).length === 0) {
        await connection.rollback();
        return null;
      }

      const previousAgent = (previousRows as Array<{ agent: string | null }>)[0].agent ?? "";

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET agent = ?, updated_at = ? WHERE id = ?`,
        [agent, updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      if (previousAgent !== agent) {
        const text = `Case assigned ${previousAgent ? `from ${previousAgent} ` : ""}to ${agent || "(unassigned)"}.`;
        await connection.execute<ResultSetHeader>(
          `
            INSERT INTO case_timeline (id, case_id, type, author, timestamp, sender_from, recipient_to, text)
            VALUES (?, ?, 'assignment', ?, ?, ?, ?, ?)
          `,
          [timelineId, id, author, updatedAt, previousAgent || null, agent || null, text],
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async addNote(id: string, text: string, author: string): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET updated_at = ? WHERE id = ?`,
        [updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text)
          VALUES (?, ?, 'note', ?, ?, ?)
        `,
        [timelineId, id, author, updatedAt, text],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async addTask(
    id: string,
    title: string,
    dueDate: string | null,
    author: string,
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const text = `Task created: ${title}${dueDate ? ` (due ${dueDate})` : ""}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET updated_at = ? WHERE id = ?`,
        [updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, source_trace)
          VALUES (?, ?, 'task', ?, ?, ?, ?)
        `,
        [
          timelineId,
          id,
          author,
          updatedAt,
          text,
          dueDate ? JSON.stringify({ taskDueDate: dueDate }) : null,
        ],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async addCall(
    id: string,
    summary: string,
    outcome: string | null,
    author: string,
    metadata?: {
      direction?: CallDirection | null;
      durationSeconds?: number | null;
    },
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const text = `Call logged${outcome ? ` — ${outcome}` : ""}: ${summary}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET updated_at = ? WHERE id = ?`,
        [updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, source_trace)
          VALUES (?, ?, 'call', ?, ?, ?, ?)
        `,
        [
          timelineId,
          id,
          author,
          updatedAt,
          text,
          metadata?.direction || metadata?.durationSeconds !== null && metadata?.durationSeconds !== undefined
            ? JSON.stringify({
                ...(metadata?.direction ? { callDirection: metadata.direction } : {}),
                ...(metadata?.durationSeconds !== null && metadata?.durationSeconds !== undefined
                  ? { callDurationSeconds: metadata.durationSeconds }
                  : {}),
              })
            : null,
        ],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async updateStatus(
    id: string,
    status: CaseStatus,
    author: string,
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET status = ?, updated_at = ? WHERE id = ?`,
        [status, updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, to_status)
          VALUES (?, ?, 'status', ?, ?, ?, ?)
        `,
        [timelineId, id, author, updatedAt, `Case status changed to ${status}.`, status],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async addEmail(
    id: string,
    to: string,
    subject: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET updated_at = ? WHERE id = ?`,
        [updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      if (inReplyToId) {
        const [replyRows] = await connection.query<RowDataPacket[]>(
          `
            SELECT id
            FROM case_timeline
            WHERE case_id = ? AND id = ? AND type = 'email-in'
            LIMIT 1
          `,
          [id, inReplyToId],
        );

        if (replyRows.length === 0) {
          await connection.rollback();
          throw new BadRequestError("inReplyToId must reference an email-in timeline entry on this case");
        }
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, subject, recipient_to, source_trace)
          VALUES (?, ?, 'email-out', ?, ?, ?, ?, ?, ?)
        `,
        [
          timelineId,
          id,
          author,
          updatedAt,
          body,
          subject,
          to,
          inReplyToId ? JSON.stringify({ inReplyToId }) : null,
        ],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async close(
    id: string,
    author: string,
    payload: { fcr?: string; resolution?: string; resolutionDetails?: string },
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const text = `Case closed.${payload.resolution ? ` Resolution: ${payload.resolution}.` : ""}${payload.resolutionDetails ? ` ${payload.resolutionDetails}` : ""}${payload.fcr ? ` FCR: ${payload.fcr}.` : ""}`.trim();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `
          UPDATE cases
          SET
            status = 'Closed',
            closed_at = ?,
            updated_at = ?,
            fcr = ?,
            resolution = ?,
            resolution_details = ?
          WHERE id = ?
        `,
        [updatedAt, updatedAt, payload.fcr ?? null, payload.resolution ?? null, payload.resolutionDetails ?? null, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text)
          VALUES (?, ?, 'close', ?, ?, ?)
        `,
        [timelineId, id, author, updatedAt, text],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async reopen(id: string, author: string): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT closed_at AS closedAt, fcr FROM cases WHERE id = ? LIMIT 1`,
        [id],
      );

      if (existingRows.length === 0) {
        await connection.rollback();
        return null;
      }

      const previousClosedAt = (existingRows[0] as { closedAt: string | null }).closedAt;
      const rawPreviousFcr = (existingRows[0] as { fcr: string | null }).fcr;
      const previousFcr = rawPreviousFcr ? rawPreviousFcr.toLowerCase() : null;
      const reopenedAtMs = Date.parse(updatedAt);
      const closedAtMs = previousClosedAt ? Date.parse(previousClosedAt) : NaN;
      const withinWindow =
        Number.isFinite(closedAtMs)
        && Number.isFinite(reopenedAtMs)
        && reopenedAtMs - closedAtMs <= env.fcrReopenRevokeWindowMs;
      const shouldRevokeFcr = withinWindow && previousFcr === "yes";

      const [updateResult] = await connection.execute<ResultSetHeader>(
        shouldRevokeFcr
          ? `UPDATE cases SET status = 'Open', closed_at = NULL, fcr = NULL, updated_at = ? WHERE id = ?`
          : `UPDATE cases SET status = 'Open', closed_at = NULL, updated_at = ? WHERE id = ?`,
        [updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      const reopenText = shouldRevokeFcr
        ? "Case reopened. FCR auto-revoked (reopened within window)."
        : "Case reopened.";

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text)
          VALUES (?, ?, 'open', ?, ?, ?)
        `,
        [timelineId, id, author, updatedAt, reopenText],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async tagFcr(
    id: string,
    fcr: "yes" | "no" | null,
    author: string,
    callSessionId?: string | null,
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const label =
      fcr === "yes" ? "Yes" : fcr === "no" ? "No" : "Clear";
    const sessionSuffix = callSessionId ? ` (call session ${callSessionId})` : "";
    const text = `FCR pre-tag: ${label}.${sessionSuffix}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT status, fcr FROM cases WHERE id = ? LIMIT 1`,
        [id],
      );

      if (existingRows.length === 0) {
        await connection.rollback();
        return null;
      }

      const row = existingRows[0] as { status: CaseStatus; fcr: string | null };
      if (row.status === "Closed") {
        await connection.rollback();
        throw new ConflictError("Cannot tag FCR on a closed case");
      }

      const previousLower = row.fcr ? row.fcr.toLowerCase() : null;
      const previousNormalized: "yes" | "no" | null =
        previousLower === "yes" || previousLower === "no" ? previousLower : null;

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET fcr = ?, updated_at = ? WHERE id = ?`,
        [fcr, updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, sender_from, recipient_to)
          VALUES (?, ?, 'fcr-tagged', ?, ?, ?, ?, ?)
        `,
        [timelineId, id, author, updatedAt, text, previousNormalized, fcr],
      );

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback failure
      }
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async setFirstCallResolution(
    id: string,
    value: boolean | null,
    author: string,
    callSessionId?: string | null,
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const label = value === true ? "Yes" : value === false ? "No" : "Clear";
    const sessionSuffix = callSessionId ? ` (call session ${callSessionId})` : "";
    const text = `FCR (first call resolution): ${label}.${sessionSuffix}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [existingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM cases WHERE id = ? LIMIT 1`,
        [id],
      );

      if (existingRows.length === 0) {
        await connection.rollback();
        return null;
      }

      const dbValue = value === null ? null : value ? 1 : 0;
      await connection.execute<ResultSetHeader>(
        `UPDATE cases SET first_call_resolution = ?, updated_at = ? WHERE id = ?`,
        [dbValue, updatedAt, id],
      );

      await connection.execute<ResultSetHeader>(
        `INSERT INTO case_timeline (id, case_id, type, author, timestamp, text) VALUES (?, ?, 'fcr-tagged', ?, ?, ?)`,
        [timelineId, id, author, updatedAt, text],
      );

      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback failure
      }
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async addGlipOut(
    id: string,
    channel: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET updated_at = ? WHERE id = ?`,
        [updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      if (inReplyToId) {
        const [replyRows] = await connection.query<RowDataPacket[]>(
          `
            SELECT id
            FROM case_timeline
            WHERE case_id = ? AND id = ? AND type = 'glip-message'
            LIMIT 1
          `,
          [id, inReplyToId],
        );

        if (replyRows.length === 0) {
          await connection.rollback();
          throw new BadRequestError("inReplyToId must reference a glip-message timeline entry on this case");
        }
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, recipient_to, source_trace)
          VALUES (?, ?, 'glip-out', ?, ?, ?, ?, ?)
        `,
        [
          timelineId,
          id,
          author,
          updatedAt,
          body,
          channel,
          inReplyToId ? JSON.stringify({ inReplyToId }) : null,
        ],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }

  async addNiftyOut(
    id: string,
    taskRef: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null> {
    const pool = getMySqlPool();
    const updatedAt = new Date().toISOString();
    const timelineId = `tl-${id}-${Date.now()}`;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE cases SET updated_at = ? WHERE id = ?`,
        [updatedAt, id],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return null;
      }

      if (inReplyToId) {
        const [replyRows] = await connection.query<RowDataPacket[]>(
          `
            SELECT id
            FROM case_timeline
            WHERE case_id = ? AND id = ? AND type = 'nifty-task'
            LIMIT 1
          `,
          [id, inReplyToId],
        );

        if (replyRows.length === 0) {
          await connection.rollback();
          throw new BadRequestError("inReplyToId must reference a nifty-task timeline entry on this case");
        }
      }

      await connection.execute<ResultSetHeader>(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, recipient_to, source_trace)
          VALUES (?, ?, 'nifty-out', ?, ?, ?, ?, ?)
        `,
        [
          timelineId,
          id,
          author,
          updatedAt,
          body,
          taskRef,
          inReplyToId ? JSON.stringify({ inReplyToId }) : null,
        ],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return hydrateCase(id);
  }
}
