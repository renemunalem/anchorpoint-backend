import { RbacPermissionRecord, RbacRepo } from "../RbacRepo";
import { getPostgresPool } from "./client";

type RbacPermissionRow = {
  id: string;
  role: string;
  permissions: unknown;
};

function mapRbacRow(row: RbacPermissionRow): RbacPermissionRecord {
  const permissions = row.permissions
    ? typeof row.permissions === "string"
      ? JSON.parse(row.permissions)
      : row.permissions
    : {};

  return {
    id: row.id,
    role: row.role,
    permissions: permissions as Record<string, boolean>,
  };
}

export class PostgresRbacRepo implements RbacRepo {
  async listPermissions(): Promise<RbacPermissionRecord[]> {
    const pool = getPostgresPool();
    const { rows } = await pool.query<RbacPermissionRow>(
      `
        SELECT
          id,
          role,
          permissions
        FROM rbac_permissions
        ORDER BY role ASC, id ASC
      `,
    );

    return rows.map(mapRbacRow);
  }
}
