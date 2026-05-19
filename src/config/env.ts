const parseOrigins = (raw?: string) =>
  (
    raw ||
    "http://localhost:3003,http://127.0.0.1:3003,http://localhost:5173,http://localhost:5174"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const parseNumber = (raw: string | undefined, fallback: number) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const env = {
  port: parseNumber(process.env.PORT, 8082),
  sessionSecret: process.env.SESSION_SECRET || "atlasai-dev-session-secret",
  frontendOrigins: parseOrigins(process.env.FRONTEND_ORIGINS),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "atlasai_session",
  nodeEnv: process.env.NODE_ENV || "development",
  repoDriver: process.env.REPO_DRIVER || "postgres",
  // Reopening a closed case within this window auto-revokes the FCR flag.
  fcrReopenRevokeWindowMs:
    parseNumber(process.env.FCR_REOPEN_REVOKE_WINDOW_DAYS, 7) * 24 * 60 * 60 * 1000,
  // HIPAA verification expires silently after this window; client must re-verify.
  hipaaVerificationTtlMs:
    parseNumber(process.env.HIPAA_VERIFICATION_TTL_MINUTES, 60) * 60 * 1000,
  // Append-only HIPAA audit log path (JSONL). Empty string disables file logging.
  hipaaAuditLogPath:
    process.env.HIPAA_AUDIT_LOG_PATH || "data/hipaa-audit.log",
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: parseNumber(process.env.MYSQL_PORT, 3306),
    database: process.env.MYSQL_DATABASE || "atlasai",
    user: process.env.MYSQL_USER || "atlasai",
    password: process.env.MYSQL_PASSWORD || "",
    connectionLimit: parseNumber(process.env.MYSQL_CONNECTION_LIMIT, 10),
  },
  postgres: {
    host: process.env.PGHOST || "127.0.0.1",
    port: parseNumber(process.env.PGPORT, 5433),
    database: process.env.PGDATABASE || "atlasai",
    user: process.env.PGUSER || "atlasai",
    password: process.env.PGPASSWORD || "change_me",
    poolSize: parseNumber(process.env.PGPOOLSIZE, 10),
  },
};
