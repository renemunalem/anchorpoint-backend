import { UserRepo } from "../UserRepo";
import { SeedUser } from "../../types/models";
import { getMySqlPool } from "./client";
import { RowDataPacket } from "mysql2/promise";

type UserRow = RowDataPacket & {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: "Agent" | "Admin";
  status: "Active" | "Inactive";
  lastLogin?: string | null;
  sourceTrace?: unknown;
};

function parseSourceTrace(value: unknown) {
  if (!value) {
    return undefined;
  }

  return typeof value === "string" ? JSON.parse(value) : value;
}

export class MySqlUserRepo implements UserRepo {
  async list(role?: string): Promise<Array<Omit<SeedUser, "password">>> {
    const pool = getMySqlPool();
    const normalizedRole = role?.trim().toLowerCase();
    const whereClause = normalizedRole ? `WHERE LOWER(role) = ?` : ``;
    const params = normalizedRole ? [normalizedRole] : [];
    const [rows] = await pool.query<UserRow[]>(
      `
        SELECT
          id,
          first_name AS firstName,
          last_name AS lastName,
          email,
          role,
          status,
          last_login AS lastLogin,
          source_trace AS sourceTrace
        FROM users
        ${whereClause}
        ORDER BY last_name ASC, first_name ASC, id ASC
      `,
      params,
    );

    return rows.map((row) => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      role: row.role,
      status: row.status,
      lastLogin: row.lastLogin ?? undefined,
      sourceTrace: parseSourceTrace(row.sourceTrace),
    }));
  }

  async findByEmail(email: string): Promise<SeedUser | null> {
    const pool = getMySqlPool();
    const [rows] = await pool.query<UserRow[]>(
      `
        SELECT
          id,
          first_name AS firstName,
          last_name AS lastName,
          email,
          password,
          role,
          status,
          last_login AS lastLogin,
          source_trace AS sourceTrace
        FROM users
        WHERE email = ?
        LIMIT 1
      `,
      [email],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      password: row.password,
      role: row.role,
      status: row.status,
      lastLogin: row.lastLogin ?? undefined,
      sourceTrace: parseSourceTrace(row.sourceTrace),
    };
  }

  async touchLastLogin(id: string, timestamp: string): Promise<void> {
    const pool = getMySqlPool();
    await pool.execute(
      `
        UPDATE users
        SET last_login = ?
        WHERE id = ?
      `,
      [timestamp, id],
    );
  }
}
