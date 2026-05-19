import { Request, RequestHandler, Response } from "express";
import { parseMemberListQuery } from "../http/pagination";
import { CallSessionsService } from "../services/callSessions.service";
import { CasesService } from "../services/cases.service";
import { MembersService } from "../services/members.service";
import {
  getCallSessionIdFromHeader,
  getHipaaVerificationCounts,
  isCallSessionVerifiedForMember,
  isHipaaMaskingEnabled,
  isMemberHipaaVerified,
  markHipaaVerified,
  maskMemberFieldsForCallSession,
  maskMemberForResponse,
  maskMemberListForResponse,
  omitSsnFromResponse,
} from "../security/hipaa";
import { appendHipaaAuditEntry, HipaaAuditResult } from "../security/hipaaAuditLog";
import { authErrorBody, BadRequestError, errorBody } from "../types/http";
import { CallSession, CaseStatus } from "../types/models";

const ALLOWED_HIPAA_METHODS = new Set([
  "dob_last4",
  "member_id",
  "manual",
  "step_up",
]);

const ALLOWED_SSN_REVEAL_REASONS = new Set([
  "benefits-verification",
  "compliance-review",
  "member-request",
  "other",
]);

const ALLOWED_CASE_STATUSES: CaseStatus[] = ["Open", "Waiting", "Escalated", "Closed"];

