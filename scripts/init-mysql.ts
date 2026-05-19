import fs from "fs";
import path from "path";
import mysql, { RowDataPacket } from "mysql2/promise";
import { createSeedState } from "../src/data/seedState";
import { getMySqlConfig, validateMySqlConfig } from "../src/config/mysql";

async function ensureColumn(
  connection: mysql.Connection,
  tableName: string,
  columnName: string,
  definition: string,
) {
  const [rows] = await connection.query<Array<{ count: number } & RowDataPacket>>(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [tableName, columnName],
  );

  if ((rows[0]?.count ?? 0) > 0) {
    return;
  }

  await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

async function ensureIndex(
  connection: mysql.Connection,
  tableName: string,
  indexName: string,
  definition: string,
) {
  const [rows] = await connection.query<Array<{ count: number } & RowDataPacket>>(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
    `,
    [tableName, indexName],
  );

  if ((rows[0]?.count ?? 0) > 0) {
    return;
  }

  await connection.query(`ALTER TABLE ${tableName} ADD INDEX ${indexName} ${definition}`);
}

async function main() {
  const config = getMySqlConfig();
  validateMySqlConfig(config);

  const schemaPath = path.resolve(__dirname, "../db/mysql/schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const seed = createSeedState();

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    multipleStatements: true,
  });

  try {
    await connection.query(schemaSql);
    await ensureColumn(connection, "users", "source_trace", "JSON NULL");
    await ensureColumn(connection, "members", "source_trace", "JSON NULL");
    await ensureColumn(connection, "cases", "source_trace", "JSON NULL");
    await ensureColumn(connection, "cases", "origin", "VARCHAR(32) NOT NULL DEFAULT 'phone'");
    await ensureColumn(connection, "members", "nifty_member_id", "VARCHAR(64) NULL");
    await ensureColumn(connection, "members", "glip_channel_id", "VARCHAR(128) NULL");
    await ensureColumn(connection, "case_timeline", "sender_from", "VARCHAR(255) NULL");
    await ensureColumn(connection, "case_timeline", "recipient_cc", "VARCHAR(255) NULL");
    await ensureColumn(connection, "case_timeline", "recipient_bcc", "VARCHAR(255) NULL");
    await ensureColumn(connection, "case_timeline", "source_trace", "JSON NULL");
    await connection.query("ALTER TABLE case_timeline MODIFY COLUMN text MEDIUMTEXT NULL");
    await ensureIndex(
      connection,
      "members",
      "idx_members_subscriber_member_id",
      "(subscriber_member_id)",
    );
    await ensureIndex(connection, "cases", "idx_cases_member_id", "(member_id)");
    await ensureIndex(connection, "cases", "idx_cases_created_at_id", "(created_at, id)");
    await ensureIndex(connection, "cases", "idx_cases_group_number", "(group_number)");
    await ensureIndex(connection, "cases", "idx_cases_claim_number", "(claim_number)");
    await ensureIndex(
      connection,
      "case_timeline",
      "idx_case_timeline_case_timestamp_id",
      "(case_id, timestamp, id)",
    );
    await ensureIndex(
      connection,
      "case_attachments",
      "idx_case_attachments_case_created_id",
      "(case_id, created_at, id)",
    );
    await connection.beginTransaction();

    await connection.query("DELETE FROM case_attachments");
    await connection.query("DELETE FROM case_timeline");
    await connection.query("DELETE FROM cases");
    await connection.query("DELETE FROM rbac_permissions");
    await connection.query("DELETE FROM members");
    await connection.query("DELETE FROM users");

    for (const user of seed.users) {
      await connection.execute(
        `
          INSERT INTO users (
            id, first_name, last_name, email, password, role, status, last_login
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        ],
      );
    }

    for (const member of seed.members) {
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
            nifty_member_id,
            glip_channel_id,
            network
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          member.niftyMemberId ?? null,
          member.glipChannelId ?? null,
          member.network ?? null,
        ],
      );
    }

    for (const caseItem of seed.cases) {
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
            origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          caseItem.origin ?? "phone",
        ],
      );

      for (const entry of caseItem.timeline) {
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
            caseItem.id,
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
    }

    for (const record of seed.rbacPermissions) {
      await connection.execute(
        `INSERT INTO rbac_permissions (id, role, permissions) VALUES (?, ?, ?)`,
        [record.id, record.role, JSON.stringify(record.permissions)],
      );
    }

    await connection.commit();

    console.log(`Initialized AtlasAI MySQL DB at ${config.host}:${config.port}/${config.database}`);
    console.log(
      `Seeded ${seed.users.length} users, ${seed.members.length} members, ${seed.cases.length} cases, ${seed.rbacPermissions.length} RBAC records.`,
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
