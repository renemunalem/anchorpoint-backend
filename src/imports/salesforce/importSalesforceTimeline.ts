import fs from "fs";
import path from "path";
import { RowDataPacket } from "mysql2/promise";
import { env } from "../../config/env";
import { readDatabase, writeDatabase } from "../../repos/json/jsonStore";
import { closeMySqlPool, getMySqlPool } from "../../repos/mysql/client";
import { CaseDetail, CaseStatus, DatabaseState, TimelineEntry } from "../../types/models";

type CsvRow = Record<string, string>;
type TimelineCaseTarget = Pick<CaseDetail, "id" | "caseNumber" | "updatedAt" | "agent">;
type TimelineUserTarget = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  alias?: string;
};
type CountRow = RowDataPacket & { count: number };

type TimelineWriterAudit = {
  inserted: number;
  updated: number;
  skipped: number;
  skipReasons: Record<string, number>;
  storedSalesforceEntries: number;
};

type PreparedTimelineImport = {
  timelineByCase: Map<string, TimelineEntry[]>;
  imported: SalesforceTimelineImportResult["imported"];
  samples: SalesforceTimelineImportSample[];
  skipReasons: Record<string, number>;
};

type MySqlUserRow = RowDataPacket & {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  sourceTrace: unknown;
};

type MySqlCaseRow = RowDataPacket & {
  id: string;
  caseNumber: string;
  updatedAt: string;
  agent: string;
  sourceTrace: unknown;
};

export interface SalesforceTimelineImportSample {
  caseId: string;
  caseNumber: string;
  timelineCount: number;
  timelineTypes: Partial<Record<TimelineEntry["type"], number>>;
}

export interface SalesforceTimelineImportResult {
  exportDir: string;
  imported: {
    caseHistoryEntries: number;
    emailEntries: number;
    taskEntries: number;
    feedEntries: number;
    totalEntries: number;
    casesTouched: number;
  };
  skipped: {
    attachments: true;
  };
  samples: SalesforceTimelineImportSample[];
  audit?: TimelineWriterAudit;
}

function parseSourceTrace(value: unknown) {
  if (!value) {
    return undefined;
  }

  return typeof value === "string" ? JSON.parse(value) : value;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          value += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(value);
      value = "";
      continue;
    }

    if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    if (char !== "\r") {
      value += char;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((entry) => entry.length > 1 || entry[0]?.trim().length);
}

function readCsvRows(filePath: string): CsvRow[] {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  const [header, ...data] = rows;

  return data
    .filter((values) => values.some((value) => value.trim().length > 0))
    .map((values) => {
      const row: CsvRow = {};
      header.forEach((column, index) => {
        row[column] = values[index] ?? "";
      });
      return row;
    });
}

function trimOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoTimestamp(value: string, fallback: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeCaseStatus(value: string): CaseStatus {
  const status = value.trim().toUpperCase();

  if (status === "CLOSED" || status === "MERGED") return "Closed";
  if (status === "NEW" || status === "RE-OPENED") return "Open";
  if (status === "CALL BACK NEEDED") return "Waiting";
  if (
    status === "CLAIM REVIEW - ISSUE FOUND" ||
    status === "PROVIDER APPEAL" ||
    status === "SPECIALTY MEDICATION REVIEW" ||
    status === "BENEFIT REVIEW - ADDITIONAL REVIEW NEEDED"
  ) {
    return "Escalated";
  }

  return "Waiting";
}

function stripHtml(value: string) {
  if (!value.trim()) {
    return "";
  }

  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function summarizeTaskText(row: CsvRow) {
  const description = row.Description.trim();
  if (description) {
    return description;
  }

  const subject = row.Subject.trim();
  return subject ? `Task: ${subject}` : undefined;
}

function summarizeFeedPost(row: CsvRow) {
  const body = stripHtml(row.Body);
  if (body) {
    return body;
  }

  const title = row.Title.trim();
  if (title) {
    return `Feed post: ${title}`;
  }

  return undefined;
}

function buildUserLookup(users: TimelineUserTarget[], userRows: CsvRow[]) {
  const fromDatabase = new Map(users.map((user) => [user.id, user]));
  const fromCsv = new Map(userRows.map((row) => [row.Id.trim(), row]));

  return (userId?: string) => {
    const id = userId?.trim();
    if (!id) {
      return undefined;
    }

    const databaseUser = fromDatabase.get(id);
    if (databaseUser) {
      const joined = [databaseUser.firstName?.trim(), databaseUser.lastName?.trim()].filter(Boolean).join(" ");
      return joined || databaseUser.alias || databaseUser.email || id;
    }

    const csvUser = fromCsv.get(id);
    if (!csvUser) {
      return undefined;
    }

    return [csvUser.FirstName.trim(), csvUser.LastName.trim()].filter(Boolean).join(" ")
      || csvUser.Alias.trim()
      || csvUser.Username.trim()
      || id;
  };
}

function buildEntryId(prefix: string, externalId: string) {
  return `${prefix}-${externalId}`;
}

function sortTimeline(entries: TimelineEntry[]) {
  return entries.sort((left, right) => {
    const timestampOrder = left.timestamp.localeCompare(right.timestamp);
    if (timestampOrder !== 0) {
      return timestampOrder;
    }
    return left.id.localeCompare(right.id);
  });
}

function incrementReason(skipReasons: Record<string, number>, reason: string) {
  skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
}

function buildSamplesFromTimeline(
  caseTargetsById: Map<string, TimelineCaseTarget>,
  timelineByCase: Map<string, TimelineEntry[]>,
): SalesforceTimelineImportSample[] {
  return [...timelineByCase.entries()]
    .filter(([, entries]) => entries.length > 0)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([caseId, entries]) => {
      const caseTarget = caseTargetsById.get(caseId);
      const timelineTypes = entries.reduce<Partial<Record<TimelineEntry["type"], number>>>(
        (counts, item) => {
          counts[item.type] = (counts[item.type] ?? 0) + 1;
          return counts;
        },
        {},
      );

      return {
        caseId,
        caseNumber: caseTarget?.caseNumber ?? caseId,
        timelineCount: entries.length,
        timelineTypes,
      };
    });
}

function prepareTimelineImport(
  caseTargetsById: Map<string, TimelineCaseTarget>,
  users: TimelineUserTarget[],
  exportDir: string,
): PreparedTimelineImport {
  if (caseTargetsById.size === 0) {
    throw new Error(
      env.repoDriver === "mysql"
        ? "No Salesforce-backed cases found in MySQL. Run `npm run import:salesforce:mvp` first."
        : "No Salesforce-backed cases found in JSON store. Run `npm run import:salesforce:mvp` first.",
    );
  }

  const userRows = readCsvRows(path.join(exportDir, "User.csv"));
  const caseHistoryRows = readCsvRows(path.join(exportDir, "CaseHistory2.csv"));
  const emailRows = readCsvRows(path.join(exportDir, "EmailMessage.csv"));
  const taskRows = readCsvRows(path.join(exportDir, "Task.csv"));
  const feedRows = readCsvRows(path.join(exportDir, "FeedPost.csv"));
  const displayUser = buildUserLookup(users, userRows);
  const timelineByCase = new Map<string, TimelineEntry[]>();
  const skipReasons: Record<string, number> = {};

  const pushEntry = (caseId: string, entry: TimelineEntry) => {
    const existing = timelineByCase.get(caseId);
    if (existing) {
      existing.push(entry);
      return;
    }
    timelineByCase.set(caseId, [entry]);
  };

  let caseHistoryEntries = 0;
  for (const row of caseHistoryRows) {
    const caseId = row.CaseId.trim();
    const caseItem = caseTargetsById.get(caseId);
    if (!caseItem) {
      incrementReason(skipReasons, "case_history_case_not_found");
      continue;
    }

    const normalizedStatus = normalizeCaseStatus(row.Status);
    const upperStatus = row.Status.trim().toUpperCase();
    const type =
      upperStatus === "NEW" || upperStatus === "RE-OPENED"
        ? "open"
        : upperStatus === "CLOSED" || upperStatus === "MERGED"
          ? "close"
          : "status";
    const timestamp = toIsoTimestamp(row.LastModifiedDate, caseItem.updatedAt);

    pushEntry(caseId, {
      id: buildEntryId("sf-history", row.Id.trim()),
      type,
      author:
        displayUser(row.LastModifiedById)
        || displayUser(row.OwnerId)
        || caseItem.agent
        || "Salesforce User",
      timestamp,
      text: `Case status changed to ${row.Status.trim() || normalizedStatus}.`,
      toStatus: normalizedStatus,
      sourceTrace: {
        source: "salesforce",
        object: "CaseHistory2",
        externalId: row.Id.trim(),
        parentId: trimOrUndefined(row.CaseId),
      },
    });
    caseHistoryEntries += 1;
  }

  let emailEntries = 0;
  for (const row of emailRows) {
    const caseItem =
      caseTargetsById.get(row.ParentId.trim()) ??
      caseTargetsById.get(row.RelatedToId.trim());

    if (!caseItem) {
      incrementReason(skipReasons, "email_case_not_found");
      continue;
    }

    const isIncoming = row.Incoming.trim() === "1";
    const timestamp = toIsoTimestamp(row.MessageDate || row.CreatedDate, caseItem.updatedAt);
    pushEntry(caseItem.id, {
      id: buildEntryId("sf-email", row.Id.trim()),
      type: isIncoming ? "email-in" : "email-out",
      author:
        trimOrUndefined(row.FromName)
        || trimOrUndefined(row.FromAddress)
        || displayUser(row.CreatedById)
        || "Salesforce Email",
      timestamp,
      text: trimOrUndefined(row.TextBody),
      subject: trimOrUndefined(row.Subject),
      from: trimOrUndefined(row.FromAddress),
      to: trimOrUndefined(row.ToAddress),
      cc: trimOrUndefined(row.CcAddress),
      bcc: trimOrUndefined(row.BccAddress),
      sourceTrace: {
        source: "salesforce",
        object: "EmailMessage",
        externalId: row.Id.trim(),
        parentId: trimOrUndefined(row.ParentId),
        relatedToId: trimOrUndefined(row.RelatedToId),
      },
    });
    emailEntries += 1;
  }

  let taskEntries = 0;
  for (const row of taskRows) {
    const caseItem = caseTargetsById.get(row.WhatId.trim());
    if (!caseItem) {
      incrementReason(skipReasons, "task_case_not_found");
      continue;
    }

    const subject = row.Subject.trim();
    const isCall =
      subject.toLowerCase() === "call"
      || Boolean(trimOrUndefined(row.CallType))
      || Boolean(trimOrUndefined(row.CallDisposition))
      || Boolean(trimOrUndefined(row.CallDurationInSeconds));
    const timestamp = toIsoTimestamp(
      row.CompletedDateTime || row.ActivityDate || row.LastModifiedDate || row.CreatedDate,
      caseItem.updatedAt,
    );

    pushEntry(caseItem.id, {
      id: buildEntryId("sf-task", row.Id.trim()),
      type: isCall ? "call" : "note",
      author:
        displayUser(row.OwnerId)
        || displayUser(row.CreatedById)
        || caseItem.agent
        || "Salesforce User",
      timestamp,
      text: summarizeTaskText(row),
      subject: trimOrUndefined(subject),
      sourceTrace: {
        source: "salesforce",
        object: "Task",
        externalId: row.Id.trim(),
        relatedToId: trimOrUndefined(row.WhatId),
        parentId: trimOrUndefined(row.WhoId),
      },
    });
    taskEntries += 1;
  }

  let feedEntries = 0;
  for (const row of feedRows) {
    const caseItem =
      caseTargetsById.get(row.ParentId.trim()) ??
      caseTargetsById.get(row.RelatedRecordId.trim());
    if (!caseItem) {
      incrementReason(skipReasons, "feed_case_not_found");
      continue;
    }

    pushEntry(caseItem.id, {
      id: buildEntryId("sf-feed", row.Id.trim()),
      type: "note",
      author:
        displayUser(row.InsertedById)
        || displayUser(row.CreatedById)
        || caseItem.agent
        || "Salesforce User",
      timestamp: toIsoTimestamp(row.CreatedDate, caseItem.updatedAt),
      text: summarizeFeedPost(row),
      subject: trimOrUndefined(row.Title),
      sourceTrace: {
        source: "salesforce",
        object: "FeedPost",
        externalId: row.Id.trim(),
        parentId: trimOrUndefined(row.ParentId),
        relatedToId: trimOrUndefined(row.RelatedRecordId),
      },
    });
    feedEntries += 1;
  }

  return {
    timelineByCase,
    imported: {
      caseHistoryEntries,
      emailEntries,
      taskEntries,
      feedEntries,
      totalEntries: caseHistoryEntries + emailEntries + taskEntries + feedEntries,
      casesTouched: [...timelineByCase.values()].filter((entries) => entries.length > 0).length,
    },
    samples: buildSamplesFromTimeline(caseTargetsById, timelineByCase),
    skipReasons,
  };
}

function buildJsonUsers(db: DatabaseState): TimelineUserTarget[] {
  return db.users.map((user) => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    alias: user.sourceTrace?.alias,
  }));
}

