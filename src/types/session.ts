import "express-session";
import { SessionUser } from "./models";

export interface HipaaVerificationStamp {
  verifiedAtMs: number;
  method?: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    hipaaVerifiedMemberIds?: Record<string, HipaaVerificationStamp>;
    hipaaVerifiedCaseIds?: Record<string, HipaaVerificationStamp>;
  }
}
