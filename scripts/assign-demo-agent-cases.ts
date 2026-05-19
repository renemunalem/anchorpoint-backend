import { env } from "../src/config/env";
import { readDatabase, writeDatabase } from "../src/repos/json/jsonStore";
import { users as seededUsers } from "../src/data/users";

const TARGET_PER_AGENT = 2;

function fullName(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

async function ensureForJson() {
  const db = readDatabase();

  const demoAgents = seededUsers.filter(
    (user) => user.role === "Agent" && user.status === "Active",
  );

  if (demoAgents.length === 0) {
    console.log("[json] no Active Agent users in src/data/users.ts — nothing to do");
    return;
  }

  let userUpserts = 0;
  for (const seed of demoAgents) {
    const idx = db.users.findIndex((u) => u.id === seed.id);
    if (idx === -1) {
      db.users.push({ ...seed });
      userUpserts += 1;
      console.log(`[json] upserted missing demo user ${seed.id} (${seed.email})`);
    }
  }

  const demoNames = new Set(demoAgents.map(fullName));
  const cases = db.cases;

  let totalReassigned = 0;
  for (const user of demoAgents) {
    const target = fullName(user);
    const ownedCount = cases.filter((c) => c.agent === target).length;
    const needed = Math.max(0, TARGET_PER_AGENT - ownedCount);

    if (needed === 0) {
      console.log(`[json] ${target}: already owns ${ownedCount} case(s)`);
      continue;
    }

    const candidates = cases.filter((c) => !demoNames.has(c.agent ?? ""));
    const picks = candidates.slice(0, needed);

    if (picks.length === 0) {
      console.log(
        `[json] ${target}: no reassignable cases available (every case already owned by a demo agent)`,
      );
      continue;
    }

    for (const c of picks) {
      c.agent = target;
      totalReassigned += 1;
    }

    console.log(
      `[json] ${target}: had ${ownedCount}, reassigned ${picks.length} case(s) → now ${ownedCount + picks.length}`,
    );
  }

  if (userUpserts > 0 || totalReassigned > 0) {
    writeDatabase(db);
    console.log(
      `[json] wrote ${userUpserts} user upsert(s), ${totalReassigned} case reassignment(s)`,
    );
  } else {
    console.log("[json] no changes written");
  }
}

async function main() {
  if (env.repoDriver === "json") {
    await ensureForJson();
    return;
  }

  console.log(
    `[assign-demo-agent-cases] REPO_DRIVER=${env.repoDriver} — JSON driver only for now; for Postgres/MySQL drivers, re-run the seed/import path or extend this script.`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
