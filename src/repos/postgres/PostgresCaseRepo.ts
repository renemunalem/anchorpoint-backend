import { PoolClient } from "pg";
import { env } from "../../config/env";
import { BadRequestError, CaseListQuery, CaseStatusCounts, ConflictError, CursorPageResult } from "../../types/http";
import { CallDirection, CaseAttachmentSummary, CaseDetail, CaseOrigin, CaseStatus, CaseSummary, TimelineEntry } from "../../types/models";
import { CaseRepo } from "../CaseRepo";
import { getPostgresPool } from "./client";

async function withPgTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // swallow rollback failure; surface original error
    }
    throw error;
  } finally {
    client.release();
  }
}

function nextTimelineId(caseId: string) {
  return `tl-${caseId}-${Date.now()}`;
}

type CaseRow = {
  id: string;
  caseNumber: string;
  memberId: string;
  memberName: string;
  caseType: CaseSummary["caseType"];
  status: CaseStatus;
  actionItem: string | null;
  urgencyLabel: string;
  urgencyTone: CaseSummary["urgency"]["tone"];
  createdAt: string;
  updatedAt: string;
  agent: string;
  groupNumber: string;
  claimNumber: string | null;
  priority: CaseSummary["priority"];
  description: string | null;
  closedAt: string | null;
  fcr: string | null;
  firstCallResolution: boolean | null;
  resolution: string | null;
  resolutionDetails: string | null;
  origin: CaseOrigin | null;
  attachmentCount: string | number | null;
  dueAt: string | null;
  sourceTrace: unknown;
};

type TimelineRow = {
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

type AttachmentRow = {
  id: string;
  kind: CaseAttachmentSummary["kind"];
  linkKind: "case-direct" | "related-record";
  name: string;
  title: string | null;
  description: string | null;
  mimeType: string | null;
  fileType: string | null;
  sizeBytes: number | null;
  isPrivate: boolean | null;
  createdAt: string | null;
  owner: string | null;
  exportRelativePath: string | null;
  sourceTrace: unknown;
};

type CaseMemberRow = NonNullable<CaseDetail["member"]>;
type CaseStatusCountRow = {
  status: CaseStatus;
  count: string | number;
};

type CaseCursorPayload = {
  createdAt: string;
  id: string;
};

function parseSourceTrace(value: unknown) {
  if (!value) {
    return undefined;
  }

  return typeof value === "string" ? JSON.parse(value) : value;
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
    description: row.description,
    closedAt: row.closedAt ?? undefined,
    fcr: row.fcr ? row.fcr.toLowerCase() : row.fcr,
    firstCallResolution: row.firstCallResolution ?? null,
    resolution: row.resolution,
    resolutionDetails: row.resolutionDetails,
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
    text: row.text,
    toStatus: row.toStatus ?? undefined,
    subject: row.subject,
    from: row.from,
    to: row.to,
    cc: row.cc,
    bcc: row.bcc,
    sourceTrace: parseSourceTrace(row.sourceTrace),
  };
}

