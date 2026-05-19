import { env } from "./env";

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  poolSize: number;
}

export function getPostgresConfig(): PostgresConfig {
  return { ...env.postgres };
}

export function validatePostgresConfig(config: PostgresConfig) {
  const missing: string[] = [];

  if (!config.host) missing.push("PGHOST");
  if (!config.database) missing.push("PGDATABASE");
  if (!config.user) missing.push("PGUSER");
  if (!config.password) missing.push("PGPASSWORD");

  if (missing.length > 0) {
    throw new Error(
      `Postgres repo selected but configuration is incomplete: ${missing.join(", ")}`,
    );
  }
}
