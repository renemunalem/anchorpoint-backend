import { MembersService } from "./members.service";
import { CallSessionRepo, CallSessionStartInput } from "../repos/CallSessionRepo";
import { appendHipaaAuditEntry } from "../security/hipaaAuditLog";
import { env } from "../config/env";
import { CallSession } from "../types/models";

export interface CallSessionsServiceContext {
  actorId?: string;
  actorEmail?: string;
}

export type VerifyHipaaOutcome = "verify" | "refused";

export interface VerifyHipaaInput {
  memberId: string;
  method: string;
  outcome?: VerifyHipaaOutcome;
  evidence?: string;
}

export type VerifyHipaaResult =
  | { kind: "ok"; session: CallSession; verifiedAt?: string; expiresAt: string; ttlMs: number }
  | { kind: "session-not-found" }
  | { kind: "session-locked"; session: CallSession }
  | { kind: "member-not-found" }
  | { kind: "invalid-method" }
  | { kind: "attempt-limit-exceeded"; attemptCount: number };

export type ExtendSessionServiceResult =
  | { kind: "ok"; session: CallSession; extendedAt: string; expiresAt: string; ttlMs: number }
  | { kind: "not-found" }
  | { kind: "locked"; session: CallSession }
  | { kind: "no-verified-members" }
  | { kind: "cross-agent" };

const MAX_VERIFY_ATTEMPTS = 3;

export const ALLOWED_CALL_HIPAA_METHODS: ReadonlySet<string> = new Set([
  "dob_last4",
  "member_id",
  "manual",
  "step_up",
]);

export class CallSessionsService {
  private readonly verifyCounts = new Map<string, number>();

  constructor(
    private readonly callSessionRepo: CallSessionRepo,
    private readonly membersService: MembersService,
  ) {}

  async startSession(
    input: CallSessionStartInput,
    context: CallSessionsServiceContext = {},
  ): Promise<CallSession> {
    const session = await this.callSessionRepo.startSession(input);

    appendHipaaAuditEntry({
      timestamp: session.startedAt,
      actor: {
        id: context.actorId ?? session.agentId,
        email: context.actorEmail,
      },
      memberId: session.memberId,
      caseId: null,
      method: null,
      result: "session-started",
      callSessionId: session.id,
      detail: session.callerPhone ? `caller=${session.callerPhone}` : undefined,
    });

    return session;
  }

  async endSession(
    id: string,
    context: CallSessionsServiceContext = {},
    options: { reason?: string } = {},
  ): Promise<CallSession | null> {
    const result = await this.callSessionRepo.endSession(id);
    if (!result) return null;
    const { session, transitioned } = result;

    if (transitioned) {
      this.verifyCounts.delete(id);
      appendHipaaAuditEntry({
        timestamp: session.lockedAt ?? new Date().toISOString(),
        actor: {
          id: context.actorId ?? session.agentId,
          email: context.actorEmail,
        },
        memberId: session.memberId,
        caseId: null,
        method: null,
        result: "session-locked",
        callSessionId: session.id,
        reason: options.reason,
      });
    }

    return session;
  }

  async getSession(id: string): Promise<CallSession | null> {
    return this.callSessionRepo.getById(id);
  }

  async extendSession(
    callSessionId: string,
    context: CallSessionsServiceContext = {},
  ): Promise<ExtendSessionServiceResult> {
    const existing = await this.callSessionRepo.getById(callSessionId);
    if (!existing) return { kind: "not-found" };
    if (existing.agentId !== context.actorId) return { kind: "cross-agent" };

    const result = await this.callSessionRepo.extendSession(callSessionId);
    if (result.kind !== "ok") return result;

    const extendedAt = result.extendedAt;
    const ttlMs = env.hipaaVerificationTtlMs;
    const expiresAt = new Date(new Date(extendedAt).getTime() + ttlMs).toISOString();

    // Prefer the verified member's ID when exactly one member is verified; fall back to the
    // session's stored memberId (which is null for sessions started without an explicit member).
    const verifiedIds = Object.keys(result.session.verifiedMemberIds ?? {});
    const auditMemberId = verifiedIds.length === 1
      ? verifiedIds[0]
      : (result.session.memberId ?? null);

    appendHipaaAuditEntry({
      timestamp: extendedAt,
      actor: { id: context.actorId, email: context.actorEmail },
      memberId: auditMemberId,
      caseId: null,
      method: null,
      result: "session-extended",
      callSessionId,
      detail: `members=${verifiedIds.length}`,
    });

    return { kind: "ok", session: result.session, extendedAt, expiresAt, ttlMs };
  }

