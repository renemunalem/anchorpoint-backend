import { CallSession } from "../types/models";

export interface CallSessionStartInput {
  agentId: string;
  callerPhone?: string | null;
  memberId?: string | null;
}

export interface CallSessionEndResult {
  session: CallSession;
  transitioned: boolean;
}

export type CallSessionMutateResult =
  | { kind: "ok"; session: CallSession }
  | { kind: "not-found" }
  | { kind: "locked"; session: CallSession };

export type ExtendSessionResult =
  | { kind: "ok"; session: CallSession; extendedAt: string }
  | { kind: "not-found" }
  | { kind: "locked"; session: CallSession }
  | { kind: "no-verified-members" };

export interface CallSessionRepo {
  startSession(input: CallSessionStartInput): Promise<CallSession>;
  endSession(id: string): Promise<CallSessionEndResult | null>;
  getById(id: string): Promise<CallSession | null>;
  verifyMember(id: string, memberId: string, method: string): Promise<CallSessionMutateResult>;
  markRefused(id: string): Promise<CallSessionMutateResult>;
  extendSession(id: string): Promise<ExtendSessionResult>;
}
