import fs from "fs";
import path from "path";
import { randomBytes, createHash } from "crypto";
import { Request, RequestHandler } from "express";
import { parseCaseListQuery } from "../http/pagination";
import { CallSessionsService } from "../services/callSessions.service";
import { CasesService } from "../services/cases.service";
import {
  determineCallSessionDenialReason,
  getCallSessionIdFromHeader,
  isCallSessionVerifiedForMember,
  isCaseHipaaVerified,
  isHipaaMaskingEnabled,
  isMemberHipaaVerified,
  maskCaseDetailForResponse,
  maskCaseSummaryForResponse,
} from "../security/hipaa";
import { appendHipaaAuditEntry, CaseMutationKind } from "../security/hipaaAuditLog";
import { authErrorBody, BadRequestError, ConflictError, denialBody, DenialReasonCode } from "../types/http";
import { CallDirection, CallSession, CaseAttachmentSummary, CaseStatus } from "../types/models";

const SALESFORCE_EXPORT_ROOT = path.resolve(
  __dirname,
  "../../imports/salesforce/exports/2026-04-25",
);

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".txt": "text/plain; charset=utf-8",
};

function badRequest(res: Parameters<RequestHandler>[1], message: string) {
  res.status(400).json({
    error: {
      code: "BAD_REQUEST",
      message,
    },
  });
}

function notFound(res: Parameters<RequestHandler>[1]) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Case not found",
    },
  });
}

function attachmentNotFound(res: Parameters<RequestHandler>[1]) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Attachment not found",
    },
  });
}

function newCorrelationId() {
  return randomBytes(8).toString("hex");
}

function caseIdHash(caseId: string) {
  return createHash("sha256").update(caseId).digest("hex").slice(0, 12);
}

function deny(
  res: Parameters<RequestHandler>[1],
  httpStatus: number,
  reasonCode: DenialReasonCode,
  correlationId: string,
) {
  res.status(httpStatus).json(denialBody(httpStatus, reasonCode, correlationId, reasonCode !== "not_found"));
}

function recordDenial(
  req: Request,
  reasonCode: DenialReasonCode,
  correlationId: string,
  endpoint: string,
  caseId?: string,
) {
  const sessionUser = (req.session as any).user as { id?: string; email?: string } | undefined;
  appendHipaaAuditEntry({
    timestamp: new Date().toISOString(),
    actor: { id: sessionUser?.id, email: sessionUser?.email },
    memberId: null,
    caseId: null,
    method: null,
    result: "case-access-denied",
    callSessionId: getCallSessionIdFromHeader(req) ?? undefined,
    detail: JSON.stringify({
      reasonCode,
      correlationId,
      endpoint,
      ...(caseId ? { caseIdHash: caseIdHash(caseId) } : {}),
    }),
  });
}

function conflict(res: Parameters<RequestHandler>[1], message: string) {
  res.status(409).json({
    error: {
      code: "CONFLICT",
      message,
    },
  });
}

function fileOnDiskNotFound(res: Parameters<RequestHandler>[1]) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Attachment file not found",
    },
  });
}

function getAuthor(req: Request) {
  const sessionUser = (req.session as any).user as
    | { firstName?: string; lastName?: string }
    | undefined;
  return sessionUser
    ? `${sessionUser.firstName ?? ""} ${sessionUser.lastName ?? ""}`.trim()
    : "System";
}

function isPathTraversalAttempt(exportRelativePath: string) {
  if (!exportRelativePath || exportRelativePath.includes("\0")) {
    return true;
  }

  const normalized = path.posix.normalize(exportRelativePath);
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    return true;
  }

  if (
    !normalized.startsWith("ContentVersion/")
    && !normalized.startsWith("Attachments/")
  ) {
    return true;
  }

  const resolvedPath = path.resolve(SALESFORCE_EXPORT_ROOT, normalized);
  return !resolvedPath.startsWith(`${SALESFORCE_EXPORT_ROOT}${path.sep}`);
}

