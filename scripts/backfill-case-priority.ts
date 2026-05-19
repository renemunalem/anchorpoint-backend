import { Client } from "pg";
import { createConnection } from "mysql2/promise";
import { env } from "../src/config/env";
import { getPostgresConfig, validatePostgresConfig } from "../src/config/postgres";
import { getMySqlConfig, validateMySqlConfig } from "../src/config/mysql";
import { CasePriority } from "../src/types/models";

// 60% Normal / 30% High / 10% Urgent. Cumulative buckets keyed off a stable hash.
const PRIORITY_BUCKETS: Array<{ ceiling: number; value: CasePriority }> = [
  { ceiling: 60, value: "Normal" },
  { ceiling: 90, value: "High" },
  { ceiling: 100, value: "Urgent" },
];

function fnv1a(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function deterministicPriority(caseId: string): CasePriority {
  const bucket = fnv1a(caseId) % 100;
  for (const candidate of PRIORITY_BUCKETS) {
    if (bucket < candidate.ceiling) {
      return candidate.value;
    }
  }
  return "Normal";
}

async function backfillPostgres() {
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
    const { rows } = await client.query<{ id: string; priority: string }>(
      `SELECT id, priority FROM cases WHERE priority = 'Normal'`,
    );
    console.log(`[postgres] candidates with priority='Normal': ${rows.length}`);

    let updates = 0;
    for (const row of rows) {
      const next = deterministicPriority(row.id);
      if (next === "Normal") continue;
      await client.query(`UPDATE cases SET priority = $1 WHERE id = $2`, [next, row.id]);
      updates += 1;
    }
    console.log(`[postgres] updated ${updates} rows`);

    const { rows: distRows } = await client.query<{ priority: string; count: string }>(
      `SELECT priority, COUNT(*)::bigint AS count FROM cases GROUP BY priority ORDER BY priority`,
    );
    console.log(
      `[postgres] final distribution: ${distRows.map((r) => `${r.priority}=${r.count}`).join(", ")}`,
    );
  } finally {
    await client.end();
  }
}

async function backfillMysql() {
  const config = getMySqlConfig();
  validateMySqlConfig(config);
  const connection = await createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });
  try {
    const [rows] = await connection.execute<any[]>(
      `SELECT id, priority FROM cases WHERE priority = 'Normal'`,
    );
    console.log(`[mysql] candidates with priority='Normal': ${rows.length}`);

    let updates = 0;
    for (const row of rows as Array<{ id: string }>) {
      const next = deterministicPriority(row.id);
      if (next === "Normal") continue;
      await connection.execute(`UPDATE cases SET priority = ? WHERE id = ?`, [next, row.id]);
      updates += 1;
    }
    console.log(`[mysql] updated ${updates} rows`);

    const [distRows] = await connection.execute<any[]>(
      `SELECT priority, COUNT(*) AS count FROM cases GROUP BY priority ORDER BY priority`,
    );
    console.log(
      `[mysql] final distribution: ${(distRows as Array<{ priority: string; count: number }>)
        .map((r) => `${r.priority}=${r.count}`)
        .join(", ")}`,
    );
  } finally {
    await connection.end();
  }
}

async function main() {
  if (env.repoDriver === "postgres") {
    await backfillPostgres();
    return;
  }

  if (env.repoDriver === "mysql") {
    await backfillMysql();
    return;
  }

  console.log(
    `[backfill-case-priority] REPO_DRIVER=${env.repoDriver} — nothing to do (json seed already balances priorities at build time).`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
