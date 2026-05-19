import { Pool } from "pg";
import { getPostgresConfig } from "../../config/postgres";

let pool: Pool | null = null;

export function getPostgresPool(): Pool {
  if (!pool) {
    const config = getPostgresConfig();
    pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.poolSize,
    });
  }

  return pool;
}

export async function closePostgresPool() {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;
  await activePool.end();
}
