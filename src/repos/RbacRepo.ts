export interface RbacPermissionRecord {
  id: string;
  role: string;
  permissions: Record<string, boolean>;
}

export interface RbacRepo {
  listPermissions(): Promise<RbacPermissionRecord[]>;
}
