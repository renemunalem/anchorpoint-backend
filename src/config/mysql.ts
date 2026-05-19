import { env } from "./env";

export interface MySqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit: number;
}

export function getMySqlConfig(): MySqlConfig {
  return { ...env.mysql };
}

export function validateMySqlConfig(config: MySqlConfig) {
  const missing: string[] = [];

  if (!config.host) missing.push("MYSQL_HOST");
  if (!config.database) missing.push("MYSQL_DATABASE");
  if (!config.user) missing.push("MYSQL_USER");
  if (!config.password) missing.push("MYSQL_PASSWORD");

  if (missing.length > 0) {
    throw new Error(
      `MySQL repo selected but configuration is incomplete: ${missing.join(", ")}`,
    );
  }
}