function mapAttachmentRow(row: AttachmentRow): CaseAttachmentSummary {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    mimeType: row.mimeType ?? undefined,
    fileType: row.fileType ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    isPrivate: row.isPrivate ?? undefined,
    createdAt: row.createdAt ?? undefined,
    owner: row.owner ?? undefined,
    exportRelativePath: row.exportRelativePath ?? undefined,
    sourceTrace: parseSourceTrace(row.sourceTrace) as CaseAttachmentSummary["sourceTrace"],
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

function buildCaseSearchClauses(params: CaseListQuery) {
  const whereClauses: string[] = [];
  const values: Array<number | string | string[]> = [];

  if (params.caseNumber) {
    whereClauses.push(`case_number = $${values.push(params.caseNumber)}`);
  }

  if (params.caseId) {
    whereClauses.push(`id = $${values.push(params.caseId)}`);
  }

  if (params.memberId) {
    whereClauses.push(`member_id = $${values.push(params.memberId)}`);
  }

  if (params.groupNumber) {
    whereClauses.push(`group_number = $${values.push(params.groupNumber)}`);
  }

  if (params.claimNumber) {
    whereClauses.push(`claim_number = $${values.push(params.claimNumber)}`);
  }

  if (params.q) {
    const pattern = `%${params.q.replace(/[\\%_]/g, "\\$&")}%`;
    const param = `$${values.push(pattern)}`;
    whereClauses.push(
      `(id ILIKE ${param} OR case_number ILIKE ${param} OR member_name ILIKE ${param} OR member_id ILIKE ${param} OR group_number ILIKE ${param} OR COALESCE(claim_number, '') ILIKE ${param})`,
    );
  }

  if (params.statuses && params.statuses.length > 0) {
    whereClauses.push(`status = ANY($${values.push(params.statuses)})`);
  }

  return {
    whereClauses,
    values,
  };
}

const CASE_SUMMARY_SELECT = `
  SELECT
    id,
    case_number AS "caseNumber",
    member_id AS "memberId",
    member_name AS "memberName",
    case_type AS "caseType",
    status,
    action_item AS "actionItem",
    urgency_label AS "urgencyLabel",
    urgency_tone AS "urgencyTone",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    agent,
    group_number AS "groupNumber",
    claim_number AS "claimNumber",
    priority,
    description,
    closed_at AS "closedAt",
    fcr,
    first_call_resolution AS "firstCallResolution",
    resolution,
    resolution_details AS "resolutionDetails",
    origin,
    due_at AS "dueAt",
    (
      SELECT COUNT(*)::int
      FROM case_attachments
      WHERE case_attachments.case_id = cases.id
    ) AS "attachmentCount",
    source_trace AS "sourceTrace"
  FROM cases
`;

async function getCaseSummaryRow(id: string): Promise<CaseRow | null> {
  const pool = getPostgresPool();
  const { rows } = await pool.query<CaseRow>(
    `
      ${CASE_SUMMARY_SELECT}
      WHERE id = $1
      LIMIT 1
    `,
    [id],
  );

  return rows[0] ?? null;
}

async function getTimelineRows(caseId: string): Promise<TimelineEntry[]> {
  const pool = getPostgresPool();
  const { rows } = await pool.query<TimelineRow>(
    `
      SELECT
        id,
        type,
        author,
        timestamp,
        in_reply_to_id AS "inReplyToId",
        call_direction AS "callDirection",
        call_duration_seconds AS "callDurationSeconds",
        task_due_date AS "taskDueDate",
        text,
        to_status AS "toStatus",
        subject,
        sender_from AS "from",
        recipient_to AS "to",
        recipient_cc AS "cc",
        recipient_bcc AS "bcc",
        source_trace AS "sourceTrace"
      FROM case_timeline
      WHERE case_id = $1
      ORDER BY timestamp ASC, id ASC
    `,
    [caseId],
  );

  return rows.map(mapTimelineRow);
}

async function getAttachmentRows(caseId: string): Promise<CaseAttachmentSummary[]> {
  const pool = getPostgresPool();
  const { rows } = await pool.query<AttachmentRow>(
    `
      SELECT
        id,
        kind,
        link_kind AS "linkKind",
        name,
        title,
        description,
        mime_type AS "mimeType",
        file_type AS "fileType",
        size_bytes AS "sizeBytes",
        is_private AS "isPrivate",
        created_at AS "createdAt",
        owner,
        export_relative_path AS "exportRelativePath",
        source_trace AS "sourceTrace"
      FROM case_attachments
      WHERE case_id = $1
      ORDER BY created_at ASC NULLS LAST, id ASC
    `,
    [caseId],
  );

  return rows.map(mapAttachmentRow);
}

async function getCaseMember(memberId: string): Promise<CaseDetail["member"] | undefined> {
  const pool = getPostgresPool();
  const { rows } = await pool.query<CaseMemberRow>(
    `
      SELECT
        id,
        subscriber_member_id AS "subscriberMemberId",
        first_name AS "firstName",
        last_name AS "lastName",
        account_group_name AS "accountGroupName",
        group_number AS "groupNumber",
        plan_name AS "planName",
        plan_id AS "planId",
        coverage_tier AS "coverageTier",
        relationship_type AS "relationshipType",
        member_status AS "memberStatus",
        cob_status AS "cobStatus"
      FROM members
      WHERE id = $1
      LIMIT 1
    `,
    [memberId],
  );

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
    getCaseMember(summary.memberId),
  ]);

  return {
    ...mapCaseSummary(summary),
    timeline,
    attachments,
    member,
  };
}

