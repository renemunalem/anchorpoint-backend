import fs from "fs";
import path from "path";
import { RowDataPacket } from "mysql2/promise";
import { env } from "../../config/env";
import { readDatabase, writeDatabase } from "../../repos/json/jsonStore";
import { closeMySqlPool, getMySqlPool } from "../../repos/mysql/client";
import { CaseAttachmentSummary, CaseDetail, DatabaseState } from "../../types/models";

type CsvRow = Record<string, string>;
type TimelineUserTarget = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  alias?: string;
};
type AttachmentCaseTarget = Pick<CaseDetail, "id" | "caseNumber">;
type CountRow = RowDataPacket & { count: number };
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
  sourceTrace: unknown;
};

type ResolvedCaseLink =
  | {
      caseId: string;
      linkKind: "case-direct";
      linkedEntityType: "Case";
      linkedEntityId: string;
    }
  | {
      caseId: string;
      linkKind: "related-record";
      linkedEntityType: "EmailMessage" | "Task" | "FeedPost";
      linkedEntityId: string;
    };

type PreparedAttachmentImport = {
  attachmentsByCase: Map<string, CaseAttachmentSummary[]>;
  imported: SalesforceAttachmentImportResult["imported"];
  skipped: SalesforceAttachmentImportResult["skipped"];
  samples: SalesforceAttachmentImportSample[];
};

type AttachmentAudit = {
  inserted: number;
  updated: number;
  skipped: number;
  skipReasons: Record<string, number>;
  storedSalesforceAttachments: number;
};

export interface SalesforceAttachmentImportSample {
  caseId: string;
  caseNumber: string;
  attachmentCount: number;
  linkKinds: Partial<Record<"case-direct" | "related-record", number>>;
}

export interface SalesforceAttachmentImportResult {
  exportDir: string;
  imported: {
    legacyAttachments: number;
    contentDocumentLinks: number;
    totalAttachments: number;
    casesTouched: number;
  };
  skipped: {
    unresolvedLegacyAttachments: number;
    unresolvedContentDocumentLinks: number;
    missingContentVersions: number;
  };
  samples: SalesforceAttachmentImportSample[];
  audit?: AttachmentAudit;
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

function toIsoTimestamp(value: string, fallback?: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function toOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBooleanFlag(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
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
      const joined = [databaseUser.firstName?.trim(), databaseUser.lastName?.trim()]
        .filter(Boolean)
        .join(" ");
      return joined || databaseUser.alias || databaseUser.email || id;
    }

    const csvUser = fromCsv.get(id);
    if (!csvUser) {
      return undefined;
    }

    return (
      [csvUser.FirstName.trim(), csvUser.LastName.trim()].filter(Boolean).join(" ")
      || csvUser.Alias.trim()
      || csvUser.Username.trim()
      || id
    );
  };
}

function buildEntityResolvers(
  caseIds: Set<string>,
  emailRows: CsvRow[],
  taskRows: CsvRow[],
  feedRows: CsvRow[],
) {
  const emailToCase = new Map<string, string>();
  emailRows.forEach((row) => {
    const candidate = row.ParentId.trim() || row.RelatedToId.trim();
    if (candidate && caseIds.has(candidate)) {
      emailToCase.set(row.Id.trim(), candidate);
    }
  });

  const taskToCase = new Map<string, string>();
  taskRows.forEach((row) => {
    const candidate = row.WhatId.trim();
    if (candidate && caseIds.has(candidate)) {
      taskToCase.set(row.Id.trim(), candidate);
    }
  });

  const feedToCase = new Map<string, string>();
  feedRows.forEach((row) => {
    const candidate = row.ParentId.trim() || row.RelatedRecordId.trim();
    if (candidate && caseIds.has(candidate)) {
      feedToCase.set(row.Id.trim(), candidate);
    }
  });

  return (entityId: string): ResolvedCaseLink | null => {
    const trimmed = entityId.trim();
    if (!trimmed) {
      return null;
    }

    if (caseIds.has(trimmed)) {
      return {
        caseId: trimmed,
        linkKind: "case-direct",
        linkedEntityType: "Case",
        linkedEntityId: trimmed,
      };
    }

    const emailCaseId = emailToCase.get(trimmed);
    if (emailCaseId) {
      return {
        caseId: emailCaseId,
        linkKind: "related-record",
        linkedEntityType: "EmailMessage",
        linkedEntityId: trimmed,
      };
    }

    const taskCaseId = taskToCase.get(trimmed);
    if (taskCaseId) {
      return {
        caseId: taskCaseId,
        linkKind: "related-record",
        linkedEntityType: "Task",
        linkedEntityId: trimmed,
      };
    }

    const feedCaseId = feedToCase.get(trimmed);
    if (feedCaseId) {
      return {
        caseId: feedCaseId,
        linkKind: "related-record",
        linkedEntityType: "FeedPost",
        linkedEntityId: trimmed,
      };
    }

    return null;
  };
}

