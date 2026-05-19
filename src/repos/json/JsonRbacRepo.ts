import { RbacPermissionRecord, RbacRepo } from "../RbacRepo";
import { readDatabase } from "./jsonStore";

export class JsonRbacRepo implements RbacRepo {
  async listPermissions(): Promise<RbacPermissionRecord[]> {
    return readDatabase().rbacPermissions;
  }
}