export class PostgresCaseRepo implements CaseRepo {
  async list(): Promise<CaseSummary[]> {
    const pool = getPostgresPool();
    const { rows } = await pool.query<CaseRow>(
      `
        ${CASE_SUMMARY_SELECT}
        ORDER BY created_at DESC, id DESC
      `,
    );

    return rows.map(mapCaseSummary);
  }

  async listPage(params: CaseListQuery): Promise<CursorPageResult<CaseSummary>> {
    const pool = getPostgresPool();
    const { whereClauses, values } = buildCaseSearchClauses(params);

    if (params.cursor) {
      const cursor = decodeCaseCursor(params.cursor);
      const createdAtParam = `$${values.push(cursor.createdAt)}`;
      const repeatedCreatedAtParam = `$${values.push(cursor.createdAt)}`;
      const idParam = `$${values.push(cursor.id)}`;
      whereClauses.push(
        `(created_at < ${createdAtParam} OR (created_at = ${repeatedCreatedAtParam} AND id < ${idParam}))`,
      );
    }

    const limitParam = `$${values.push(params.limit + 1)}`;
    const { rows } = await pool.query<CaseRow>(
      `
        ${CASE_SUMMARY_SELECT}
        ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limitParam}
      `,
      values,
    );

    const hasNext = rows.length > params.limit;
    const pageRows = hasNext ? rows.slice(0, params.limit) : rows;
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows.map(mapCaseSummary),
      pageInfo: {
        hasNext,
        nextCursor: hasNext && lastRow
          ? encodeCaseCursor({
              createdAt: lastRow.createdAt,
              id: lastRow.id,
            })
          : null,
      },
    };
  }

  async countByStatus(): Promise<CaseStatusCounts> {
    const pool = getPostgresPool();
    const { rows } = await pool.query<CaseStatusCountRow>(
      `
        SELECT status, COUNT(*)::bigint AS count
        FROM cases
        GROUP BY status
      `,
    );

    return rows.reduce((counts, row) => {
      const count = Number(row.count);
      if (row.status === "Open") {
        counts.open = count;
      } else if (row.status === "Waiting") {
        counts.waiting = count;
      } else if (row.status === "Escalated") {
        counts.escalated = count;
      } else if (row.status === "Closed") {
        counts.closed = count;
      }

      return counts;
    }, emptyCaseStatusCounts());
  }

  async getById(id: string): Promise<CaseDetail | null> {
    return hydrateCase(id);
  }

  async assign(id: string, agent: string, author: string): Promise<CaseDetail | null> {
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);

    const updated = await withPgTransaction(async (client) => {
      const previous = await client.query<{ agent: string | null }>(
        `SELECT agent FROM cases WHERE id = $1 LIMIT 1`,
        [id],
      );

      if (previous.rowCount === 0) {
        return false;
      }

      const previousAgent = previous.rows[0].agent ?? "";

      await client.query(
        `UPDATE cases SET agent = $1, updated_at = $2 WHERE id = $3`,
        [agent, updatedAt, id],
      );

      if (previousAgent !== agent) {
        const text = `Case assigned ${previousAgent ? `from ${previousAgent} ` : ""}to ${agent || "(unassigned)"}.`;
        await client.query(
          `
            INSERT INTO case_timeline (id, case_id, type, author, timestamp, sender_from, recipient_to, text)
            VALUES ($1, $2, 'assignment', $3, $4, $5, $6, $7)
          `,
          [timelineId, id, author, updatedAt, previousAgent || null, agent || null, text],
        );
      }

      return true;
    });

    if (!updated) {
      return null;
    }

    return hydrateCase(id);
  }

  async addNote(id: string, text: string, author: string): Promise<CaseDetail | null> {
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);

    const updated = await withPgTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE cases SET updated_at = $1 WHERE id = $2`,
        [updatedAt, id],
      );

      if (updateResult.rowCount === 0) {
        return false;
      }

      await client.query(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text)
          VALUES ($1, $2, 'note', $3, $4, $5)
        `,
        [timelineId, id, author, updatedAt, text],
      );

      return true;
    });

    if (!updated) {
      return null;
    }

    return hydrateCase(id);
  }

  async addTask(
    id: string,
    title: string,
    dueDate: string | null,
    author: string,
  ): Promise<CaseDetail | null> {
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);
    const text = `Task created: ${title}${dueDate ? ` (due ${dueDate})` : ""}`;

    const updated = await withPgTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE cases SET updated_at = $1 WHERE id = $2`,
        [updatedAt, id],
      );

      if (updateResult.rowCount === 0) {
        return false;
      }

      await client.query(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, task_due_date)
          VALUES ($1, $2, 'task', $3, $4, $5, $6)
        `,
        [timelineId, id, author, updatedAt, text, dueDate],
      );

      return true;
    });

    if (!updated) {
      return null;
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
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);
    const text = `Call logged${outcome ? ` — ${outcome}` : ""}: ${summary}`;
    const direction = metadata?.direction ?? null;
    const durationSeconds = metadata?.durationSeconds ?? null;

    const updated = await withPgTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE cases SET updated_at = $1 WHERE id = $2`,
        [updatedAt, id],
      );

      if (updateResult.rowCount === 0) {
        return false;
      }

      await client.query(
        `
          INSERT INTO case_timeline
            (id, case_id, type, author, timestamp, text, call_direction, call_duration_seconds)
          VALUES ($1, $2, 'call', $3, $4, $5, $6, $7)
        `,
        [timelineId, id, author, updatedAt, text, direction, durationSeconds],
      );

      return true;
    });

    if (!updated) {
      return null;
    }

    return hydrateCase(id);
  }

  async updateStatus(
    id: string,
    status: CaseStatus,
    author: string,
  ): Promise<CaseDetail | null> {
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);

    const updated = await withPgTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE cases SET status = $1, updated_at = $2 WHERE id = $3`,
        [status, updatedAt, id],
      );

      if (updateResult.rowCount === 0) {
        return false;
      }

      await client.query(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, to_status)
          VALUES ($1, $2, 'status', $3, $4, $5, $6)
        `,
        [timelineId, id, author, updatedAt, `Case status changed to ${status}.`, status],
      );

      return true;
    });

    if (!updated) {
      return null;
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
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);

    const updated = await withPgTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE cases SET updated_at = $1 WHERE id = $2`,
        [updatedAt, id],
      );

      if (updateResult.rowCount === 0) {
        return false;
      }

      if (inReplyToId) {
        const replyCheck = await client.query(
          `
            SELECT id
            FROM case_timeline
            WHERE case_id = $1 AND id = $2 AND type = 'email-in'
            LIMIT 1
          `,
          [id, inReplyToId],
        );

        if (replyCheck.rowCount === 0) {
          throw new BadRequestError(
            "inReplyToId must reference an email-in timeline entry on this case",
          );
        }
      }

      await client.query(
        `
          INSERT INTO case_timeline
            (id, case_id, type, author, timestamp, text, subject, recipient_to, in_reply_to_id)
          VALUES ($1, $2, 'email-out', $3, $4, $5, $6, $7, $8)
        `,
        [timelineId, id, author, updatedAt, body, subject, to, inReplyToId ?? null],
      );

      return true;
    });

    if (!updated) {
      return null;
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
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);

    const updated = await withPgTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE cases SET updated_at = $1 WHERE id = $2`,
        [updatedAt, id],
      );

      if (updateResult.rowCount === 0) {
        return false;
      }

      if (inReplyToId) {
        const replyCheck = await client.query(
          `
            SELECT id
            FROM case_timeline
            WHERE case_id = $1 AND id = $2 AND type = 'glip-message'
            LIMIT 1
          `,
          [id, inReplyToId],
        );

        if (replyCheck.rowCount === 0) {
          throw new BadRequestError(
            "inReplyToId must reference a glip-message timeline entry on this case",
          );
        }
      }

      await client.query(
        `
          INSERT INTO case_timeline
            (id, case_id, type, author, timestamp, text, recipient_to, in_reply_to_id)
          VALUES ($1, $2, 'glip-out', $3, $4, $5, $6, $7)
        `,
        [timelineId, id, author, updatedAt, body, channel, inReplyToId ?? null],
      );

      return true;
    });

    if (!updated) {
      return null;
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
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);

    const updated = await withPgTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE cases SET updated_at = $1 WHERE id = $2`,
        [updatedAt, id],
      );

      if (updateResult.rowCount === 0) {
        return false;
      }

      if (inReplyToId) {
        const replyCheck = await client.query(
          `
            SELECT id
            FROM case_timeline
            WHERE case_id = $1 AND id = $2 AND type = 'nifty-task'
            LIMIT 1
          `,
          [id, inReplyToId],
        );

        if (replyCheck.rowCount === 0) {
          throw new BadRequestError(
            "inReplyToId must reference a nifty-task timeline entry on this case",
          );
        }
      }

      await client.query(
        `
          INSERT INTO case_timeline
            (id, case_id, type, author, timestamp, text, recipient_to, in_reply_to_id)
          VALUES ($1, $2, 'nifty-out', $3, $4, $5, $6, $7)
        `,
        [timelineId, id, author, updatedAt, body, taskRef, inReplyToId ?? null],
      );

      return true;
    });

    if (!updated) {
      return null;
    }

    return hydrateCase(id);
  }

  async close(
    id: string,
    author: string,
    payload: { fcr?: string; resolution?: string; resolutionDetails?: string },
  ): Promise<CaseDetail | null> {
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);
    const text = `Case closed.${payload.resolution ? ` Resolution: ${payload.resolution}.` : ""}${payload.resolutionDetails ? ` ${payload.resolutionDetails}` : ""}${payload.fcr ? ` FCR: ${payload.fcr}.` : ""}`.trim();

    const updated = await withPgTransaction(async (client) => {
      const updateResult = await client.query(
        `
          UPDATE cases
          SET
            status = 'Closed',
            closed_at = $1,
            updated_at = $2,
            fcr = $3,
            resolution = $4,
            resolution_details = $5
          WHERE id = $6
        `,
        [
          updatedAt,
          updatedAt,
          payload.fcr ?? null,
          payload.resolution ?? null,
          payload.resolutionDetails ?? null,
          id,
        ],
      );

      if (updateResult.rowCount === 0) {
        return false;
      }

      await client.query(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text)
          VALUES ($1, $2, 'close', $3, $4, $5)
        `,
        [timelineId, id, author, updatedAt, text],
      );

      return true;
    });

    if (!updated) {
      return null;
    }

    return hydrateCase(id);
  }

  async tagFcr(
    id: string,
    fcr: "yes" | "no" | null,
    author: string,
    callSessionId?: string | null,
  ): Promise<CaseDetail | null> {
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);
    const label =
      fcr === "yes" ? "Yes" : fcr === "no" ? "No" : "Clear";
    const sessionSuffix = callSessionId ? ` (call session ${callSessionId})` : "";
    const text = `FCR pre-tag: ${label}.${sessionSuffix}`;

    const result = await withPgTransaction(async (client) => {
      const existing = await client.query<{ status: CaseStatus; fcr: string | null }>(
        `SELECT status, fcr FROM cases WHERE id = $1 LIMIT 1`,
        [id],
      );

      if (existing.rowCount === 0) {
        return { status: "missing" as const };
      }

      if (existing.rows[0].status === "Closed") {
        return { status: "closed" as const };
      }

      const previousRaw = existing.rows[0].fcr;
      const previousLower = previousRaw ? previousRaw.toLowerCase() : null;
      const previousNormalized: "yes" | "no" | null =
        previousLower === "yes" || previousLower === "no" ? previousLower : null;

      await client.query(
        `UPDATE cases SET fcr = $1, updated_at = $2 WHERE id = $3`,
        [fcr, updatedAt, id],
      );

      await client.query(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text, sender_from, recipient_to)
          VALUES ($1, $2, 'fcr-tagged', $3, $4, $5, $6, $7)
        `,
        [timelineId, id, author, updatedAt, text, previousNormalized, fcr],
      );

      return { status: "ok" as const };
    });

    if (result.status === "closed") {
      throw new ConflictError("Cannot tag FCR on a closed case");
    }

    if (result.status === "missing") {
      return null;
    }

    return hydrateCase(id);
  }

  async setFirstCallResolution(
    id: string,
    value: boolean | null,
    author: string,
    callSessionId?: string | null,
  ): Promise<CaseDetail | null> {
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);
    const label = value === true ? "Yes" : value === false ? "No" : "Clear";
    const sessionSuffix = callSessionId ? ` (call session ${callSessionId})` : "";
    const text = `FCR (first call resolution): ${label}.${sessionSuffix}`;

    const found = await withPgTransaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM cases WHERE id = $1 LIMIT 1`,
        [id],
      );

      if (existing.rowCount === 0) {
        return false;
      }

      await client.query(
        `UPDATE cases SET first_call_resolution = $1, updated_at = $2 WHERE id = $3`,
        [value, updatedAt, id],
      );

      await client.query(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text)
          VALUES ($1, $2, 'fcr-tagged', $3, $4, $5)
        `,
        [timelineId, id, author, updatedAt, text],
      );

      return true;
    });

    if (!found) return null;
    return hydrateCase(id);
  }

  async reopen(id: string, author: string): Promise<CaseDetail | null> {
    const updatedAt = new Date().toISOString();
    const timelineId = nextTimelineId(id);

    const updated = await withPgTransaction(async (client) => {
      const existing = await client.query<{ closedAt: string | null; fcr: string | null }>(
        `SELECT closed_at AS "closedAt", fcr FROM cases WHERE id = $1 LIMIT 1`,
        [id],
      );

      if (existing.rowCount === 0) {
        return false;
      }

      const previousClosedAt = existing.rows[0].closedAt;
      const previousFcr = existing.rows[0].fcr ? existing.rows[0].fcr.toLowerCase() : null;
      const reopenedAtMs = Date.parse(updatedAt);
      const closedAtMs = previousClosedAt ? Date.parse(previousClosedAt) : NaN;
      const withinWindow =
        Number.isFinite(closedAtMs)
        && Number.isFinite(reopenedAtMs)
        && reopenedAtMs - closedAtMs <= env.fcrReopenRevokeWindowMs;
      const shouldRevokeFcr = withinWindow && previousFcr === "yes";

      await client.query(
        shouldRevokeFcr
          ? `UPDATE cases SET status = 'Open', closed_at = NULL, fcr = NULL, updated_at = $1 WHERE id = $2`
          : `UPDATE cases SET status = 'Open', closed_at = NULL, updated_at = $1 WHERE id = $2`,
        [updatedAt, id],
      );

      const reopenText = shouldRevokeFcr
        ? "Case reopened. FCR auto-revoked (reopened within window)."
        : "Case reopened.";

      await client.query(
        `
          INSERT INTO case_timeline (id, case_id, type, author, timestamp, text)
          VALUES ($1, $2, 'open', $3, $4, $5)
        `,
        [timelineId, id, author, updatedAt, reopenText],
      );

      return true;
    });

    if (!updated) {
      return null;
    }

    return hydrateCase(id);
  }
}
