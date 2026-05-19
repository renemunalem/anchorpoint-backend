import path from "path";
import fs from "fs";
import { RowDataPacket } from "mysql2/promise";
import {
  CaseDetail,
  CasePriority,
  CaseStatus,
  CaseType,
  DatabaseState,
  Member,
  SeedUser,
  UrgencyTone,
} from "../../types/models";
import { createSeedState } from "../../data/seedState";
import { env } from "../../config/env";
import { getMySqlConfig, validateMySqlConfig } from "../../config/mysql";
import { getPostgresConfig, validatePostgresConfig } from "../../config/postgres";
import { readDatabase, writeDatabase } from "../../repos/json/jsonStore";
import { closeMySqlPool, getMySqlPool } from "../../repos/mysql/client";
import { closePostgresPool, getPostgresPool } from "../../repos/postgres/client";

type CsvRow = Record<string, string>;
type CountRow = RowDataPacket & { count: number };
type PostgresCountRow = { count: string | number };

interface SalesforceMvpPayload {
  importedUsers: SeedUser[];
  members: Member[];
  uniqueMembers: Member[];
  cases: CaseDetail[];
  preservedLocalUsers: SeedUser[];
  usersById: Map<string, SeedUser>;
  audit: SalesforceImportAudit;
}

export interface SalesforceImportSample {
  caseId: string;
  caseNumber: string;
  memberId: string;
  memberName: string | null;
  agentName: string;
  ownerUserId?: string;
}

export interface SalesforceImportResult {
  exportDir: string;
  driver: "json" | "mysql" | "postgres";
  imported: {
    cases: number;
    members: number;
    users: number;
  };
  preserved: {
    localUsers: number;
  };
  stored: {
    cases: number;
    members: number;
    users: number;
  };
  skipped: {
    timeline: true;
    attachments: true;
  };
  samples: SalesforceImportSample[];
  audit?: SalesforceImportAudit;
}

export interface SalesforceImportAudit {
  contactsProcessed: number;
  membersInserted: number;
  membersUpdated: number;
  membersMappedToNoMember?: number;
  invalidSubscriberMemberIdSamples?: Array<{
    sample: string;
    length: number;
    classification: string;
  }>;
  casesMappedToNoMember?: number;
  skippedMembers: {
    total: number;
    reasons: Record<string, number>;
  };
  duplicateKeyCollisions: {
    distinctKeys: number;
    duplicateRows: number;
    sampleKeys: Array<{
      memberKey: string;
      contactIds: string[];
    }>;
  };
  reconciliation: string;
}

interface MemberCollisionBucket {
  rowCount: number;
  contactIds: string[];
}

interface PostgresNormalizedPayload {
  uniqueMembers: Member[];
  cases: CaseDetail[];
  audit: SalesforceImportAudit;
}

const CANONICAL_NO_MEMBER_ID = "0000";
const INVALID_SUBSCRIBER_MEMBER_ID_LITERALS = new Set([",", ".", "0", "00", "0000"]);

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