function getDownloadFilename(attachment: CaseAttachmentSummary) {
  const candidate = (
    attachment.name?.trim()
    || attachment.title?.trim()
    || path.posix.basename(attachment.exportRelativePath ?? "")
    || attachment.id
  );
  return candidate.replace(/[\r\n"]/g, "_");
}

function getContentType(attachment: CaseAttachmentSummary, filename: string) {
  if (attachment.mimeType?.trim()) {
    return attachment.mimeType.trim();
  }

  const extension = path.extname(filename).toLowerCase();
  return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export function createCasesController(
  casesService: CasesService,
  callSessionsService: CallSessionsService,
) {
  const loadCallSessionFromHeader = async (req: Request): Promise<CallSession | null> => {
    const id = getCallSessionIdFromHeader(req);
    if (!id) return null;
    return callSessionsService.getSession(id);
  };

  const recordCaseMutationOnCall = async (
    req: Request,
    kind: CaseMutationKind,
    caseInfo: { id: string; memberId: string },
    extraDetail?: Record<string, unknown>,
  ) => {
    const sessionIdRaw = getCallSessionIdFromHeader(req);
    if (!sessionIdRaw) return;

    const sessionUser = (req.session as any).user as { id?: string; email?: string } | undefined;
    const actorId = sessionUser?.id;
    const actorEmail = sessionUser?.email;
    const now = new Date().toISOString();

    try {
      const callSession = await callSessionsService.getSession(sessionIdRaw);
      const agentMatches = !callSession || callSession.agentId === actorId;
      const memberVerified = isCallSessionVerifiedForMember(callSession, caseInfo.memberId);
      const valid = !!callSession && agentMatches && memberVerified;

      appendHipaaAuditEntry({
        timestamp: now,
        actor: { id: actorId, email: actorEmail },
        memberId: caseInfo.memberId,
        caseId: caseInfo.id,
        method: null,
        result: "case-mutation-on-call",
        callSessionId: sessionIdRaw,
        detail: JSON.stringify({
          kind,
          valid,
          ...(extraDetail ?? {}),
          ...(!valid && {
            reason: !callSession
              ? "session-not-found"
              : !agentMatches
                ? "agent-mismatch"
                : "member-not-verified",
          }),
        }),
      });
    } catch (auditErr) {
      console.error(
        `[case-mutation-on-call] HIPAA audit linkage failed (${kind}, case=${caseInfo.id}, session=${sessionIdRaw}): ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
      );
    }
  };

  const runAssignCase = (
    req: Request,
    id: string,
    agent: string,
    author: string,
    res: Parameters<RequestHandler>[1],
    auditKind: "assign" | "patch-agent",
  ) => {
    return casesService
      .assignCase(id, agent, author)
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }

        res.json({ ok: true });
        void recordCaseMutationOnCall(req, auditKind, updatedCase, { agent });
      });
  };

  const runUpdateCaseStatus = (
    req: Request,
    id: string,
    status: CaseStatus,
    author: string,
    res: Parameters<RequestHandler>[1],
    auditKind: "patch-status" | "status",
  ) => {
    return casesService
      .updateStatus(id, status, author)
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }

        res.json({ ok: true });
        void recordCaseMutationOnCall(req, auditKind, updatedCase, { status });
      });
  };

  const getCaseStats: RequestHandler = (_req, res) => {
    void casesService
      .getStats()
      .then((stats) => {
        res.json(stats);
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to load case stats",
          },
        });
      });
  };

  const listCases: RequestHandler = (req, res) => {
    void (async () => {
      const query = parseCaseListQuery(req.query as Record<string, unknown>);
      const page = await casesService.getPage(query);

      const hasCallSessionHeader = !!getCallSessionIdFromHeader(req);
      const callSession = hasCallSessionHeader ? await loadCallSessionFromHeader(req) : null;

      res.json({
        items: page.items.map((entry) => {
          const verified = callSession
            ? isCallSessionVerifiedForMember(callSession, entry.memberId)
            : false;
          const base = verified ? entry : maskCaseSummaryForResponse(req, entry);
          // Annotate each row with session accessibility so FE-161 can guard navigation.
          return {
            ...base,
            sessionAccessible: hasCallSessionHeader ? verified : null,
          };
        }),
        pageInfo: page.pageInfo,
      });
    })().catch((error: unknown) => {
      if (error instanceof BadRequestError) {
        badRequest(res, error.message);
        return;
      }

      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to list cases",
        },
      });
    });
  };

  const getCaseDetail: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    void (async () => {
      const existingCase = await casesService.getById(id);
      if (!existingCase) {
        const corrId = newCorrelationId();
        recordDenial(req, "not_found", corrId, "GET /v1/cases/:id");
        deny(res, 404, "not_found", corrId);
        return;
      }

      if (getCallSessionIdFromHeader(req)) {
        const callSession = await loadCallSessionFromHeader(req);
        if (!isCallSessionVerifiedForMember(callSession, existingCase.memberId)) {
          const reasonCode = determineCallSessionDenialReason(callSession, existingCase.memberId);
          const corrId = newCorrelationId();
          recordDenial(req, reasonCode, corrId, "GET /v1/cases/:id", existingCase.id);
          deny(res, 403, reasonCode, corrId);
          return;
        }
        res.json(existingCase);
        return;
      }

      if (!isHipaaMaskingEnabled()) {
        res.json(existingCase);
        return;
      }

      res.json(maskCaseDetailForResponse(req, existingCase));
    })().catch((error: unknown) => {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch case",
        },
      });
    });
  };

  const downloadCaseAttachment: RequestHandler = (req, res) => {
    const rawCaseId = req.params.caseId;
    const rawAttachmentId = req.params.attachmentId;
    const caseId = Array.isArray(rawCaseId) ? rawCaseId[0] : rawCaseId;
    const attachmentId = Array.isArray(rawAttachmentId) ? rawAttachmentId[0] : rawAttachmentId;

    if (!caseId) {
      badRequest(res, "caseId is required");
      return;
    }

    if (!attachmentId) {
      badRequest(res, "attachmentId is required");
      return;
    }

    void (async () => {
      const existingCase = await casesService.getById(caseId);
      if (!existingCase) {
        const corrId = newCorrelationId();
        recordDenial(req, "not_found", corrId, "GET /v1/cases/:caseId/attachments/:attachmentId");
        deny(res, 404, "not_found", corrId);
        return;
      }

      const attachment = existingCase.attachments?.find((item) => item.id === attachmentId);
      if (!attachment) {
        attachmentNotFound(res);
        return;
      }

      if (getCallSessionIdFromHeader(req)) {
        const callSession = await loadCallSessionFromHeader(req);
        if (!isCallSessionVerifiedForMember(callSession, existingCase.memberId)) {
          const reasonCode = determineCallSessionDenialReason(callSession, existingCase.memberId);
          const corrId = newCorrelationId();
          recordDenial(req, reasonCode, corrId, "GET /v1/cases/:caseId/attachments/:attachmentId", existingCase.id);
          deny(res, 403, reasonCode, corrId);
          return;
        }
      } else if (
        isHipaaMaskingEnabled()
        && !isCaseHipaaVerified(req, existingCase.id)
        && !isMemberHipaaVerified(req, existingCase.memberId)
      ) {
        const corrId = newCorrelationId();
        recordDenial(req, "case_restricted", corrId, "GET /v1/cases/:caseId/attachments/:attachmentId", existingCase.id);
        deny(res, 403, "case_restricted", corrId);
        return;
      }

      if (!attachment.exportRelativePath) {
        fileOnDiskNotFound(res);
        return;
      }

      if (isPathTraversalAttempt(attachment.exportRelativePath)) {
        badRequest(res, "Invalid attachment path");
        return;
      }

      const resolvedPath = path.resolve(
        SALESFORCE_EXPORT_ROOT,
        path.posix.normalize(attachment.exportRelativePath),
      );

      let stats: fs.Stats;
      try {
        stats = fs.statSync(resolvedPath);
      } catch {
        fileOnDiskNotFound(res);
        return;
      }

      if (!stats.isFile()) {
        fileOnDiskNotFound(res);
        return;
      }

      const filename = getDownloadFilename(attachment);
      res.setHeader("Content-Type", getContentType(attachment, filename));
      res.setHeader("Content-Length", stats.size.toString());
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );

      const stream = fs.createReadStream(resolvedPath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.status(500).json({
            error: {
              code: "INTERNAL_ERROR",
              message: "Failed to stream attachment",
            },
          });
          return;
        }

        res.destroy();
      });
      stream.pipe(res);
    })().catch((error: unknown) => {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Failed to download attachment",
        },
      });
    });
  };

  const assignCase: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const { agent } = req.body as { agent?: string };
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const author = getAuthor(req);

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    if (!agent || typeof agent !== "string") {
      badRequest(res, "agent is required");
      return;
    }

    void runAssignCase(req, id, agent.trim(), author, res, "assign")
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to assign case",
          },
        });
      });
  };

  const patchCase: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { status, agent, fcr, firstCallResolution } = req.body as {
      status?: CaseStatus;
      agent?: string | null;
      fcr?: string | null;
      firstCallResolution?: boolean | null;
    };
    const author = getAuthor(req);
    const allowedStatuses: CaseStatus[] = ["Open", "Waiting", "Escalated", "Closed"];
    const hasStatus = typeof status === "string";
    const hasAgent = Object.prototype.hasOwnProperty.call(req.body as object, "agent");
    const hasFcr = Object.prototype.hasOwnProperty.call(req.body as object, "fcr");
    const hasFcr2 = Object.prototype.hasOwnProperty.call(req.body as object, "firstCallResolution");

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    const exclusiveFieldCount =
      (hasStatus ? 1 : 0) + (hasAgent ? 1 : 0) + (hasFcr ? 1 : 0) + (hasFcr2 ? 1 : 0);
    if (exclusiveFieldCount > 1) {
      badRequest(res, "Provide only one of status, agent, fcr, or firstCallResolution");
      return;
    }

    if (hasStatus) {
      if (!allowedStatuses.includes(status)) {
        badRequest(res, "status is required");
        return;
      }

      void runUpdateCaseStatus(req, id, status, author, res, "patch-status").catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to update case status",
          },
        });
      });
      return;
    }

    if (hasAgent) {
      if (agent !== null && typeof agent !== "string") {
        badRequest(res, "agent must be a string or null");
        return;
      }

      void runAssignCase(req, id, (agent ?? "").trim(), author, res, "patch-agent").catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to assign case",
          },
        });
      });
      return;
    }

    if (hasFcr) {
      let normalizedFcr: "yes" | "no" | null;
      if (fcr === null) {
        normalizedFcr = null;
      } else if (typeof fcr === "string") {
        const lowered = fcr.toLowerCase();
        if (lowered !== "yes" && lowered !== "no") {
          badRequest(res, "fcr must be 'yes', 'no', or null");
          return;
        }
        normalizedFcr = lowered;
      } else {
        badRequest(res, "fcr must be 'yes', 'no', or null");
        return;
      }

      const callSessionId = getCallSessionIdFromHeader(req);

      void casesService
        .tagFcr(id, normalizedFcr, author, callSessionId)
        .then((updatedCase) => {
          if (!updatedCase) {
            notFound(res);
            return;
          }
          res.json({ ok: true, fcr: updatedCase.fcr ?? null });
          void recordCaseMutationOnCall(req, "patch-fcr", updatedCase, { fcr: normalizedFcr });
        })
        .catch((error: unknown) => {
          if (error instanceof ConflictError) {
            conflict(res, error.message);
            return;
          }
          res.status(500).json({
            error: {
              code: "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : "Failed to tag FCR",
            },
          });
        });
      return;
    }

    if (hasFcr2) {
      if (firstCallResolution !== null && typeof firstCallResolution !== "boolean") {
        badRequest(res, "firstCallResolution must be true, false, or null");
        return;
      }

      const callSessionId = getCallSessionIdFromHeader(req);

      void casesService
        .setFirstCallResolution(id, firstCallResolution ?? null, author, callSessionId)
        .then((updatedCase) => {
          if (!updatedCase) {
            notFound(res);
            return;
          }
          res.json({ ok: true, firstCallResolution: updatedCase.firstCallResolution ?? null });
          void recordCaseMutationOnCall(req, "patch-first-call-resolution", updatedCase, {
            firstCallResolution: firstCallResolution ?? null,
          });
        })
        .catch((error: unknown) => {
          res.status(500).json({
            error: {
              code: "INTERNAL_ERROR",
              message: error instanceof Error ? error.message : "Failed to set first call resolution",
            },
          });
        });
      return;
    }

    badRequest(res, "status, agent, fcr, or firstCallResolution is required");
  };

  const addCaseCall: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { summary, outcome, direction, durationSeconds } = req.body as {
      summary?: string;
      outcome?: string;
      direction?: CallDirection | null;
      durationSeconds?: number | null;
    };
    const author = getAuthor(req);
    const allowedDirections: CallDirection[] = ["Inbound", "Outbound"];

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    if (!summary || typeof summary !== "string") {
      badRequest(res, "summary is required");
      return;
    }

    if (
      direction !== undefined
      && direction !== null
      && (typeof direction !== "string" || !allowedDirections.includes(direction))
    ) {
      badRequest(res, "direction must be Inbound or Outbound");
      return;
    }

    if (
      durationSeconds !== undefined
      && durationSeconds !== null
      && (!Number.isInteger(durationSeconds) || durationSeconds < 0)
    ) {
      badRequest(res, "durationSeconds must be a non-negative integer");
      return;
    }

    void casesService
      .addCall(
        id,
        summary.trim(),
        typeof outcome === "string" ? outcome.trim() : null,
        author,
        {
          direction: direction ?? null,
          durationSeconds: durationSeconds ?? null,
        },
      )
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }

        res.json({ ok: true });
        void recordCaseMutationOnCall(req, "call", updatedCase);
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to log case call",
          },
        });
      });
  };

  const addCaseTask: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { title, dueDate } = req.body as { title?: string; dueDate?: string };
    const author = getAuthor(req);

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    if (!title || typeof title !== "string") {
      badRequest(res, "title is required");
      return;
    }

    if (dueDate !== undefined && typeof dueDate !== "string") {
      badRequest(res, "dueDate must be a string");
      return;
    }

    void casesService
      .addTask(id, title.trim(), dueDate?.trim() ? dueDate.trim() : null, author)
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }

        res.json({ ok: true });
        void recordCaseMutationOnCall(req, "task", updatedCase);
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to add case task",
          },
        });
      });
  };

  const addCaseNote: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { text } = req.body as { text?: string };
    const author = getAuthor(req);

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    if (!text || typeof text !== "string") {
      badRequest(res, "text is required");
      return;
    }

    void casesService
      .addNote(id, text.trim(), author)
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }

        res.json({ ok: true });
        void recordCaseMutationOnCall(req, "note", updatedCase);
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to add note",
          },
        });
      });
  };

  const updateCaseStatus: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { status } = req.body as { status?: CaseStatus };
    const author = getAuthor(req);
    const allowedStatuses: CaseStatus[] = ["Open", "Waiting", "Escalated", "Closed"];

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    if (!status || !allowedStatuses.includes(status)) {
      badRequest(res, "status is required");
      return;
    }

    void runUpdateCaseStatus(req, id, status, author, res, "status")
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to update case status",
          },
        });
      });
  };

  const addCaseEmail: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { to, subject, body, inReplyToId } = req.body as {
      to?: string;
      subject?: string;
      body?: string;
      inReplyToId?: string | null;
    };
    const author = getAuthor(req);

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    if (!to || !subject || !body) {
      badRequest(res, "to, subject, and body are required");
      return;
    }

    if (inReplyToId !== undefined && inReplyToId !== null && typeof inReplyToId !== "string") {
      badRequest(res, "inReplyToId must be a string");
      return;
    }

    void casesService
      .addEmail(
        id,
        to.trim(),
        subject.trim(),
        body.trim(),
        author,
        inReplyToId?.trim() ? inReplyToId.trim() : null,
      )
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }

        res.json({ ok: true });
        void recordCaseMutationOnCall(req, "email", updatedCase);
      })
      .catch((error: unknown) => {
        if (error instanceof BadRequestError) {
          badRequest(res, error.message);
          return;
        }

        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to add case email",
          },
        });
      });
  };

  const addCaseGlipOut: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { channel, body, inReplyToId } = req.body as {
      channel?: string;
      body?: string;
      inReplyToId?: string | null;
    };
    const author = getAuthor(req);

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    if (!channel || !body) {
      badRequest(res, "channel and body are required");
      return;
    }

    if (inReplyToId !== undefined && inReplyToId !== null && typeof inReplyToId !== "string") {
      badRequest(res, "inReplyToId must be a string");
      return;
    }

    void casesService
      .addGlipOut(
        id,
        channel.trim(),
        body.trim(),
        author,
        inReplyToId?.trim() ? inReplyToId.trim() : null,
      )
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }
        res.json({ ok: true });
        void recordCaseMutationOnCall(req, "glip-out", updatedCase);
      })
      .catch((error: unknown) => {
        if (error instanceof BadRequestError) {
          badRequest(res, error.message);
          return;
        }
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to post GLIP message",
          },
        });
      });
  };

  const addCaseNiftyOut: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { taskRef, body, inReplyToId } = req.body as {
      taskRef?: string;
      body?: string;
      inReplyToId?: string | null;
    };
    const author = getAuthor(req);

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    if (!taskRef || !body) {
      badRequest(res, "taskRef and body are required");
      return;
    }

    if (inReplyToId !== undefined && inReplyToId !== null && typeof inReplyToId !== "string") {
      badRequest(res, "inReplyToId must be a string");
      return;
    }

    void casesService
      .addNiftyOut(
        id,
        taskRef.trim(),
        body.trim(),
        author,
        inReplyToId?.trim() ? inReplyToId.trim() : null,
      )
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }
        res.json({ ok: true });
        void recordCaseMutationOnCall(req, "nifty-out", updatedCase);
      })
      .catch((error: unknown) => {
        if (error instanceof BadRequestError) {
          badRequest(res, error.message);
          return;
        }
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to post Nifty message",
          },
        });
      });
  };

  const closeCase: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const author = getAuthor(req);
    const { fcr, resolution, resolutionDetails, notes, callSessionId } = req.body as {
      fcr?: string | null;
      resolution?: string;
      resolutionDetails?: string;
      notes?: string;
      callSessionId?: string;
    };

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    let normalizedFcr: "yes" | "no" | undefined;
    if (fcr !== undefined && fcr !== null && fcr !== "") {
      const lowered = typeof fcr === "string" ? fcr.toLowerCase() : "";
      if (lowered !== "yes" && lowered !== "no") {
        badRequest(res, "fcr must be 'yes' or 'no'");
        return;
      }
      normalizedFcr = lowered;
    }

    const sessionUser = (req.session as any).user as { id?: string; email?: string } | undefined;
    const actorId = sessionUser?.id;
    const actorEmail = sessionUser?.email;

    void casesService
      .closeCase(id, author, {
        fcr: normalizedFcr,
        resolution,
        resolutionDetails: resolutionDetails ?? notes,
      })
      .then(async (updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }

        res.json({ ok: true });

        // Fire-and-forget HIPAA audit linkage — must never block the close response.
        if (callSessionId && typeof callSessionId === "string" && callSessionId.trim()) {
          const sessionIdTrimmed = callSessionId.trim();
          try {
            const callSession = await callSessionsService.getSession(sessionIdTrimmed);
            const now = new Date().toISOString();

            const agentMatches = !callSession || callSession.agentId === actorId;
            const memberVerified = isCallSessionVerifiedForMember(callSession, updatedCase.memberId);
            const valid = !!callSession && agentMatches && memberVerified;

            appendHipaaAuditEntry({
              timestamp: now,
              actor: { id: actorId, email: actorEmail },
              memberId: updatedCase.memberId,
              caseId: updatedCase.id,
              method: null,
              result: "case-closed-on-call",
              callSessionId: sessionIdTrimmed,
              detail: JSON.stringify({
                fcr: normalizedFcr ?? null,
                closedAt: updatedCase.closedAt ?? now,
                valid,
                ...(!valid && {
                  reason: !callSession
                    ? "session-not-found"
                    : !agentMatches
                      ? "agent-mismatch"
                      : "member-not-verified",
                }),
              }),
            });
          } catch (auditErr) {
            console.error(
              `[close-case] HIPAA audit linkage failed for session ${sessionIdTrimmed}: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
            );
          }
        }
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to close case",
          },
        });
      });
  };

  const reopenCase: RequestHandler = (req, res) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const author = getAuthor(req);

    if (!id) {
      badRequest(res, "id is required");
      return;
    }

    void casesService
      .reopenCase(id, author)
      .then((updatedCase) => {
        if (!updatedCase) {
          notFound(res);
          return;
        }

        res.json({ ok: true });
        void recordCaseMutationOnCall(req, "reopen", updatedCase);
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to reopen case",
          },
        });
      });
  };

  return {
    getCaseStats,
    listCases,
    getCaseDetail,
    downloadCaseAttachment,
    patchCase,
    assignCase,
    addCaseNote,
    addCaseCall,
    addCaseTask,
    updateCaseStatus,
    addCaseEmail,
    addCaseGlipOut,
    addCaseNiftyOut,
    closeCase,
    reopenCase,
  };
}