function parseStatusFilter(raw: unknown): CaseStatus[] | { error: string } {
  if (raw === undefined || raw === null) return [];

  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => (typeof v === "string" ? v.split(",") : []))
    : typeof raw === "string"
      ? raw.split(",")
      : [];

  const cleaned = parts.map((p) => p.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  for (const value of cleaned) {
    if (!ALLOWED_CASE_STATUSES.includes(value as CaseStatus)) {
      return { error: `status must be one of: ${ALLOWED_CASE_STATUSES.join(", ")}` };
    }
  }

  return cleaned as CaseStatus[];
}

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function createMembersController(
  membersService: MembersService,
  casesService: CasesService,
  callSessionsService: CallSessionsService,
) {
  const loadCallSessionFromHeader = async (req: Request): Promise<CallSession | null> => {
    const id = getCallSessionIdFromHeader(req);
    if (!id) return null;
    return callSessionsService.getSession(id);
  };

  const getMembers: RequestHandler = (req, res) => {
    void (async () => {
      const query = parseMemberListQuery(req.query as Record<string, unknown>);
      const page = await membersService.getPage(query);
      res.json({
        items: page.items.map((member) => maskMemberListForResponse(member)),
        pageInfo: page.pageInfo,
      });
    })().catch((error: unknown) => {
      if (error instanceof BadRequestError) {
        res.status(400).json(errorBody("BAD_REQUEST", error.message));
        return;
      }

      res.status(500).json(
        errorBody(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "Failed to load members",
        ),
      );
    });
  };

  const getMemberById: RequestHandler = (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    void (async () => {
      const member = await membersService.getById(id);
      if (!member) {
        res.status(404).json(errorBody("NOT_FOUND", "Member not found"));
        return;
      }

      if (getCallSessionIdFromHeader(req)) {
        const callSession = await loadCallSessionFromHeader(req);
        if (!isCallSessionVerifiedForMember(callSession, member.id)) {
          res.json(omitSsnFromResponse(member, maskMemberFieldsForCallSession(member)));
          return;
        }
        res.json(omitSsnFromResponse(member, member));
        return;
      }

      if (!isHipaaMaskingEnabled()) {
        res.json(omitSsnFromResponse(member, member));
        return;
      }

      res.json(omitSsnFromResponse(member, maskMemberForResponse(req, member)));
    })().catch((error: unknown) => {
      res.status(500).json(
        errorBody(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "Failed to load member",
        ),
      );
    });
  };

  const verifyMemberHipaa: RequestHandler = (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { caseId, method } = req.body as { caseId?: string; method?: string };
    const sessionUser = req.session.user;
    const actor = {
      id: sessionUser?.id,
      email: sessionUser?.email,
    };
    const recordAudit = (result: HipaaAuditResult, detail?: string) => {
      appendHipaaAuditEntry({
        timestamp: new Date().toISOString(),
        actor,
        memberId: id ?? null,
        caseId: caseId ?? null,
        method: typeof method === "string" && method.trim() ? method.trim() : null,
        result,
        detail,
      });
    };

    if (!id) {
      res.status(400).json(errorBody("BAD_REQUEST", "Member id is required"));
      return;
    }

    if (method !== undefined && (typeof method !== "string" || !ALLOWED_HIPAA_METHODS.has(method))) {
      const allowed = [...ALLOWED_HIPAA_METHODS].join(", ");
      res.status(400).json(errorBody("BAD_REQUEST", `method must be one of: ${allowed}`));
      return;
    }

    void (async () => {
      if (!isHipaaMaskingEnabled()) {
        recordAudit("masking-disabled");
        res.status(400).json(errorBody("BAD_REQUEST", "HIPAA session verification is only enabled in SQL-backed modes"));
        return;
      }

      const member = await membersService.getById(id);
      if (!member) {
        recordAudit("member-not-found");
        res.status(404).json(errorBody("NOT_FOUND", "Member not found"));
        return;
      }

      if (caseId) {
        const relatedCase = await casesService.getById(caseId);
        if (!relatedCase) {
          recordAudit("case-not-found");
          res.status(404).json(errorBody("NOT_FOUND", "Case not found"));
          return;
        }

        if (relatedCase.memberId !== member.id) {
          recordAudit("case-member-mismatch", `case.memberId=${relatedCase.memberId}`);
          res.status(400).json(errorBody("BAD_REQUEST", "Case does not belong to member"));
          return;
        }
      }

      markHipaaVerified(req, member.id, caseId, method);
      await saveSession(req);

      const counts = getHipaaVerificationCounts(req);
      recordAudit("ok");
      console.log(
        `${new Date().toISOString()} HIPAA_VERIFY memberId=${member.id} caseId=${caseId ?? "-"} method=${method ?? "-"} result=ok members=${counts.verifiedMemberIds} cases=${counts.verifiedCaseIds} ttlMs=${counts.ttlMs}`,
      );
      res.json({
        ok: true,
        memberId: member.id,
        caseId: caseId ?? null,
        method: method ?? null,
        sessionVerification: counts,
      });
    })().catch((error: unknown) => {
      res.status(500).json(
        errorBody(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "Failed to persist HIPAA verification state",
        ),
      );
    });
  };

  const listCasesForMember: RequestHandler = (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json(errorBody("BAD_REQUEST", "Member id is required"));
      return;
    }

    const parsedStatus = parseStatusFilter(req.query.status);
    if (!Array.isArray(parsedStatus)) {
      res.status(400).json(errorBody("BAD_REQUEST", parsedStatus.error));
      return;
    }

    void (async () => {
      const member = await membersService.getById(id);
      if (!member) {
        res.status(404).json(errorBody("NOT_FOUND", "Member not found"));
        return;
      }

      if (getCallSessionIdFromHeader(req)) {
        const callSession = await loadCallSessionFromHeader(req);
        if (!isCallSessionVerifiedForMember(callSession, member.id)) {
          res.status(403).json(authErrorBody("AUTH_HIPAA_REQUIRED", "Call session HIPAA verification required for this member"));
          return;
        }
      }

      const items = await casesService.getMinimalForMember(member.id, parsedStatus);
      res.json({ items });
    })().catch((error: unknown) => {
      res.status(500).json(
        errorBody(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "Failed to list member cases",
        ),
      );
    });
  };

  const listAttachmentsForMember: RequestHandler = (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json(errorBody("BAD_REQUEST", "Member id is required"));
      return;
    }

    void (async () => {
      const member = await membersService.getById(id);
      if (!member) {
        res.status(404).json(errorBody("NOT_FOUND", "Member not found"));
        return;
      }

      if (getCallSessionIdFromHeader(req)) {
        const callSession = await loadCallSessionFromHeader(req);
        if (!isCallSessionVerifiedForMember(callSession, member.id)) {
          res.status(403).json(authErrorBody("AUTH_HIPAA_REQUIRED", "Call session HIPAA verification required for this member"));
          return;
        }
      }

      const items = await casesService.getAttachmentsForMember(member.id);
      res.json({ items });
    })().catch((error: unknown) => {
      res.status(500).json(
        errorBody(
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "Failed to list member attachments",
        ),
      );
    });
  };

  const listInteractionsForMember: RequestHandler = (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json(errorBody("BAD_REQUEST", "Member id is required"));
      return;
    }

    void (async () => {
      const member = await membersService.getById(id);
      if (!member) {
        res.status(404).json(errorBody("NOT_FOUND", "Member not found"));
        return;
      }

      if (getCallSessionIdFromHeader(req)) {
        const callSession = await loadCallSessionFromHeader(req);
        if (!isCallSessionVerifiedForMember(callSession, member.id)) {
          res.status(403).json(authErrorBody("AUTH_HIPAA_REQUIRED", "Call session HIPAA verification required for this member"));
          return;
        }
        const items = await casesService.getInteractionsForMember(member.id, true);
        res.json({ items });
        return;
      }

      const isVerified = !isHipaaMaskingEnabled() || isMemberHipaaVerified(req, member.id);
      const items = await casesService.getInteractionsForMember(member.id, isVerified);
      res.json({ items });
    })().catch((error: unknown) => {
      res.status(500).json(
        errorBody("INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to load member interactions"),
      );
    });
  };

  const ssnReveal: RequestHandler = (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { reason } = req.body as { reason?: string };
    const sessionUser = req.session.user;
    const actor = { id: sessionUser?.id, email: sessionUser?.email };
    const callSessionId = getCallSessionIdFromHeader(req);

    void (async () => {
      if (!reason || !ALLOWED_SSN_REVEAL_REASONS.has(reason)) {
        appendHipaaAuditEntry({
          timestamp: new Date().toISOString(),
          actor,
          memberId: id ?? null,
          caseId: null,
          method: null,
          result: "failed",
          callSessionId: callSessionId ?? undefined,
          detail: "ssn-reveal-denied:invalid-reason",
          reason,
        });
        const allowed = [...ALLOWED_SSN_REVEAL_REASONS].join(", ");
        res.status(400).json(errorBody("BAD_REQUEST", `reason must be one of: ${allowed}`));
        return;
      }

      if (!callSessionId) {
        appendHipaaAuditEntry({
          timestamp: new Date().toISOString(),
          actor,
          memberId: id ?? null,
          caseId: null,
          method: null,
          result: "failed",
          detail: "ssn-reveal-denied:session-required",
          reason,
        });
        res.status(401).json(authErrorBody("AUTH_SESSION_REQUIRED", "Active call session required for SSN reveal"));
        return;
      }

      const member = await membersService.getById(id);
      if (!member) {
        appendHipaaAuditEntry({
          timestamp: new Date().toISOString(),
          actor,
          memberId: id ?? null,
          caseId: null,
          method: null,
          result: "failed",
          callSessionId,
          detail: "ssn-reveal-denied:member-not-found",
          reason,
        });
        res.status(404).json(errorBody("NOT_FOUND", "Member not found"));
        return;
      }

      const callSession = await loadCallSessionFromHeader(req);
      if (!isCallSessionVerifiedForMember(callSession, member.id)) {
        const denialDetail = callSession?.lockedAt
          ? "ssn-reveal-denied:session-locked"
          : "ssn-reveal-denied:unverified";
        appendHipaaAuditEntry({
          timestamp: new Date().toISOString(),
          actor,
          memberId: member.id,
          caseId: null,
          method: null,
          result: "failed",
          callSessionId,
          detail: denialDetail,
          reason,
        });
        res.status(403).json(authErrorBody("AUTH_HIPAA_REQUIRED", "Verified call session required for SSN reveal"));
        return;
      }

      // member.ssn is null when absent (normalized by MembersService from "" to null per BE-055).
      const rawSsn = member.ssn;
      const hasSsnOnFile = typeof rawSsn === "string" && rawSsn.trim().length > 0;
      const ssnDigits = hasSsnOnFile ? rawSsn!.replace(/\D/g, "") : "";
      const ssnLastFour = ssnDigits.length >= 4 ? ssnDigits.slice(-4) : null;

      appendHipaaAuditEntry({
        timestamp: new Date().toISOString(),
        actor,
        memberId: member.id,
        caseId: null,
        method: null,
        result: "ssn-reveal",
        callSessionId,
        reason,
      });

      res.json({ memberId: member.id, hasSsnOnFile, ssnLastFour });
    })().catch((error: unknown) => {
      res.status(500).json(
        errorBody("INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to process SSN reveal"),
      );
    });
  };

  return {
    getMembers,
    getMemberById,
    verifyMemberHipaa,
    listCasesForMember,
    listAttachmentsForMember,
    listInteractionsForMember,
    ssnReveal,
  };
}