function sortAttachments(entries: CaseAttachmentSummary[]) {
  return entries.sort((left, right) => {
    const leftDate = left.createdAt ?? "";
    const rightDate = right.createdAt ?? "";
    const dateOrder = leftDate.localeCompare(rightDate);
    if (dateOrder !== 0) {
      return dateOrder;
    }
    return left.id.localeCompare(right.id);
  });
}

function buildSamplesFromAttachments(
  casesById: Map<string, AttachmentCaseTarget>,
  attachmentsByCase: Map<string, CaseAttachmentSummary[]>,
) {
  return [...attachmentsByCase.entries()]
    .filter(([, entries]) => entries.length > 0)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([caseId, entries]) => {
      const linkKinds = entries.reduce<
        Partial<Record<"case-direct" | "related-record", number>>
      >((counts, item) => {
        const linkKind = item.sourceTrace.linkKind;
        counts[linkKind] = (counts[linkKind] ?? 0) + 1;
        return counts;
      }, {});

      return {
        caseId,
        caseNumber: casesById.get(caseId)?.caseNumber ?? caseId,
        attachmentCount: entries.length,
        linkKinds,
      };
    });
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
  const casesById = new Map<string, AttachmentCaseTarget>();
  db.cases.forEach((entry) => {
    if (entry.sourceTrace?.source === "salesforce") {
      casesById.set(entry.id, {
        id: entry.id,
        caseNumber: entry.caseNumber,
      });
    }
  });
  return casesById;
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
        source_trace AS sourceTrace
      FROM cases
    `,
  );

  const casesById = new Map<string, AttachmentCaseTarget>();
  rows.forEach((row) => {
    const sourceTrace = parseSourceTrace(row.sourceTrace);
    if (sourceTrace?.source === "salesforce") {
      casesById.set(row.id, {
        id: row.id,
        caseNumber: row.caseNumber,
      });
    }
  });
  return casesById;
}

function prepareAttachmentImport(
  casesById: Map<string, AttachmentCaseTarget>,
  users: TimelineUserTarget[],
  exportDir: string,
): PreparedAttachmentImport {
  if (casesById.size === 0) {
    throw new Error(
      env.repoDriver === "mysql"
        ? "No Salesforce-backed cases found in MySQL. Run the Salesforce case importer first."
        : "No Salesforce-backed cases found in JSON store. Run the Salesforce case importer first.",
    );
  }

  const userRows = readCsvRows(path.join(exportDir, "User.csv"));
  const emailRows = readCsvRows(path.join(exportDir, "EmailMessage.csv"));
  const taskRows = readCsvRows(path.join(exportDir, "Task.csv"));
  const feedRows = readCsvRows(path.join(exportDir, "FeedPost.csv"));
  const legacyAttachmentRows = readCsvRows(path.join(exportDir, "Attachment.csv"));
  const contentDocumentLinkRows = readCsvRows(path.join(exportDir, "ContentDocumentLink.csv"));
  const contentVersionRows = readCsvRows(path.join(exportDir, "ContentVersion.csv"));

  const displayUser = buildUserLookup(users, userRows);
  const caseIds = new Set(casesById.keys());
  const resolveCaseLink = buildEntityResolvers(caseIds, emailRows, taskRows, feedRows);

  const latestContentVersionByDocumentId = new Map(
    contentVersionRows
      .filter((row) => row.IsLatest.trim() === "1")
      .map((row) => [row.ContentDocumentId.trim(), row] as const),
  );

  const attachmentsByCase = new Map<string, CaseAttachmentSummary[]>();
  const pushAttachment = (caseId: string, entry: CaseAttachmentSummary) => {
    const existing = attachmentsByCase.get(caseId);
    if (existing) {
      existing.push(entry);
      return;
    }
    attachmentsByCase.set(caseId, [entry]);
  };

  let legacyAttachments = 0;
  let unresolvedLegacyAttachments = 0;
  for (const row of legacyAttachmentRows) {
    const resolved = resolveCaseLink(row.ParentId);
    if (!resolved) {
      unresolvedLegacyAttachments += 1;
      continue;
    }

    pushAttachment(resolved.caseId, {
      id: `sf-attachment-${row.Id.trim()}`,
      kind: "legacy-attachment",
      name: row.Name.trim() || row.Id.trim(),
      description: trimOrUndefined(row.Description),
      mimeType: trimOrUndefined(row.ContentType),
      sizeBytes: toOptionalNumber(row.BodyLength),
      isPrivate: toBooleanFlag(row.IsPrivate),
      createdAt: toIsoTimestamp(row.CreatedDate),
      owner: displayUser(row.OwnerId),
      exportRelativePath: `Attachments/${row.Id.trim()}`,
      sourceTrace: {
        source: "salesforce",
        object: "Attachment",
        externalId: row.Id.trim(),
        attachmentKind: "legacy-attachment",
        linkKind: resolved.linkKind,
        linkedCaseId: resolved.caseId,
        linkedEntityId: resolved.linkedEntityId,
        linkedEntityType: resolved.linkedEntityType,
        attachmentId: row.Id.trim(),
        parentId: trimOrUndefined(row.ParentId),
      },
    });
    legacyAttachments += 1;
  }

  let contentDocumentLinks = 0;
  let unresolvedContentDocumentLinks = 0;
  let missingContentVersions = 0;
  for (const row of contentDocumentLinkRows) {
    const resolved = resolveCaseLink(row.LinkedEntityId);
    if (!resolved) {
      unresolvedContentDocumentLinks += 1;
      continue;
    }

    const contentVersion = latestContentVersionByDocumentId.get(row.ContentDocumentId.trim());
    if (!contentVersion) {
      missingContentVersions += 1;
      continue;
    }

    const exportRelativePath = `ContentVersion/${contentVersion.Id.trim()}`;
    if (!fs.existsSync(path.join(exportDir, exportRelativePath))) {
      missingContentVersions += 1;
      continue;
    }

    const derivedName =
      path.basename(contentVersion.PathOnClient.trim())
      || contentVersion.Title.trim()
      || contentVersion.Id.trim();

    pushAttachment(resolved.caseId, {
      id: `sf-content-link-${row.Id.trim()}`,
      kind: "content-version",
      name: derivedName,
      title: trimOrUndefined(contentVersion.Title),
      description: trimOrUndefined(contentVersion.Description),
      fileType: trimOrUndefined(contentVersion.FileType),
      sizeBytes: toOptionalNumber(contentVersion.ContentSize),
      isPrivate: row.Visibility.trim() !== "AllUsers",
      createdAt: toIsoTimestamp(contentVersion.CreatedDate),
      owner: displayUser(contentVersion.OwnerId),
      exportRelativePath,
      sourceTrace: {
        source: "salesforce",
        object: "ContentDocumentLink",
        externalId: row.Id.trim(),
        attachmentKind: "content-version",
        linkKind: resolved.linkKind,
        linkedCaseId: resolved.caseId,
        linkedEntityId: resolved.linkedEntityId,
        linkedEntityType: resolved.linkedEntityType,
        contentDocumentLinkId: row.Id.trim(),
        contentDocumentId: row.ContentDocumentId.trim(),
        contentVersionId: contentVersion.Id.trim(),
      },
    });
    contentDocumentLinks += 1;
  }

  return {
    attachmentsByCase,
    imported: {
      legacyAttachments,
      contentDocumentLinks,
      totalAttachments: legacyAttachments + contentDocumentLinks,
      casesTouched: [...attachmentsByCase.values()].filter((entries) => entries.length > 0).length,
    },
    skipped: {
      unresolvedLegacyAttachments,
      unresolvedContentDocumentLinks,
      missingContentVersions,
    },
    samples: buildSamplesFromAttachments(casesById, attachmentsByCase),
  };
}

function writeJsonAttachmentImport(
  exportDir: string,
  prepared: PreparedAttachmentImport,
): SalesforceAttachmentImportResult {
  const db = readDatabase();
  const salesforceCaseIds = new Set(
    db.cases.filter((entry) => entry.sourceTrace?.source === "salesforce").map((entry) => entry.id),
  );

  db.cases = db.cases.map((entry) => {
    if (!salesforceCaseIds.has(entry.id)) {
      return entry;
    }

    const importedAttachments = prepared.attachmentsByCase.get(entry.id) ?? [];
    const preservedAttachments = (entry.attachments ?? []).filter(
      (item) => item.sourceTrace?.source !== "salesforce",
    );

    return {
      ...entry,
      attachments: sortAttachments([...preservedAttachments, ...importedAttachments]),
    };
  });

  writeDatabase(db);

  return {
    exportDir,
    imported: prepared.imported,
    skipped: prepared.skipped,
    samples: prepared.samples,
  };
}

async function countStoredSalesforceAttachments() {
  const pool = getMySqlPool();
  const [rows] = await pool.query<CountRow[]>(
    `
      SELECT COUNT(*) AS count
      FROM case_attachments
      WHERE JSON_UNQUOTE(JSON_EXTRACT(source_trace, '$.source')) = 'salesforce'
    `,
  );

  return rows[0]?.count ?? 0;
}

async function writeMySqlAttachmentImport(
  exportDir: string,
  prepared: PreparedAttachmentImport,
): Promise<SalesforceAttachmentImportResult> {
  const pool = getMySqlPool();
  const connection = await pool.getConnection();
  const allAttachments = [...prepared.attachmentsByCase.entries()].flatMap(([caseId, entries]) =>
    entries.map((entry) => ({ caseId, entry })),
  );

  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM case_attachments");

    for (const row of allAttachments) {
      const { caseId, entry } = row;
      await connection.execute(
        `
          INSERT INTO case_attachments (
            id,
            case_id,
            kind,
            link_kind,
            name,
            title,
            description,
            mime_type,
            file_type,
            size_bytes,
            is_private,
            created_at,
            owner,
            export_relative_path,
            source_trace
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          entry.id,
          caseId,
          entry.kind,
          entry.sourceTrace.linkKind,
          entry.name,
          entry.title ?? null,
          entry.description ?? null,
          entry.mimeType ?? null,
          entry.fileType ?? null,
          entry.sizeBytes ?? null,
          entry.isPrivate === undefined ? null : entry.isPrivate ? 1 : 0,
          entry.createdAt ?? null,
          entry.owner ?? null,
          entry.exportRelativePath ?? null,
          JSON.stringify(entry.sourceTrace),
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

  const skippedTotal = Object.values(prepared.skipped).reduce((sum, value) => sum + value, 0);

  return {
    exportDir,
    imported: prepared.imported,
    skipped: prepared.skipped,
    samples: prepared.samples,
    audit: {
      inserted: allAttachments.length,
      updated: 0,
      skipped: skippedTotal,
      skipReasons: {
        unresolvedLegacyAttachments: prepared.skipped.unresolvedLegacyAttachments,
        unresolvedContentDocumentLinks: prepared.skipped.unresolvedContentDocumentLinks,
        missingContentVersions: prepared.skipped.missingContentVersions,
      },
      storedSalesforceAttachments: await countStoredSalesforceAttachments(),
    },
  };
}

export async function importSalesforceAttachments(
  exportDir = path.resolve(process.cwd(), "imports/salesforce/exports/2026-04-25"),
): Promise<SalesforceAttachmentImportResult> {
  if (env.repoDriver === "mysql") {
    try {
      const [casesById, users] = await Promise.all([loadMySqlCaseMap(), loadMySqlUsers()]);
      const prepared = prepareAttachmentImport(casesById, users, exportDir);
      return await writeMySqlAttachmentImport(exportDir, prepared);
    } finally {
      await closeMySqlPool();
    }
  }

  const db = readDatabase();
  const prepared = prepareAttachmentImport(buildJsonCaseMap(db), buildJsonUsers(db), exportDir);
  return writeJsonAttachmentImport(exportDir, prepared);
}
