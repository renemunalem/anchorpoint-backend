import { RowDataPacket } from "mysql2/promise";
import { RbacPermissionRecord, RbacRepo } from "../RbacRepo";
import { getMySqlPool } from "./client";

type RbacPermissionRow = RowDataPacket & {
  id: string;
  role: string;
  permissions: string | null;
};

function mapRbacRow(row: RbacPermissionRow): RbacPermissionRecord {
  return {
    id: row.id,
    role: row.role,
    permissions: row.permissions ? JSON.parse(row.permissions) : {},
  };
}

export class MySqlRbacRepo implements RbacRepo {
  async listPermissions(): Promise<RbacPermissionRecord[]> {
    const pool = getMySqlPool();
    const [rows] = await pool.query<RbacPermissionRow[]>(
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