function buildJsonCaseMap(db: DatabaseState) {
  const casesById = new Map<string, TimelineCaseTarget>();
  db.cases.forEach((entry) => {
    if (entry.sourceTrace?.source === "salesforce") {
      casesById.set(entry.id, {
        id: entry.id,
        caseNumber: entry.caseNumber,
        updatedAt: entry.updatedAt,
        agent: entry.agent,
      });
    }
  });
  return casesById;
}

function writeJsonTimelineImport(
  exportDir: string,
  prepared: PreparedTimelineImport,
): SalesforceTimelineImportResult {
  const db = readDatabase();
  const casesById = new Set(
    db.cases.filter((entry) => entry.sourceTrace?.source === "salesforce").map((entry) => entry.id),
  );

  db.cases = db.cases.map((entry) => {
    if (!casesById.has(entry.id)) {
      return entry;
    }

    const importedTimeline = prepared.timelineByCase.get(entry.id) ?? [];
    const preservedTimeline = entry.timeline.filter((item) => item.sourceTrace?.source !== "salesforce");

    return {
      ...entry,
      timeline: sortTimeline([...preservedTimeline, ...importedTimeline]),
    };
  });

  writeDatabase(db);

  return {
    exportDir,
    imported: prepared.imported,
    skipped: {
      attachments: true,
    },
    samples: prepared.samples,
  };
}

