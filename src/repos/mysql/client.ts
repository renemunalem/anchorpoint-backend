import mysql, { Pool } from "mysql2/promise";
import { getMySqlConfig } from "../../config/mysql";

let pool: Pool | null = null;

export function getMySqlPool(): Pool {
  if (!pool) {
    const config = getMySqlConfig();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectionLimit: config.connectionLimit,
      namedPlaceholders: false,
    });
  }

  return pool;
}

export async function closeMySqlPool() {
  if (!pool) {
    return;
  }

  const activePool = pool;
  pool = null;
  await activePool.end();
}
