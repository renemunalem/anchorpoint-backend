import fs from "fs";
import path from "path";
import { Client } from "pg";
import { buildDueAt } from "../src/data/cases";
import { ensureDatabaseFile, readDatabase } from "../src/repos/json/jsonStore";
import { Member } from "../src/types/models";
import { getPostgresConfig, validatePostgresConfig } from "../src/config/postgres";

const CANONICAL_NO_MEMBER_ID = "0000";

async function ensureColumn(
  client: Client,
  tableName: string,
  columnName: string,
  definition: string,
) {
  await client.query(
    `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${definition}`,
  );
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function completenessScore(member: Member) {
  const candidates = [
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
    member.coverageEffectiveDate,
    member.coverageTermDate,
    member.coverageTier,
    member.relationshipType,
    member.memberStatus,
    member.cobStatus,
    member.cobDetails,
    member.cobReportedAt,
    member.sourceTrace?.externalId,
    member.sourceTrace?.accountId,
  ];

  return candidates.reduce((score, value) => {
    if (typeof value !== "string") {
      return score;
    }

    return value.trim().length > 0 ? score + 1 : score;
  }, 0);
}

function dedupeMembers(members: Member[]) {
  const byId = new Map<string, Member>();

  for (const member of members) {
    const existing = byId.get(member.id);
    if (!existing || completenessScore(member) > completenessScore(existing)) {
      byId.set(member.id, member);
    }
  }

  return [...byId.values()];
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

async function insertRows(
  client: Client,
  prefix: string,
  rows: unknown[][],
  chunkSize = 250,
) {
  for (const chunk of chunkArray(rows, chunkSize)) {
    const values: unknown[] = [];
    const placeholders = chunk.map((row) => {
      const rowPlaceholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${rowPlaceholders.join(", ")})`;
    });

    await client.query(`${prefix} VALUES ${placeholders.join(", ")}`, values);
  }
}

async function main() {
  const config = getPostgresConfig();
  validatePostgresConfig(config);
  ensureDatabaseFile();

  const schemaPath = path.resolve(__dirname, "../db/postgres/schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const db = readDatabase();
  const dedupedMembers = dedupeMembers(db.members);
  if (!dedupedMembers.some((member) => member.id === CANONICAL_NO_MEMBER_ID)) {
    dedupedMembers.push(buildCanonicalNoMember());
  }

  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });

  await client.connect();

  try {
    await client.query(schemaSql);
    await ensureColumn(client, "cases", "origin", "VARCHAR(32) NOT NULL DEFAULT 'phone'");
    await ensureColumn(client, "cases", "due_at", "VARCHAR(64) NULL");
    await ensureColumn(client, "members", "nifty_member_id", "VARCHAR(64) NULL");
    await ensureColumn(client, "members", "glip_channel_id", "VARCHAR(128) NULL");
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE TABLE case_attachments, case_timeline, cases, rbac_permissions, members, users RESTART IDENTITY CASCADE",
    );

    await insertRows(
      client,
      `
        INSERT INTO users (
          id, first_name, last_name, email, password, role, status, last_login, source_trace
        )
      `,
      db.users.map((user) => [
        user.id,
        user.firstName,
        user.lastName,
        user.email,
        user.password,
        user.role,
        user.status,
        user.lastLogin ?? null,
        user.sourceTrace ? JSON.stringify(user.sourceTrace) : null,
      ]),
    );

    await insertRows(
      client,
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
          nifty_member_id,
          glip_channel_id,
          network,
          source_trace
        )
      `,
      dedupedMembers.map((member) => [
        member.id,
        member.subscriberMemberId,
        member.firstName,
        member.lastName,
        member.birthdate ?? null,
        member.ssn ?? null,
        member.phoneNumber ?? null,
        member.email ?? null,
        member.addressLine1 ?? null,
        member.city ?? null,
        member.state ?? null,
        member.zipCode ?? null,
        member.accountGroupName,
        member.groupNumber,
        member.planName ?? null,
        member.planId ?? null,
        member.cobra,
        member.coverageEffectiveDate,
        member.coverageTermDate,
        member.coverageTier,
        member.relationshipType,
        member.memberStatus,
        member.cobStatus,
        JSON.stringify(member.cobCoverageTypes),
        member.cobDetails ?? null,
        member.cobReportedAt,
        member.niftyMemberId ?? null,
        member.glipChannelId ?? null,
        member.network ?? null,
        member.sourceTrace ? JSON.stringify(member.sourceTrace) : null,
      ]),
      150,
    );

    await insertRows(
      client,
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
          origin,
          due_at,
          source_trace
        )
      `,
      db.cases.map((caseItem) => [
        caseItem.id,
        caseItem.caseNumber,
        caseItem.memberId,
        caseItem.memberName,
        caseItem.caseType,
        caseItem.status,
        caseItem.actionItem ?? null,
        caseItem.urgency.label,
        caseItem.urgency.tone,
        caseItem.createdAt,
        caseItem.updatedAt,
        caseItem.agent,
        caseItem.groupNumber,
        caseItem.claimNumber ?? null,
        caseItem.priority,
        caseItem.description ?? null,
        caseItem.closedAt ?? null,
        caseItem.fcr ?? null,
        caseItem.resolution ?? null,
        caseItem.resolutionDetails ?? null,
        caseItem.origin ?? "phone",
        caseItem.dueAt ?? buildDueAt(caseItem.status, caseItem.priority),
        caseItem.sourceTrace ? JSON.stringify(caseItem.sourceTrace) : null,
      ]),
      100,
    );

    const timelineRows = db.cases.flatMap((caseItem) =>
      caseItem.timeline.map((entry) => [
        entry.id,
        caseItem.id,
        entry.type,
        entry.author,
        entry.timestamp,
        entry.inReplyToId ?? null,
        entry.callDirection ?? null,
        entry.callDurationSeconds ?? null,
        entry.taskDueDate ?? null,
        entry.text ?? null,
        entry.toStatus ?? null,
        entry.subject ?? null,
        entry.from ?? null,
        entry.to ?? null,
        entry.cc ?? null,
        entry.bcc ?? null,
        entry.sourceTrace ? JSON.stringify(entry.sourceTrace) : null,
      ]),
    );

    await insertRows(
      client,
      `
        INSERT INTO case_timeline (
          id,
          case_id,
          type,
          author,
          timestamp,
          in_reply_to_id,
          call_direction,
          call_duration_seconds,
          task_due_date,
          text,
          to_status,
          subject,
          sender_from,
          recipient_to,
          recipient_cc,
          recipient_bcc,
          source_trace
        )
      `,
      timelineRows,
      150,
    );

    const attachmentRows = db.cases.flatMap((caseItem) =>
      (caseItem.attachments ?? []).map((attachment) => [
        attachment.id,
        caseItem.id,
        attachment.kind,
        attachment.sourceTrace.linkKind,
        attachment.name,
        attachment.title ?? null,
        attachment.description ?? null,
        attachment.mimeType ?? null,
        attachment.fileType ?? null,
        attachment.sizeBytes ?? null,
        attachment.isPrivate ?? null,
        attachment.createdAt ?? null,
        attachment.owner ?? null,
        attachment.exportRelativePath ?? null,
        JSON.stringify(attachment.sourceTrace),
      ]),
    );

    if (attachmentRows.length > 0) {
      await insertRows(
        client,
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
          )
        `,
        attachmentRows,
        150,
      );
    }

    await insertRows(
      client,
      `
        INSERT INTO rbac_permissions (
          id,
          role,
          permissions
        )
      `,
      db.rbacPermissions.map((record) => [
        record.id,
        record.role,
        JSON.stringify(record.permissions),
      ]),
    );

    await client.query("COMMIT");
    console.log(
      `Initialized AtlasAI Postgres DB at ${config.host}:${config.port}/${config.database}`,
    );
    console.log(
      `Seeded ${db.users.length} users, ${dedupedMembers.length} members (from ${db.members.length} source rows), ${db.cases.length} cases, ${timelineRows.length} timeline entries, ${attachmentRows.length} attachments, ${db.rbacPermissions.length} RBAC records.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
