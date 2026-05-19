import { cases } from "./cases";
import { members } from "./members";
import { rbacPermissions } from "./rbac";
import { users } from "./users";
import { DatabaseState } from "../types/models";

export function createSeedState(): DatabaseState {
  return {
    users: JSON.parse(JSON.stringify(users)),
    members: JSON.parse(JSON.stringify(members)),
    cases: JSON.parse(JSON.stringify(cases)),
    rbacPermissions: JSON.parse(JSON.stringify(rbacPermissions)),
  };
}
