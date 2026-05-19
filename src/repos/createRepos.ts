import { CallSessionRepo } from "./CallSessionRepo";
import { CaseRepo } from "./CaseRepo";
import { MemberRepo } from "./MemberRepo";
import { RbacRepo } from "./RbacRepo";
import { UserRepo } from "./UserRepo";
import { JsonCallSessionRepo } from "./json/JsonCallSessionRepo";
import { JsonCaseRepo } from "./json/JsonCaseRepo";
import { JsonMemberRepo } from "./json/JsonMemberRepo";
import { JsonRbacRepo } from "./json/JsonRbacRepo";
import { JsonUserRepo } from "./json/JsonUserRepo";
import { MySqlCallSessionRepo } from "./mysql/MySqlCallSessionRepo";
import { MySqlCaseRepo } from "./mysql/MySqlCaseRepo";
import { MySqlMemberRepo } from "./mysql/MySqlMemberRepo";
import { MySqlRbacRepo } from "./mysql/MySqlRbacRepo";
import { MySqlUserRepo } from "./mysql/MySqlUserRepo";
import { getMySqlConfig, validateMySqlConfig } from "../config/mysql";
import { getPostgresConfig, validatePostgresConfig } from "../config/postgres";
import { PostgresCallSessionRepo } from "./postgres/PostgresCallSessionRepo";
import { PostgresCaseRepo } from "./postgres/PostgresCaseRepo";
import { PostgresMemberRepo } from "./postgres/PostgresMemberRepo";
import { PostgresRbacRepo } from "./postgres/PostgresRbacRepo";
import { PostgresUserRepo } from "./postgres/PostgresUserRepo";

export interface RepoBundle {
  userRepo: UserRepo;
  memberRepo: MemberRepo;
  caseRepo: CaseRepo;
  rbacRepo: RbacRepo;
  callSessionRepo: CallSessionRepo;
}

export function createRepos(driver: string): RepoBundle {
  if (driver === "mysql") {
    const mysqlConfig = getMySqlConfig();
    validateMySqlConfig(mysqlConfig);

    return {
      userRepo: new MySqlUserRepo(),
      memberRepo: new MySqlMemberRepo(),
      caseRepo: new MySqlCaseRepo(),
      rbacRepo: new MySqlRbacRepo(),
      callSessionRepo: new MySqlCallSessionRepo(),
    };
  }

  if (driver === "postgres") {
    const postgresConfig = getPostgresConfig();
    validatePostgresConfig(postgresConfig);

    return {
      userRepo: new PostgresUserRepo(),
      memberRepo: new PostgresMemberRepo(),
      caseRepo: new PostgresCaseRepo(),
      rbacRepo: new PostgresRbacRepo(),
      callSessionRepo: new PostgresCallSessionRepo(),
    };
  }

  return {
    userRepo: new JsonUserRepo(),
    memberRepo: new JsonMemberRepo(),
    caseRepo: new JsonCaseRepo(),
    rbacRepo: new JsonRbacRepo(),
    callSessionRepo: new JsonCallSessionRepo(),
  };
}