  async verifyHipaa(
    callSessionId: string,
    input: VerifyHipaaInput,
    context: CallSessionsServiceContext = {},
  ): Promise<VerifyHipaaResult> {
    const attemptCount = this.verifyCounts.get(callSessionId) ?? 0;
    if (attemptCount >= MAX_VERIFY_ATTEMPTS) {
      appendHipaaAuditEntry({
        timestamp: new Date().toISOString(),
        actor: { id: context.actorId, email: context.actorEmail },
        memberId: null,
        caseId: null,
        method: null,
        result: "failed",
        callSessionId,
        detail: `attempt-limit-exceeded:${attemptCount}`,
      });
      return { kind: "attempt-limit-exceeded", attemptCount };
    }

    const outcome: VerifyHipaaOutcome = input.outcome ?? "verify";
    const auditBase = {
      timestamp: new Date().toISOString(),
      actor: { id: context.actorId, email: context.actorEmail },
      memberId: input.memberId,
      caseId: null,
      method: input.method,
      callSessionId,
      detail: input.evidence,
    } as const;

    if (outcome === "refused") {
      const result = await this.callSessionRepo.markRefused(callSessionId);
      if (result.kind === "not-found") {
        appendHipaaAuditEntry({ ...auditBase, result: "failed", detail: "session-not-found" });
        return { kind: "session-not-found" };
      }
      if (result.kind === "locked") {
        appendHipaaAuditEntry({ ...auditBase, result: "failed", detail: "session-locked" });
        return { kind: "session-locked", session: result.session };
      }
      this.verifyCounts.set(callSessionId, attemptCount + 1);
      appendHipaaAuditEntry({ ...auditBase, result: "refused" });
      const refusedTtlMs = env.hipaaVerificationTtlMs;
      const refusedExpiresAt = new Date(Date.now() + refusedTtlMs).toISOString();
      return { kind: "ok", session: result.session, expiresAt: refusedExpiresAt, ttlMs: refusedTtlMs };
    }

    if (!ALLOWED_CALL_HIPAA_METHODS.has(input.method)) {
      this.verifyCounts.set(callSessionId, attemptCount + 1);
      appendHipaaAuditEntry({
        ...auditBase,
        result: "failed",
        detail: `invalid-method:${input.method}`,
      });
      return { kind: "invalid-method" };
    }

    const member = await this.membersService.getById(input.memberId);
    if (!member) {
      this.verifyCounts.set(callSessionId, attemptCount + 1);
      appendHipaaAuditEntry({ ...auditBase, result: "failed", detail: "member-not-found" });
      return { kind: "member-not-found" };
    }

    const result = await this.callSessionRepo.verifyMember(callSessionId, input.memberId, input.method);
    if (result.kind === "not-found") {
      appendHipaaAuditEntry({ ...auditBase, result: "failed", detail: "session-not-found" });
      return { kind: "session-not-found" };
    }
    if (result.kind === "locked") {
      appendHipaaAuditEntry({ ...auditBase, result: "failed", detail: "session-locked" });
      return { kind: "session-locked", session: result.session };
    }

    this.verifyCounts.delete(callSessionId);
    appendHipaaAuditEntry({ ...auditBase, result: "ok" });
    const verifyTtlMs = env.hipaaVerificationTtlMs;
    const verifyExpiresAt = new Date(new Date(auditBase.timestamp).getTime() + verifyTtlMs).toISOString();
    return { kind: "ok", session: result.session, verifiedAt: auditBase.timestamp, expiresAt: verifyExpiresAt, ttlMs: verifyTtlMs };
  }
}