function compactDate(value: string) {
  return value.trim().slice(0, 10);
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

function normalizeCaseType(row: CsvRow): CaseType {
  const inquiry = row.Inquiry_Type__c.trim().toUpperCase();

  if (inquiry === "CLAIM STATUS") return "Claims";
  if (inquiry === "APPEAL" || inquiry === "NON COVERAGE LETTER") return "Appeal";
  if (
    inquiry === "PRE-AUTH" ||
    inquiry === "SPECIALTY MED RESEARCH" ||
    inquiry === "PLAN EXCEPTION"
  ) {
    return "Prior Auth";
  }
  if (
    inquiry === "BENEFIT VERIFICATION" ||
    inquiry === "ELIGIBILITY" ||
    inquiry === "NETWORK PROVIDER CHECK" ||
    inquiry === "GENERAL INQUIRY" ||
    inquiry === "ZCONNECT QUESTIONS"
  ) {
    return row.Claim__c.trim() ? "Claims" : "Eligibility";
  }

  if (row.Claim__c.trim()) return "Claims";
  return "Eligibility";
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

function normalizePriority(value: string): CasePriority {
  const priority = value.trim().toUpperCase();

  if (priority === "CRITICAL" || priority === "URGENT") return "Urgent";
  if (priority === "HIGH") return "High";
  return "Normal";
}

function buildUrgency(status: CaseStatus, priority: CasePriority) {
  if (status === "Closed") {
    return { label: "Closed", tone: "normal" as UrgencyTone };
  }

  if (priority === "Urgent" || status === "Escalated") {
    return { label: "4h", tone: "critical" as UrgencyTone };
  }

  if (priority === "High" || status === "Waiting") {
    return { label: "24h", tone: "warning" as UrgencyTone };
  }

  return { label: "48h", tone: "normal" as UrgencyTone };
}

function toBooleanFlag(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function deriveRelationshipType(row: CsvRow): Member["relationshipType"] {
  const memberType = row.Member_Type__c.trim().toLowerCase();

  if (memberType === "policy holder") return "Subscriber";
  if (memberType === "spouse") return "Spouse";
  if (memberType === "dependent" || toBooleanFlag(row.Child__c)) return "Child";
  return "Other";
}

function deriveCoverageTier(row: CsvRow): Member["coverageTier"] {
  const relationshipType = deriveRelationshipType(row);
  if (relationshipType === "Subscriber") return "Single";
  if (relationshipType === "Spouse") return "Employee + Spouse";
  if (relationshipType === "Child") return "Employee + Children";
  return "Family";
}

function deriveMemberStatus(row: CsvRow) {
  if (row.Eligibility__c.trim().toLowerCase() === "terminated") {
    return "Terminated" as const;
  }

  const termDate = compactDate(row.Eligibility_End_Date__c);
  if (termDate && termDate < "2026-04-25" && termDate !== "2999-12-31") {
    return "Terminated" as const;
  }

  return "Active" as const;
}

function trimOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function maskIdentifier(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 6) {
    return `${trimmed.slice(0, 2)}***`;
  }

  return `${trimmed.slice(0, 4)}***${trimmed.slice(-3)}`;
}

function buildSyntheticAgentEmail(userId: string) {
  return `sf-user-${userId.toLowerCase()}@atlasai.local`;
}

function buildUserDisplayName(row: CsvRow) {
  const joined = [row.FirstName.trim(), row.LastName.trim()].filter(Boolean).join(" ");
  return joined || row.Alias.trim() || row.Username.trim() || row.Id;
}

function buildMemberDisplayName(firstName?: string, lastName?: string) {
  const joined = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ");
  return joined || "Unknown Member";
}

function looksLikeSalesforceId(value: string) {
  return /^[a-zA-Z0-9]{15,18}$/.test(value.trim());
}

function buildActionItem(row: CsvRow, caseType: CaseType) {
  const inquiry = row.Inquiry_Type__c.trim() || caseType;
  const claim = row.Claim__c.trim();
  const group = row.Group__c.trim();

  if (claim) {
    return `Review ${inquiry.toLowerCase()} request for claim ${claim}.`;
  }

  if (group) {
    return `Review ${inquiry.toLowerCase()} request for group ${group}.`;
  }

  return `Review imported ${inquiry.toLowerCase()} case.`;
}

function buildPlanId(planName: string, groupNumber: string) {
  const normalized = planName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `sf-plan-${groupNumber || "unknown"}-${normalized}` : `sf-plan-${groupNumber || "unknown"}`;
}

function buildCanonicalNoMember(): Member {
  return {
    id: CANONICAL_NO_MEMBER_ID,
    subscriberMemberId: CANONICAL_NO_MEMBER_ID,
    firstName: "No",
    lastName: "Member",
    birthdate: "",
    ssn: "",
    phoneNumber: "",
    email: "",
    addressLine1: "",
    city: "",
    state: "",
    zipCode: "",
    accountGroupName: "",
    groupNumber: "",
    planName: "",
    planId: "",
    cobra: false,
    coverageEffectiveDate: "",
    coverageTermDate: "",
    coverageTier: "Single",
    relationshipType: "Other",
    memberStatus: "Active",
    cobStatus: "Unknown",
    cobCoverageTypes: [],
    cobDetails: "",
    cobReportedAt: "",
  };
}

function normalizeSubscriberMemberId(value: string) {
  return value.trim();
}

function classifyInvalidSubscriberMemberId(value: string) {
  const normalized = normalizeSubscriberMemberId(value);

  if (!normalized) {
    return "empty";
  }

  if (INVALID_SUBSCRIBER_MEMBER_ID_LITERALS.has(normalized)) {
    return "reserved_literal";
  }

  if (!/^[0-9]+$/.test(normalized)) {
    return "non_numeric";
  }

  if (normalized.length < 6) {
    return "too_short";
  }

  return "unknown";
}

function isValidSubscriberMemberId(value: string) {
  const normalized = normalizeSubscriberMemberId(value);

  return (
    normalized.length >= 6
    && /^[0-9]+$/.test(normalized)
    && !INVALID_SUBSCRIBER_MEMBER_ID_LITERALS.has(normalized)
  );
}

function pickMemberSnapshot(member: Member): NonNullable<CaseDetail["member"]> {
  return {
    id: member.id,
    subscriberMemberId: member.subscriberMemberId,
    firstName: member.firstName,
    lastName: member.lastName,
    accountGroupName: member.accountGroupName,
    groupNumber: member.groupNumber,
    planName: member.planName,
    planId: member.planId,
    coverageTier: member.coverageTier,
    relationshipType: member.relationshipType,
    memberStatus: member.memberStatus,
    cobStatus: member.cobStatus,
  };
}

function buildPlaceholderMember(
  caseRow: CsvRow,
  accountRow?: CsvRow,
): Member {
  const memberId = caseRow.Member_ID__c.trim() || caseRow.ContactId.trim() || caseRow.Id.trim();
  const firstName = caseRow.Member_First_Name__c.trim();
  const lastName = caseRow.Member_Last_Name__c.trim();
  const groupNumber = caseRow.Group__c.trim() || accountRow?.Group__c?.trim() || "";
  const planName = caseRow.Cigna_Plan__c.trim();

  return {
    id: memberId,
    subscriberMemberId: memberId,
    firstName: firstName || "Unknown",
    lastName: lastName || "Member",
    birthdate: "",
    ssn: "",
    phoneNumber: "",
    email: "",
    addressLine1: "",
    city: "",
    state: "",
    zipCode: "",
    accountGroupName: accountRow?.Name?.trim() || "",
    groupNumber,
    planName,
    planId: buildPlanId(planName, groupNumber),
    cobra: false,
    coverageEffectiveDate: "",
    coverageTermDate: "",
    coverageTier: "Single",
    relationshipType: "Other",
    memberStatus: "Active",
    cobStatus: "Unknown",
    cobCoverageTypes: [],
    cobDetails: "",
    cobReportedAt: "",
    sourceTrace: {
      source: "salesforce",
      externalId: caseRow.ContactId.trim() || caseRow.Id.trim(),
      accountId: trimOrUndefined(caseRow.AccountId),
    },
  };
}

function buildMemberAudit(
  contactRows: CsvRow[],
  uniqueMembers: Member[],
): SalesforceImportAudit {
  const collisions = new Map<string, MemberCollisionBucket>();

  for (const row of contactRows) {
    const memberKey = row.Member_ID__c.trim() || row.Id.trim();
    const existing = collisions.get(memberKey) ?? { rowCount: 0, contactIds: [] };
    existing.rowCount += 1;
    if (existing.contactIds.length < 3) {
      existing.contactIds.push(maskIdentifier(row.Id.trim()));
    }
    collisions.set(memberKey, existing);
  }

  const duplicateEntries = [...collisions.entries()]
    .filter(([, bucket]) => bucket.rowCount > 1)
    .sort((left, right) => right[1].rowCount - left[1].rowCount || left[0].localeCompare(right[0]));

  const duplicateRows = duplicateEntries.reduce(
    (total, [, bucket]) => total + (bucket.rowCount - 1),
    0,
  );

  return {
    contactsProcessed: contactRows.length,
    membersInserted: uniqueMembers.length,
    membersUpdated: 0,
    skippedMembers: {
      total: duplicateRows,
      reasons: {
        duplicate_member_id_collision: duplicateRows,
      },
    },
    duplicateKeyCollisions: {
      distinctKeys: duplicateEntries.length,
      duplicateRows,
      sampleKeys: duplicateEntries.slice(0, 5).map(([memberKey, bucket]) => ({
        memberKey: maskIdentifier(memberKey),
        contactIds: bucket.contactIds,
      })),
    },
    reconciliation:
      duplicateRows > 0
        ? `Processed ${contactRows.length} Salesforce contacts, collapsed ${duplicateRows} duplicate contact rows across ${duplicateEntries.length} repeated Member_ID__c keys, and stored ${uniqueMembers.length} unique members in the AtlasAI persistence store.`
        : `Processed ${contactRows.length} Salesforce contacts and stored ${uniqueMembers.length} unique members in the AtlasAI persistence store with no duplicate Member_ID__c collisions.`,
  };
}

function normalizePostgresPayload(payload: SalesforceMvpPayload): PostgresNormalizedPayload {
  const canonicalNoMember = buildCanonicalNoMember();
  const uniqueMembers = new Map<string, Member>([[CANONICAL_NO_MEMBER_ID, canonicalNoMember]]);
  const invalidValueToSample = new Map<
    string,
    { sample: string; length: number; classification: string }
  >();

  let membersMappedToNoMember = 0;
  let casesMappedToNoMember = 0;

  for (const member of payload.uniqueMembers) {
    if (isValidSubscriberMemberId(member.subscriberMemberId)) {
      uniqueMembers.set(member.id, member);
      continue;
    }

    membersMappedToNoMember += 1;
    const normalized = normalizeSubscriberMemberId(member.subscriberMemberId);
    if (!invalidValueToSample.has(normalized) && invalidValueToSample.size < 10) {
      invalidValueToSample.set(normalized, {
        sample: maskIdentifier(normalized || "<empty>"),
        length: normalized.length,
        classification: classifyInvalidSubscriberMemberId(member.subscriberMemberId),
      });
    }
  }

  const normalizedCases = payload.cases.map((caseItem) => {
    if (isValidSubscriberMemberId(caseItem.memberId) && uniqueMembers.has(caseItem.memberId)) {
      return caseItem;
    }

    casesMappedToNoMember += 1;
    return {
      ...caseItem,
      memberId: CANONICAL_NO_MEMBER_ID,
    };
  });

  return {
    uniqueMembers: [...uniqueMembers.values()],
    cases: normalizedCases,
    audit: {
      ...payload.audit,
      membersInserted: uniqueMembers.size,
      membersUpdated: 0,
      membersMappedToNoMember,
      invalidSubscriberMemberIdSamples: [...invalidValueToSample.values()],
      casesMappedToNoMember,
      reconciliation:
        `${payload.audit.reconciliation} `
        + `Postgres normalization mapped ${membersMappedToNoMember} invalid member rows and ${casesMappedToNoMember} cases to canonical member ${CANONICAL_NO_MEMBER_ID}.`,
    },
  };
}

function buildSalesforceMvpPayload(exportDir: string): SalesforceMvpPayload {
  const caseRows = readCsvRows(path.join(exportDir, "Case.csv"));
  const contactRows = readCsvRows(path.join(exportDir, "Contact.csv"));
  const accountRows = readCsvRows(path.join(exportDir, "Account.csv"));
  const userRows = readCsvRows(path.join(exportDir, "User.csv"));

  const accountsById = new Map(accountRows.map((row) => [row.Id.trim(), row]));

  const importedUsers: SeedUser[] = userRows.map((row) => ({
    id: row.Id.trim(),
    firstName: row.FirstName.trim() || row.Alias.trim() || "Salesforce",
    lastName: row.LastName.trim() || row.UserType.trim() || "User",
    email: buildSyntheticAgentEmail(row.Id.trim()),
    password: "change_me",
    role: "Agent",
    status: row.IsActive.trim() === "1" ? "Active" : "Inactive",
    lastLogin: trimOrUndefined(toIsoTimestamp(row.LastLoginDate, "")),
    sourceTrace: {
      source: "salesforce",
      externalId: row.Id.trim(),
      alias: trimOrUndefined(row.Alias),
      userType: trimOrUndefined(row.UserType),
    },
  }));

  const usersById = new Map(importedUsers.map((user) => [user.id, user]));
  const members: Member[] = contactRows.map((row) => {
    const accountRow = accountsById.get(row.AccountId.trim());
    const memberId = row.Member_ID__c.trim() || row.Id.trim();
    const groupNumber = row.Group__c.trim() || accountRow?.Group__c?.trim() || "";
    const planName = row.Plan_Name__c.trim();

    return {
      id: memberId,
      subscriberMemberId: memberId,
      firstName: row.FirstName.trim() || "Unknown",
      lastName: row.LastName.trim() || "Member",
      birthdate: "",
      ssn: "",
      phoneNumber: "",
      email: "",
      addressLine1: "",
      city: "",
      state: "",
      zipCode: "",
      accountGroupName: accountRow?.Name?.trim() || "",
      groupNumber,
      planName,
      planId: buildPlanId(planName, groupNumber),
      cobra: toBooleanFlag(row.COBRA_Flag__c),
      coverageEffectiveDate: compactDate(row.Eligibility_Start_Date__c),
      coverageTermDate: compactDate(row.Eligibility_End_Date__c),
      coverageTier: deriveCoverageTier(row),
      relationshipType: deriveRelationshipType(row),
      memberStatus: deriveMemberStatus(row),
      cobStatus: "Unknown",
      cobCoverageTypes: [],
      cobDetails: "",
      cobReportedAt: "",
      sourceTrace: {
        source: "salesforce",
        externalId: row.Id.trim(),
        accountId: trimOrUndefined(row.AccountId),
      },
    };
  });

  const membersById = new Map(members.map((member) => [member.id, member]));
  const membersByContactId = new Map(
    contactRows.map((row) => {
      const memberId = row.Member_ID__c.trim() || row.Id.trim();
      return [row.Id.trim(), membersById.get(memberId)!] as const;
    }),
  );

  const fallbackTimestamp = new Date("2026-04-25T00:00:00.000Z").toISOString();
  const cases: CaseDetail[] = caseRows.map((row) => {
    const accountRow = accountsById.get(row.AccountId.trim());
    let member =
      membersById.get(row.Member_ID__c.trim()) ??
      membersByContactId.get(row.ContactId.trim());

    if (!member) {
      member = buildPlaceholderMember(row, accountRow);
      members.push(member);
      membersById.set(member.id, member);
      if (row.ContactId.trim()) {
        membersByContactId.set(row.ContactId.trim(), member);
      }
    }

    const caseType = normalizeCaseType(row);
    const status = normalizeCaseStatus(row.Status);
    const priority = normalizePriority(row.Priority);
    const ownerId = row.OwnerId.trim();
    const ownerUser = usersById.get(ownerId);
    const caseMemberNameValue = row.Member_Name__c.trim();
    const memberName =
      buildMemberDisplayName(
        row.Member_First_Name__c.trim() || (member.firstName ?? undefined),
        row.Member_Last_Name__c.trim() || (member.lastName ?? undefined),
      ) ||
      (!looksLikeSalesforceId(caseMemberNameValue) ? caseMemberNameValue : "") ||
      buildMemberDisplayName(member.firstName ?? undefined, member.lastName ?? undefined);

    return {
      id: row.Id.trim(),
      caseNumber: row.CaseNumber.trim() || row.Id.trim(),
      memberId: member.id,
      memberName:
        !looksLikeSalesforceId(caseMemberNameValue) && caseMemberNameValue
          ? caseMemberNameValue
          : memberName,
      caseType,
      status,
      actionItem: buildActionItem(row, caseType),
      urgency: buildUrgency(status, priority),
      createdAt: toIsoTimestamp(row.CreatedDate, fallbackTimestamp),
      updatedAt: toIsoTimestamp(row.LastModifiedDate, fallbackTimestamp),
      agent: ownerUser ? buildUserDisplayName({
        FirstName: ownerUser.firstName,
        LastName: ownerUser.lastName,
        Alias: ownerUser.sourceTrace?.alias || "",
        Username: "",
        Id: ownerUser.id,
      }) : row.Assigned_To__c.trim() || "Unassigned",
      groupNumber: row.Group__c.trim() || member.groupNumber || accountRow?.Group__c?.trim() || "",
      claimNumber: row.Claim__c.trim(),
      priority,
      closedAt:
        status === "Closed" ? trimOrUndefined(toIsoTimestamp(row.ClosedDate, fallbackTimestamp)) : undefined,
      fcr: trimOrUndefined(row.First_Call_Resolution__c),
      resolution: trimOrUndefined(row.Resolution__c),
      claimStatus: trimOrUndefined(row.Claim_Status__c),
      followUpDate: trimOrUndefined(compactDate(row.Follow_Up_Date__c)),
      dueAt: null,
      timeline: [],
      attachments: [],
      member: pickMemberSnapshot(member),
      sourceTrace: {
        source: "salesforce",
        externalId: row.Id.trim(),
        contactId: trimOrUndefined(row.ContactId),
        accountId: trimOrUndefined(row.AccountId),
        ownerId: trimOrUndefined(row.OwnerId),
        memberExternalId: trimOrUndefined(row.Member_ID__c),
      },
    };
  });

  const uniqueMembers = [...membersById.values()];
  const audit = buildMemberAudit(contactRows, uniqueMembers);

  const contactsWithMissingName = contactRows.filter(
    (row) => !row.FirstName.trim() || !row.LastName.trim(),
  ).length;
  if (contactsWithMissingName > 0) {
    console.warn(
      `[import:salesforce] ${contactsWithMissingName} of ${contactRows.length} Salesforce contacts have null/empty first or last name in source data (${((contactsWithMissingName / contactRows.length) * 100).toFixed(1)}%)`,
    );
  }

  return {
    importedUsers,
    members,
    uniqueMembers,
    cases,
    preservedLocalUsers: createSeedState().users.filter((user) => !user.sourceTrace),
    usersById,
    audit,
  };
}

function buildSamples(cases: CaseDetail[], usersById: Map<string, SeedUser>): SalesforceImportSample[] {
  return cases
    .filter((entry) => entry.member && entry.sourceTrace?.ownerId && usersById.has(entry.sourceTrace.ownerId))
    .slice(0, 2)
    .map((entry) => ({
      caseId: entry.id,
      caseNumber: entry.caseNumber,
      memberId: entry.memberId,
      memberName: entry.memberName,
      agentName: entry.agent,
      ownerUserId: entry.sourceTrace?.ownerId,
    }));
}

function writeJsonImport(exportDir: string, payload: SalesforceMvpPayload): SalesforceImportResult {
  const existingDatabase = readDatabase();

  const nextState: DatabaseState = {
    ...existingDatabase,
    users: [...payload.preservedLocalUsers, ...payload.importedUsers],
    members: payload.members,
    cases: payload.cases,
  };

  writeDatabase(nextState);

  return {
    exportDir,
    driver: "json",
    imported: {
      cases: payload.cases.length,
      members: payload.members.length,
      users: payload.importedUsers.length,
    },
    preserved: {
      localUsers: payload.preservedLocalUsers.length,
    },
    stored: {
      cases: nextState.cases.length,
      members: nextState.members.length,
      users: nextState.users.length,
    },
    skipped: {
      timeline: true,
      attachments: true,
    },
    samples: buildSamples(payload.cases, payload.usersById),
  };
}

async function countRows(tableName: "users" | "members" | "cases") {
  const pool = getMySqlPool();
  const [rows] = await pool.query<CountRow[]>(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return rows[0]?.count ?? 0;
}

async function countPostgresRows(tableName: "users" | "members" | "cases") {
  const pool = getPostgresPool();
  const { rows } = await pool.query<PostgresCountRow>(
    `SELECT COUNT(*)::bigint AS count FROM ${tableName}`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function writeMySqlImport(exportDir: string, payload: SalesforceMvpPayload): Promise<SalesforceImportResult> {
  const mysqlConfig = getMySqlConfig();
  validateMySqlConfig(mysqlConfig);

  const pool = getMySqlPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query("DELETE FROM case_timeline");
    await connection.query("DELETE FROM cases");
    await connection.query("DELETE FROM members");
    await connection.query("DELETE FROM users WHERE source_trace IS NOT NULL");

    for (const user of payload.importedUsers) {
      await connection.execute(
        `
          INSERT INTO users (
            id,
            first_name,
            last_name,
            email,
            password,
            role,
            status,
            last_login,
            source_trace
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            email = VALUES(email),
            password = VALUES(password),
            role = VALUES(role),
            status = VALUES(status),
            last_login = VALUES(last_login),
            source_trace = VALUES(source_trace)
        `,
        [
          user.id,
          user.firstName,
          user.lastName,
          user.email,
          user.password,
          user.role,
          user.status,
          user.lastLogin ?? null,
          user.sourceTrace ? JSON.stringify(user.sourceTrace) : null,
        ],
      );
    }

    for (const member of payload.uniqueMembers) {
      await connection.execute(
        `
          INSERT INTO members (
            id,
            subscriber_member_id,
            first_name,
            last_name,
            birthdate,
            ssn,
            phone_number,
            email,
            address_line1,
            city,
            state,
            zip_code,
            account_group_name,
            group_number,
            plan_name,
            plan_id,
            cobra,
            coverage_effective_date,
            coverage_term_date,
            coverage_tier,
            relationship_type,
            member_status,
            cob_status,
            cob_coverage_types,
            cob_details,
            cob_reported_at,
            source_trace
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            subscriber_member_id = VALUES(subscriber_member_id),
            first_name = VALUES(first_name),
            last_name = VALUES(last_name),
            birthdate = VALUES(birthdate),
            ssn = VALUES(ssn),
            phone_number = VALUES(phone_number),
            email = VALUES(email),
            address_line1 = VALUES(address_line1),
            city = VALUES(city),
            state = VALUES(state),
            zip_code = VALUES(zip_code),
            account_group_name = VALUES(account_group_name),
            group_number = VALUES(group_number),
            plan_name = VALUES(plan_name),
            plan_id = VALUES(plan_id),
            cobra = VALUES(cobra),
            coverage_effective_date = VALUES(coverage_effective_date),
            coverage_term_date = VALUES(coverage_term_date),
            coverage_tier = VALUES(coverage_tier),
            relationship_type = VALUES(relationship_type),
            member_status = VALUES(member_status),
            cob_status = VALUES(cob_status),
            cob_coverage_types = VALUES(cob_coverage_types),
            cob_details = VALUES(cob_details),
            cob_reported_at = VALUES(cob_reported_at),
            source_trace = VALUES(source_trace)
        `,
        [
          member.id,
          member.subscriberMemberId,
          member.firstName,
          member.lastName,
          member.birthdate,
          member.ssn,
          member.phoneNumber,
          member.email,
          member.addressLine1,
          member.city,
          member.state,
          member.zipCode,
          member.accountGroupName,
          member.groupNumber,
          member.planName,
          member.planId,
          member.cobra ? 1 : 0,
          member.coverageEffectiveDate,
          member.coverageTermDate,
          member.coverageTier,
          member.relationshipType,
          member.memberStatus,
          member.cobStatus,
          JSON.stringify(member.cobCoverageTypes),
          member.cobDetails,
          member.cobReportedAt,
          member.sourceTrace ? JSON.stringify(member.sourceTrace) : null,
        ],
      );
    }

    for (const caseItem of payload.cases) {
      await connection.execute(
        `
          INSERT INTO cases (
            id,
            case_number,
            member_id,
            member_name,
            case_type,
            status,
            action_item,
            urgency_label,
            urgency_tone,
            created_at,
            updated_at,
            agent,
            group_number,
            claim_number,
            priority,
            description,
            closed_at,
            fcr,
            resolution,
            resolution_details,
            source_trace
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            case_number = VALUES(case_number),
            member_id = VALUES(member_id),
            member_name = VALUES(member_name),
            case_type = VALUES(case_type),
            status = VALUES(status),
            action_item = VALUES(action_item),
            urgency_label = VALUES(urgency_label),
            urgency_tone = VALUES(urgency_tone),
            created_at = VALUES(created_at),
            updated_at = VALUES(updated_at),
            agent = VALUES(agent),
            group_number = VALUES(group_number),
            claim_number = VALUES(claim_number),
            priority = VALUES(priority),
            description = VALUES(description),
            closed_at = VALUES(closed_at),
            fcr = VALUES(fcr),
            resolution = VALUES(resolution),
            resolution_details = VALUES(resolution_details),
            source_trace = VALUES(source_trace)
        `,
        [
          caseItem.id,
          caseItem.caseNumber,
          caseItem.memberId,
          caseItem.memberName,
          caseItem.caseType,
          caseItem.status,
          caseItem.actionItem,
          caseItem.urgency.label,
          caseItem.urgency.tone,
          caseItem.createdAt,
          caseItem.updatedAt,
          caseItem.agent,
          caseItem.groupNumber,
          caseItem.claimNumber,
          caseItem.priority,
          caseItem.description ?? null,
          caseItem.closedAt ?? null,
          caseItem.fcr ?? null,
          caseItem.resolution ?? null,
          caseItem.resolutionDetails ?? null,
          caseItem.sourceTrace ? JSON.stringify(caseItem.sourceTrace) : null,
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
    driver: "mysql",
    imported: {
      cases: payload.cases.length,
      members: payload.members.length,
      users: payload.importedUsers.length,
    },
    preserved: {
      localUsers: payload.preservedLocalUsers.length,
    },
    stored: {
      cases: await countRows("cases"),
      members: await countRows("members"),
      users: await countRows("users"),
    },
    skipped: {
      timeline: true,
      attachments: true,
    },
    samples: buildSamples(payload.cases, payload.usersById),
    audit: payload.audit,
  };
}

async function writePostgresImport(
  exportDir: string,
  payload: SalesforceMvpPayload,
): Promise<SalesforceImportResult> {
  const postgresConfig = getPostgresConfig();
  validatePostgresConfig(postgresConfig);
  const normalized = normalizePostgresPayload(payload);

  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM case_attachments");
    await client.query("DELETE FROM case_timeline");
    await client.query("DELETE FROM cases");
    await client.query("DELETE FROM members");
    await client.query("DELETE FROM users WHERE source_trace IS NOT NULL");

    for (const user of payload.importedUsers) {
      await client.query(
        `
          INSERT INTO users (
            id,
            first_name,
            last_name,
            email,
            password,
            role,
            status,
            last_login,
            source_trace
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            email = EXCLUDED.email,
            password = EXCLUDED.password,
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            last_login = EXCLUDED.last_login,
            source_trace = EXCLUDED.source_trace
        `,
        [
          user.id,
          user.firstName,
          user.lastName,
          user.email,
          user.password,
          user.role,
          user.status,
          user.lastLogin ?? null,
          user.sourceTrace ? JSON.stringify(user.sourceTrace) : null,
        ],
      );
    }

    for (const member of normalized.uniqueMembers) {
      await client.query(
        `
          INSERT INTO members (
            id,
            subscriber_member_id,
            first_name,
            last_name,
            birthdate,
            ssn,
            phone_number,
            email,
            address_line1,
            city,
            state,
            zip_code,
            account_group_name,
            group_number,
            plan_name,
            plan_id,
            cobra,
            coverage_effective_date,
            coverage_term_date,
            coverage_tier,
            relationship_type,
            member_status,
            cob_status,
            cob_coverage_types,
            cob_details,
            cob_reported_at,
            source_trace
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23, $24::jsonb, $25, $26, $27::jsonb
          )
          ON CONFLICT (id) DO UPDATE SET
            subscriber_member_id = EXCLUDED.subscriber_member_id,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            birthdate = EXCLUDED.birthdate,
            ssn = EXCLUDED.ssn,
            phone_number = EXCLUDED.phone_number,
            email = EXCLUDED.email,
            address_line1 = EXCLUDED.address_line1,
            city = EXCLUDED.city,
            state = EXCLUDED.state,
            zip_code = EXCLUDED.zip_code,
            account_group_name = EXCLUDED.account_group_name,
            group_number = EXCLUDED.group_number,
            plan_name = EXCLUDED.plan_name,
            plan_id = EXCLUDED.plan_id,
            cobra = EXCLUDED.cobra,
            coverage_effective_date = EXCLUDED.coverage_effective_date,
            coverage_term_date = EXCLUDED.coverage_term_date,
            coverage_tier = EXCLUDED.coverage_tier,
            relationship_type = EXCLUDED.relationship_type,
            member_status = EXCLUDED.member_status,
            cob_status = EXCLUDED.cob_status,
            cob_coverage_types = EXCLUDED.cob_coverage_types,
            cob_details = EXCLUDED.cob_details,
            cob_reported_at = EXCLUDED.cob_reported_at,
            source_trace = EXCLUDED.source_trace
        `,
        [
          member.id,
          member.subscriberMemberId,
          member.firstName,
          member.lastName,
          member.birthdate || null,
          member.ssn || null,
          member.phoneNumber || null,
          member.email || null,
          member.addressLine1 || null,
          member.city || null,
          member.state || null,
          member.zipCode || null,
          member.accountGroupName,
          member.groupNumber,
          member.planName || null,
          member.planId || null,
          member.cobra,
          member.coverageEffectiveDate,
          member.coverageTermDate,
          member.coverageTier,
          member.relationshipType,
          member.memberStatus,
          member.cobStatus,
          JSON.stringify(member.cobCoverageTypes),
          member.cobDetails || null,
          member.cobReportedAt,
          member.sourceTrace ? JSON.stringify(member.sourceTrace) : null,
        ],
      );
    }

    for (const caseItem of normalized.cases) {
      await client.query(
        `
          INSERT INTO cases (
            id,
            case_number,
            member_id,
            member_name,
            case_type,
            status,
            action_item,
            urgency_label,
            urgency_tone,
            created_at,
            updated_at,
            agent,
            group_number,
            claim_number,
            priority,
            description,
            closed_at,
            fcr,
            resolution,
            resolution_details,
            source_trace
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18,
            $19, $20, $21::jsonb
          )
          ON CONFLICT (id) DO UPDATE SET
            case_number = EXCLUDED.case_number,
            member_id = EXCLUDED.member_id,
            member_name = EXCLUDED.member_name,
            case_type = EXCLUDED.case_type,
            status = EXCLUDED.status,
            action_item = EXCLUDED.action_item,
            urgency_label = EXCLUDED.urgency_label,
            urgency_tone = EXCLUDED.urgency_tone,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            agent = EXCLUDED.agent,
            group_number = EXCLUDED.group_number,
            claim_number = EXCLUDED.claim_number,
            priority = EXCLUDED.priority,
            description = EXCLUDED.description,
            closed_at = EXCLUDED.closed_at,
            fcr = EXCLUDED.fcr,
            resolution = EXCLUDED.resolution,
            resolution_details = EXCLUDED.resolution_details,
            source_trace = EXCLUDED.source_trace
        `,
        [
          caseItem.id,
          caseItem.caseNumber,
          caseItem.memberId,
          caseItem.memberName,
          caseItem.caseType,
          caseItem.status,
          caseItem.actionItem,
          caseItem.urgency.label,
          caseItem.urgency.tone,
          caseItem.createdAt,
          caseItem.updatedAt,
          caseItem.agent,
          caseItem.groupNumber,
          caseItem.claimNumber || null,
          caseItem.priority,
          caseItem.description ?? null,
          caseItem.closedAt ?? null,
          caseItem.fcr ?? null,
          caseItem.resolution ?? null,
          caseItem.resolutionDetails ?? null,
          caseItem.sourceTrace ? JSON.stringify(caseItem.sourceTrace) : null,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    exportDir,
    driver: "postgres",
    imported: {
      cases: payload.cases.length,
      members: payload.members.length,
      users: payload.importedUsers.length,
    },
    preserved: {
      localUsers: payload.preservedLocalUsers.length,
    },
    stored: {
      cases: await countPostgresRows("cases"),
      members: await countPostgresRows("members"),
      users: await countPostgresRows("users"),
    },
    skipped: {
      timeline: true,
      attachments: true,
    },
    samples: buildSamples(payload.cases, payload.usersById),
    audit: normalized.audit,
  };
}

export async function importSalesforceMvp(
  exportDir = path.resolve(process.cwd(), "imports/salesforce/exports/2026-04-25"),
): Promise<SalesforceImportResult> {
  const payload = buildSalesforceMvpPayload(exportDir);

  if (env.repoDriver === "mysql") {
    try {
      return await writeMySqlImport(exportDir, payload);
    } finally {
      await closeMySqlPool();
    }
  }

  if (env.repoDriver === "postgres") {
    try {
      return await writePostgresImport(exportDir, payload);
    } finally {
      await closePostgresPool();
    }
  }

  return writeJsonImport(exportDir, payload);
}
