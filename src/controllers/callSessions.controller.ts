import { Request, RequestHandler } from "express";
import {
  ALLOWED_CALL_HIPAA_METHODS,
  CallSessionsService,
  VerifyHipaaOutcome,
} from "../services/callSessions.service";
import { appendHipaaAuditEntry } from "../security/hipaaAuditLog";
import { errorBody } from "../types/http";
import { env } from "../config/env";

interface SessionUserShape {
  id?: string;
  email?: string;
}

function getSessionUser(req: Request): SessionUserShape | undefined {
  return (req.session as { user?: SessionUserShape }).user;
}

export function createCallSessionsController(callSessionsService: CallSessionsService) {
  const startCallSession: RequestHandler = (req, res) => {
    const sessionUser = getSessionUser(req);
    const agentId = sessionUser?.id;

    if (!agentId) {
      res.status(401).json(errorBody("UNAUTHORIZED", "Session user is required to start a call session"));
      return;
    }

    const { callerPhone, memberId } = (req.body ?? {}) as {
      callerPhone?: string | null;
      memberId?: string | null;
    };

    if (callerPhone !== undefined && callerPhone !== null && typeof callerPhone !== "string") {
      res.status(400).json(errorBody("BAD_REQUEST", "callerPhone must be a string when provided"));
      return;
    }
    if (memberId !== undefined && memberId !== null && typeof memberId !== "string") {
      res.status(400).json(errorBody("BAD_REQUEST", "memberId must be a string when provided"));
      return;
    }

    void callSessionsService
      .startSession(
        {
          agentId,
          callerPhone: callerPhone?.trim() || null,
          memberId: memberId?.trim() || null,
        },
        { actorId: agentId, actorEmail: sessionUser?.email },
      )
      .then((session) => {
        res.json(session);
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to start call session",
          },
        });
      });
  };

  const endCallSession: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const sessionUser = getSessionUser(req);

    if (!id) {
      res.status(400).json(errorBody("BAD_REQUEST", "id is required"));
      return;
    }

    const rawReason = (req.body ?? {}) as { reason?: unknown };
    let reason: string | undefined;
    if (typeof rawReason.reason === "string") {
      const trimmed = rawReason.reason.trim();
      if (trimmed.length > 0) {
        reason = trimmed.slice(0, 64);
      }
    }

    void callSessionsService
      .endSession(id, { actorId: sessionUser?.id, actorEmail: sessionUser?.email }, { reason })
      .then((session) => {
        if (!session) {
          res.status(404).json(errorBody("NOT_FOUND", "Call session not found"));
          return;
        }
        res.json(session);
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to end call session",
          },
        });
      });
  };

  const getCallSession: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id) {
      res.status(400).json(errorBody("BAD_REQUEST", "id is required"));
      return;
    }

    void callSessionsService
      .getSession(id)
      .then((session) => {
        if (!session) {
          res.status(404).json(errorBody("NOT_FOUND", "Call session not found"));
          return;
        }
        // Compute expiresAt from the most-recent verification stamp so FE can drive T-60s warnings.
        const stamps = Object.values(session.verifiedMemberIds ?? {});
        const latestVerifiedAtMs = stamps.length > 0
          ? Math.max(...stamps.map((s) => s.verifiedAtMs))
          : null;
        const ttlMs = env.hipaaVerificationTtlMs;
        const expiresAt = latestVerifiedAtMs !== null && !session.lockedAt && !session.endedAt
          ? new Date(latestVerifiedAtMs + ttlMs).toISOString()
          : null;
        res.json({ ...session, expiresAt, ttlSeconds: Math.round(ttlMs / 1000) });
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to load call session",
          },
        });
      });
  };

  const verifyCallSessionHipaa: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const sessionUser = getSessionUser(req);

    if (!id) {
      res.status(400).json(errorBody("BAD_REQUEST", "id is required"));
      return;
    }

    const { memberId, method, outcome, evidence } = (req.body ?? {}) as {
      memberId?: string;
      method?: string;
      outcome?: VerifyHipaaOutcome;
      evidence?: string;
    };

    if (typeof memberId !== "string" || !memberId.trim()) {
      res.status(400).json(errorBody("BAD_REQUEST", "memberId is required"));
      return;
    }
    if (typeof method !== "string" || !method.trim()) {
      res.status(400).json(errorBody("BAD_REQUEST", "method is required"));
      return;
    }
    if (outcome !== undefined && outcome !== "verify" && outcome !== "refused") {
      res.status(400).json(errorBody("BAD_REQUEST", "outcome must be 'verify' or 'refused'"));
      return;
    }

    const resolvedOutcome: VerifyHipaaOutcome = outcome ?? "verify";

    if (resolvedOutcome === "verify" && !ALLOWED_CALL_HIPAA_METHODS.has(method)) {
      // BE-045: audit the controller-level rejection without logging raw user input
      appendHipaaAuditEntry({
        timestamp: new Date().toISOString(),
        actor: { id: sessionUser?.id, email: sessionUser?.email },
        memberId: memberId.trim(),
        caseId: null,
        method: null,
        result: "failed",
        callSessionId: id,
        detail: "invalid-method",
      });
      res.status(400).json(
        errorBody(
          "BAD_REQUEST",
          `method must be one of: ${[...ALLOWED_CALL_HIPAA_METHODS].join(", ")}`,
        ),
      );
      return;
    }

    if (evidence !== undefined && typeof evidence !== "string") {
      res.status(400).json(errorBody("BAD_REQUEST", "evidence must be a string when provided"));
      return;
    }

    void callSessionsService
      .verifyHipaa(
        id,
        {
          memberId: memberId.trim(),
          method: method.trim(),
          outcome: resolvedOutcome,
          evidence: evidence?.trim() || undefined,
        },
        { actorId: sessionUser?.id, actorEmail: sessionUser?.email },
      )
      .then((result) => {
        if (result.kind === "session-not-found") {
          res.status(404).json(errorBody("NOT_FOUND", "Call session not found"));
          return;
        }
        if (result.kind === "session-locked") {
          res.status(400).json(errorBody("BAD_REQUEST", "Call session is locked"));
          return;
        }
        if (result.kind === "member-not-found") {
          res.status(404).json(errorBody("NOT_FOUND", "Member not found"));
          return;
        }
        if (result.kind === "invalid-method") {
          res.status(400).json(
            errorBody(
              "BAD_REQUEST",
              `method must be one of: ${[...ALLOWED_CALL_HIPAA_METHODS].join(", ")}`,
            ),
          );
          return;
        }
        if (result.kind === "attempt-limit-exceeded") {
          res.status(429).json(
            errorBody("TOO_MANY_REQUESTS", "Too many failed verification attempts for this session"),
          );
          return;
        }
        res.json({
          ok: true,
          session: result.session,
          verifiedAt: result.verifiedAt,
          expiresAt: result.expiresAt,
          ttlSeconds: Math.round(result.ttlMs / 1000),
        });
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to verify call session HIPAA",
          },
        });
      });
  };

  const extendCallSession: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const sessionUser = getSessionUser(req);
    const agentId = sessionUser?.id;

    if (!agentId) {
      res.status(401).json(errorBody("UNAUTHORIZED", "Session user is required to extend a call session"));
      return;
    }

    void callSessionsService
      .extendSession(id, { actorId: agentId, actorEmail: sessionUser?.email })
      .then((result) => {
        if (result.kind === "not-found") {
          res.status(404).json(errorBody("NOT_FOUND", "Call session not found"));
          return;
        }
        if (result.kind === "locked") {
          res.status(400).json(errorBody("BAD_REQUEST", "Call session is locked and cannot be extended"));
          return;
        }
        if (result.kind === "no-verified-members") {
          res.status(400).json(errorBody("BAD_REQUEST", "Call session has no verified members to extend"));
          return;
        }
        if (result.kind === "cross-agent") {
          res.status(403).json(errorBody("FORBIDDEN", "Call session belongs to a different agent"));
          return;
        }
        res.json({
          ok: true,
          session: result.session,
          extendedAt: result.extendedAt,
          expiresAt: result.expiresAt,
          ttlMs: result.ttlMs,
        });
      })
      .catch((error: unknown) => {
        res.status(500).json(
          errorBody("INTERNAL_ERROR", error instanceof Error ? error.message : "Failed to extend call session"),
        );
      });
  };

  return { startCallSession, endCallSession, getCallSession, verifyCallSessionHipaa, extendCallSession };
}
