import { Client } from "pg";
import { env } from "../src/config/env";
import { getPostgresConfig, validatePostgresConfig } from "../src/config/postgres";
import { cases as seededCases } from "../src/data/cases";
import { members as seededMembers } from "../src/data/members";
import { users as seededUsers } from "../src/data/users";
import { readDatabase, writeDatabase } from "../src/repos/json/jsonStore";
import { CaseDetail } from "../src/types/models";

const ALICE_MEMBER_ID = "M1001";
const ALICE_AGENT_USER_ID = "usr_agent_one";
const ALICE_CASE_IDS = [
  "C-2026-0001",
  "C-2026-O002",
  "C-2026-A001",
  "C-2026-A002",
  "C-2026-A003",
  "C-2026-E001",
] as const;

async function upsertOnPostgres() {
  const config = getPostgresConfig();
  validatePostgresConfig(config);
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });
  await client.connect();
  try {
    await client.query("BEGIN");

    // 1. Demo agent user
    const agentUser = seededUsers.find((u) => u.id === ALICE_AGENT_USER_ID);
    if (!agentUser) throw new Error(`expected user ${ALICE_AGENT_USER_ID} in seed`);
    await client.query(
      `
        INSERT INTO users (id, first_name, last_name, email, password, role, status, last_login)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          email = EXCLUDED.email,
          password = EXCLUDED.password,
          role = EXCLUDED.role,
          status = EXCLUDED.status
      `,
      [
        agentUser.id,
        agentUser.firstName,
        agentUser.lastName,
        agentUser.email,
        agentUser.password,
        agentUser.role,
        agentUser.status,
        agentUser.lastLogin ?? null,
      ],
    );

    // 2. Alice member
    const alice = seededMembers.find((m) => m.id === ALICE_MEMBER_ID);
    if (!alice) throw new Error(`expected member ${ALICE_MEMBER_ID} in seed`);
    await client.query(
      `
        INSERT INTO members (
          id, subscriber_member_id, first_name, last_name, birthdate, ssn,
          phone_number, email, address_line1, city, state, zip_code,
          account_group_name, group_number, plan_name, plan_id, cobra,
          coverage_effective_date, coverage_term_date, coverage_tier,
          relationship_type, member_status, cob_status, cob_coverage_types,
          cob_details, cob_reported_at, nifty_member_id, glip_channel_id,
          network, source_trace
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          $20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
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
          nifty_member_id = EXCLUDED.nifty_member_id,
          glip_channel_id = EXCLUDED.glip_channel_id,
          network = EXCLUDED.network,
          source_trace = EXCLUDED.source_trace
      `,
      [
        alice.id,
        alice.subscriberMemberId,
        alice.firstName,
        alice.lastName,
        alice.birthdate,
        alice.ssn,
        alice.phoneNumber,
        alice.email,
        alice.addressLine1,
        alice.city,
        alice.state,
        alice.zipCode,
        alice.accountGroupName,
        alice.groupNumber,
        alice.planName,
        alice.planId,
        alice.cobra,
        alice.coverageEffectiveDate,
        alice.coverageTermDate,
        alice.coverageTier,
        alice.relationshipType,
        alice.memberStatus,
        alice.cobStatus,
        JSON.stringify(alice.cobCoverageTypes),
        alice.cobDetails,
        alice.cobReportedAt,
        alice.niftyMemberId ?? null,
        alice.glipChannelId ?? null,
        alice.network ?? null,
        alice.sourceTrace ? JSON.stringify(alice.sourceTrace) : null,
      ],
    );

    // 3. Three Alice cases (clear and re-insert to keep timeline/attachments idempotent).
    await client.query(`DELETE FROM case_attachments WHERE case_id = ANY($1)`, [ALICE_CASE_IDS]);
    await client.query(`DELETE FROM case_timeline WHERE case_id = ANY($1)`, [ALICE_CASE_IDS]);
    await client.query(`DELETE FROM cases WHERE id = ANY($1)`, [ALICE_CASE_IDS]);

    const aliceCases = seededCases.filter((c) => ALICE_CASE_IDS.includes(c.id as typeof ALICE_CASE_IDS[number]));
    if (aliceCases.length !== ALICE_CASE_IDS.length) {
      throw new Error(`expected ${ALICE_CASE_IDS.length} alice cases, found ${aliceCases.length}`);
    }

    for (const c of aliceCases) {
      await client.query(
        `
          INSERT INTO cases (
            id, case_number, member_id, member_name, case_type, status, action_item,
            urgency_label, urgency_tone, created_at, updated_at, agent, group_number,
            claim_number, priority, description, closed_at, fcr, resolution,
            resolution_details, origin, due_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
          )
        `,
        [
          c.id,
          c.caseNumber,
          c.memberId,
          c.memberName,
          c.caseType,
          c.status,
          c.actionItem ?? null,
          c.urgency.label,
          c.urgency.tone,
          c.createdAt,
          c.updatedAt,
          c.agent,
          c.groupNumber,
          c.claimNumber ?? null,
          c.priority,
          c.description ?? null,
          c.closedAt ?? null,
          c.fcr ?? null,
          c.resolution ?? null,
          c.resolutionDetails ?? null,
          c.origin ?? "phone",
          c.dueAt ?? null,
        ],
      );

      for (const entry of c.timeline) {
        await client.query(
          `
            INSERT INTO case_timeline (
              id, case_id, type, author, timestamp, in_reply_to_id, call_direction,
              call_duration_seconds, task_due_date, text, to_status, subject,
              sender_from, recipient_to, recipient_cc, recipient_bcc, source_trace
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
            )
          `,
          [
            entry.id,
            c.id,
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
          ],
        );
      }

      for (const att of c.attachments ?? []) {
        await client.query(
          `
            INSERT INTO case_attachments (
              id, case_id, kind, link_kind, name, title, description, mime_type,
              file_type, size_bytes, is_private, created_at, owner,
              export_relative_path, source_trace
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
            )
          `,
          [
            att.id,
            c.id,
            att.kind,
            att.sourceTrace.linkKind,
            att.name,
            att.title ?? null,
            att.description ?? null,
            att.mimeType ?? null,
            att.fileType ?? null,
            att.sizeBytes ?? null,
            att.isPrivate ?? null,
            att.createdAt ?? null,
            att.owner ?? null,
            att.exportRelativePath ?? null,
            JSON.stringify(att.sourceTrace),
          ],
        );
      }
    }

    // BE-072: Augment 10 known SF-imported members with email addresses and 2 with COB data.
    // These are targeted UPDATEs — no member records are inserted or deleted.
    // Emails follow a safe demo pattern (firstname.lastname@example-domain.com).
    // M1001 and 000114556 are intentionally excluded to preserve QAS/QAB test anchors.
    const memberAugmentations: Array<{ id: string; email: string; cobStatus?: string; cobDetails?: string }> = [
      { id: "210140014800", email: "emma.letterman@northwindbenefits.com" },
      { id: "210100010500", email: "ann.roy@summitcare.net" },
      { id: "624450012200", email: "sonja.hebert@membermail.io" },
      { id: "210020032103", email: "jacqueline.richardson@blueharborhealth.org",
        cobStatus: "Yes", cobDetails: "Spouse Employer Plan reported during coordination of benefits screening." },
      { id: "210090004000", email: "tammie.bechtel@cedarretailbenefits.com" },
      { id: "210240007300", email: "tabitha.shaver@northwindbenefits.com" },
      { id: "210270002700", email: "mark.mcfarland@summitcare.net",
        cobStatus: "Yes", cobDetails: "Medicare Advantage reported; eligibility coordination ongoing." },
      { id: "1234567",      email: "caroline.colomb@membermail.io" },
      { id: "624450045500", email: "daniel.pajda@blueharborhealth.org" },
      { id: "210010002700", email: "shila.currier@cedarretailbenefits.com" },
    ];
    for (const aug of memberAugmentations) {
      if (aug.cobStatus) {
        await client.query(
          `UPDATE members SET email = $1, cob_status = $2, cob_details = $3 WHERE id = $4`,
          [aug.email, aug.cobStatus, aug.cobDetails, aug.id],
        );
      } else {
        await client.query(
          `UPDATE members SET email = $1 WHERE id = $2`,
          [aug.email, aug.id],
        );
      }
    }

    await client.query("COMMIT");
    console.log(
      `[seed-demo-alice] postgres: upserted user ${agentUser.email}, member ${alice.id} (${alice.firstName} ${alice.lastName}), and ${aliceCases.length} curated cases. Augmented ${memberAugmentations.length} SF members with email/COB.`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function upsertOnJson() {
  const agentUser = seededUsers.find((u) => u.id === ALICE_AGENT_USER_ID);
  if (!agentUser) throw new Error(`expected user ${ALICE_AGENT_USER_ID} in seed`);

  const alice = seededMembers.find((m) => m.id === ALICE_MEMBER_ID);
  if (!alice) throw new Error(`expected member ${ALICE_MEMBER_ID} in seed`);

  const aliceCases: CaseDetail[] = seededCases.filter((c) =>
    ALICE_CASE_IDS.includes(c.id as typeof ALICE_CASE_IDS[number]),
  );
  if (aliceCases.length !== ALICE_CASE_IDS.length) {
    throw new Error(`expected ${ALICE_CASE_IDS.length} alice cases, found ${aliceCases.length}`);
  }

  const db = readDatabase();

  const userIdx = db.users.findIndex((u) => u.id === agentUser.id);
  if (userIdx === -1) db.users.push({ ...agentUser });
  else db.users[userIdx] = { ...db.users[userIdx], ...agentUser };

  const memberIdx = db.members.findIndex((m) => m.id === alice.id);
  if (memberIdx === -1) db.members.push({ ...alice });
  else db.members[memberIdx] = { ...alice };

  let inserted = 0;
  let replaced = 0;
  for (const c of aliceCases) {
    const idx = db.cases.findIndex((x) => x.id === c.id);
    const clone: CaseDetail = JSON.parse(JSON.stringify(c));
    if (idx === -1) {
      db.cases.push(clone);
      inserted += 1;
    } else {
      db.cases[idx] = clone;
      replaced += 1;
    }
  }

  writeDatabase(db);
  console.log(
    `[seed-demo-alice] json: upserted user ${agentUser.email}, member ${alice.id} (${alice.firstName} ${alice.lastName}); cases inserted=${inserted}, replaced=${replaced} (total=${aliceCases.length}).`,
  );
}

async function main() {
  if (env.repoDriver === "postgres") {
    await upsertOnPostgres();
    return;
  }
  if (env.repoDriver === "mysql") {
    throw new Error("seed-demo-alice currently supports REPO_DRIVER=postgres or REPO_DRIVER=json; run db:mysql:init for MySQL");
  }
  await upsertOnJson();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