async function loadMySqlUsers(): Promise<TimelineUserTarget[]> {
  const pool = getMySqlPool();
  const [rows] = await pool.query<MySqlUserRow[]>(
    `
      SELECT
        id,
        first_name AS firstName,
        last_name AS lastName,
        email,
        source_trace AS sourceTrace
      FROM users
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    alias: parseSourceTrace(row.sourceTrace)?.alias,
  }));
}

async function loadMySqlCaseMap() {
  const pool = getMySqlPool();
  const [rows] = await pool.query<MySqlCaseRow[]>(
    `
      SELECT
        id,
        case_number AS caseNumber,
        updated_at AS updatedAt,
        agent,
        source_trace AS sourceTrace
      FROM cases
    `,
  );

  const casesById = new Map<string, TimelineCaseTarget>();
  rows.forEach((row) => {
    const sourceTrace = parseSourceTrace(row.sourceTrace);
    if (sourceTrace?.source === "salesforce") {
      casesById.set(row.id, {
        id: row.id,
        caseNumber: row.caseNumber,
        updatedAt: row.updatedAt,
        agent: row.agent,
      });
    }
  });
  return casesById;
}

async function countStoredSalesforceTimelineEntries() {
  const pool = getMySqlPool();
  const [rows] = await pool.query<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM case_timeline
      WHERE JSON_UNQUOTE(JSON_EXTRACT(source_trace, '$.source')) = 'salesforce'
    `,
  );

  return rows[0]?.count ?? 0;
}

async function writeMySqlTimelineImport(
  exportDir: string,
  prepared: PreparedTimelineImport,
): Promise<SalesforceTimelineImportResult> {
  const pool = getMySqlPool();
  const connection = await pool.getConnection();
  const allEntries = [...prepared.timelineByCase.entries()].flatMap(([caseId, entries]) =>
    entries.map((entry) => ({ caseId, entry })),
  );

  try {
    await connection.beginTransaction();
    await connection.query(
      `
        DELETE FROM case_timeline
        WHERE JSON_UNQUOTE(JSON_EXTRACT(source_trace, '$.source')) = 'salesforce'
      `,
    );

    for (const row of allEntries) {
      const { caseId, entry } = row;
      await connection.execute(
        `
          INSERT INTO case_timeline (
            id,
            case_id,
            type,
            author,
            timestamp,
            text,
            to_status,
            subject,
            sender_from,
            recipient_to,
            recipient_cc,
            recipient_bcc,
            source_trace
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          entry.id,
          caseId,
          entry.type,
          entry.author,
          entry.timestamp,
          entry.text ?? null,
          entry.toStatus ?? null,
          entry.subject ?? null,
          entry.from ?? null,
          entry.to ?? null,
          entry.cc ?? null,
          entry.bcc ?? null,
          entry.sourceTrace ? JSON.stringify(entry.sourceTrace) : null,
        ],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    exportDir,
    imported: prepared.imported,
    skipped: {
      attachments: true,
    },
    samples: prepared.samples,
    audit: {
      inserted: allEntries.length,
      updated: 0,
      skipped: Object.values(prepared.skipReasons).reduce((total, value) => total + value, 0),
      skipReasons: prepared.skipReasons,
      storedSalesforceEntries: await countStoredSalesforceTimelineEntries(),
    },
  };
}

export async function importSalesforceTimeline(
  exportDir = path.resolve(process.cwd(), "imports/salesforce/exports/2026-04-25"),
): Promise<SalesforceTimelineImportResult> {
  if (env.repoDriver === "mysql") {
    try {
      const [casesById, users] = await Promise.all([loadMySqlCaseMap(), loadMySqlUsers()]);
      const prepared = prepareTimelineImport(casesById, users, exportDir);
      return await writeMySqlTimelineImport(exportDir, prepared);
    } finally {
      await closeMySqlPool();
    }
  }

  const db = readDatabase();
  const prepared = prepareTimelineImport(buildJsonCaseMap(db), buildJsonUsers(db), exportDir);
  return writeJsonTimelineImport(exportDir, prepared);
}
