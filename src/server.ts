import { env } from "./config/env";
import { getMySqlConfig, validateMySqlConfig } from "./config/mysql";
import { getPostgresConfig, validatePostgresConfig } from "./config/postgres";
import { getMySqlPool } from "./repos/mysql/client";
import { getPostgresPool } from "./repos/postgres/client";
import { ensureDatabaseFile, getDbPath } from "./repos/json/jsonStore";

async function ensureMySqlReady() {
  const config = getMySqlConfig();
  validateMySqlConfig(config);

  try {
    const pool = getMySqlPool();
    await pool.query("SELECT 1");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown MySQL connection error";
    throw new Error(
      `REPO_DRIVER=mysql but MySQL is unreachable or misconfigured (${config.host}:${config.port}/${config.database}): ${reason}`,
    );
  }
}

async function ensurePostgresReady() {
  const config = getPostgresConfig();
  validatePostgresConfig(config);

  try {
    const pool = getPostgresPool();
    await pool.query("SELECT 1");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown Postgres connection error";
    throw new Error(
      `REPO_DRIVER=postgres but Postgres is unreachable or misconfigured (${config.host}:${config.port}/${config.database}): ${reason}`,
    );
  }
}

async function main() {
  ensureDatabaseFile();

  if (env.repoDriver === "mysql") {
    await ensureMySqlReady();
  } else if (env.repoDriver === "postgres") {
    await ensurePostgresReady();
  }

  const { app } = await import("./app");

  app.listen(env.port, () => {
    console.log(`AtlasAI backend listening on http://127.0.0.1:${env.port}`);
    console.log(`Allowed frontend origins: ${env.frontendOrigins.join(", ")}`);
    console.log(`Dev database: ${getDbPath()}`);
    if (env.repoDriver === "mysql") {
      console.log(
        `Persistence driver: mysql (${env.mysql.host}:${env.mysql.port}/${env.mysql.database})`,
      );
      return;
    }

    if (env.repoDriver === "postgres") {
      console.log(
        `Persistence driver: postgres (${env.postgres.host}:${env.postgres.port}/${env.postgres.database})`,
      );
      return;
    }

    console.log("Persistence driver: json");
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
