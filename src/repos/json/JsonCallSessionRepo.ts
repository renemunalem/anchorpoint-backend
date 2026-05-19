import { randomBytes } from "crypto";
import { CallSession } from "../../types/models";
import {
  CallSessionEndResult,
  CallSessionMutateResult,
  CallSessionRepo,
  CallSessionStartInput,
  ExtendSessionResult,
} from "../CallSessionRepo";
import { readDatabase, writeDatabase } from "./jsonStore";

function newSessionId() {
  const random = randomBytes(6).toString("base64url");
  return `cs-${Date.now().toString(36)}-${random}`;
}

export class JsonCallSessionRepo implements CallSessionRepo {
  async startSession(input: CallSessionStartInput): Promise<CallSession> {
    const db = readDatabase();
    if (!db.callSessions) db.callSessions = [];

    const session: CallSession = {
      id: newSessionId(),
      agentId: input.agentId,
      callerPhone: input.callerPhone ?? null,
      memberId: input.memberId ?? null,
      status: "unverified",
      startedAt: new Date().toISOString(),
      endedAt: null,
      lockedAt: null,
    };

    db.callSessions.push(session);
    writeDatabase(db);
    return session;
  }

  async endSession(id: string): Promise<CallSessionEndResult | null> {
    const db = readDatabase();
    if (!db.callSessions) db.callSessions = [];

    const session = db.callSessions.find((s) => s.id === id);
    if (!session) return null;

    if (session.lockedAt) {
      // Idempotent: already locked.
      return { session, transitioned: false };
    }

    const timestamp = new Date().toISOString();
    session.endedAt = timestamp;
    session.lockedAt = timestamp;
    writeDatabase(db);
    return { session, transitioned: true };
  }

  async getById(id: string): Promise<CallSession | null> {
    const db = readDatabase();
    return db.callSessions?.find((s) => s.id === id) ?? null;
  }

  async verifyMember(
    id: string,
    memberId: string,
    method: string,
  ): Promise<CallSessionMutateResult> {
    const db = readDatabase();
    if (!db.callSessions) db.callSessions = [];

    const session = db.callSessions.find((s) => s.id === id);
    if (!session) return { kind: "not-found" };
    if (session.lockedAt) return { kind: "locked", session };

    if (!session.verifiedMemberIds) session.verifiedMemberIds = {};
    session.verifiedMemberIds[memberId] = {
      verifiedAtMs: Date.now(),
      method,
    };
    session.status = "verified";
    writeDatabase(db);
    return { kind: "ok", session };
  }

  async extendSession(id: string): Promise<ExtendSessionResult> {
    const db = readDatabase();
    if (!db.callSessions) db.callSessions = [];

    const session = db.callSessions.find((s) => s.id === id);
    if (!session) return { kind: "not-found" };
    if (session.lockedAt) return { kind: "locked", session };

    const verified = session.verifiedMemberIds;
    if (!verified || Object.keys(verified).length === 0) {
      return { kind: "no-verified-members" };
    }

    const nowMs = Date.now();
    const extendedAt = new Date(nowMs).toISOString();
    for (const memberId of Object.keys(verified)) {
      verified[memberId] = { verifiedAtMs: nowMs, method: verified[memberId].method };
    }
    writeDatabase(db);
    return { kind: "ok", session, extendedAt };
  }

  async markRefused(id: string): Promise<CallSessionMutateResult> {
    const db = readDatabase();
    if (!db.callSessions) db.callSessions = [];

    const session = db.callSessions.find((s) => s.id === id);
    if (!session) return { kind: "not-found" };
    if (session.lockedAt) return { kind: "locked", session };

    session.status = "refused";
    writeDatabase(db);
    return { kind: "ok", session };
  }
}
