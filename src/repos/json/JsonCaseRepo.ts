import { CaseRepo } from "../CaseRepo";
import { CaseListQuery, CaseStatusCounts, CursorPageResult } from "../../types/http";
import { BadRequestError, ConflictError } from "../../types/http";
import { CallDirection, CaseDetail, CaseStatus, CaseSummary, TimelineEntry } from "../../types/models";
import { readDatabase, writeDatabase } from "./jsonStore";
import { env } from "../../config/env";

type CaseCursorPayload = {
  createdAt: string;
  id: string;
};

function normalizeFcr(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value.toLowerCase() : value as string;
}

function mapCaseSummary(item: CaseDetail): CaseSummary {
  const { timeline, member, attachments, ...summary } = item;
  return {
    ...summary,
    fcr: normalizeFcr(summary.fcr),
    attachmentCount: attachments?.length ?? 0,
    dueAt: summary.dueAt ?? null,
  };
}

function decorateDetail(item: CaseDetail): CaseDetail {
  return {
    ...item,
    fcr: normalizeFcr(item.fcr),
    attachmentCount: item.attachments?.length ?? 0,
    dueAt: item.dueAt ?? null,
  };
}

function sortCaseSummaries(items: CaseSummary[]) {
  return [...items].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return right.createdAt.localeCompare(left.createdAt);
    }

    return right.id.localeCompare(left.id);
  });
}

function encodeCaseCursor(cursor: CaseCursorPayload) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCaseCursor(cursor: string): CaseCursorPayload {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CaseCursorPayload>;

    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") {
      throw new Error("invalid");
    }

    return {
      createdAt: decoded.createdAt,
      id: decoded.id,
    };
  } catch {
    throw new BadRequestError("Invalid cursor for cases pagination");
  }
}

function applyCaseSearch(items: CaseSummary[], params: CaseListQuery) {
  return items.filter((item) => {
    if (params.caseNumber && item.caseNumber !== params.caseNumber) {
      return false;
    }

    if (params.caseId && item.id !== params.caseId) {
      return false;
    }

    if (params.memberId && item.memberId !== params.memberId) {
      return false;
    }

    if (params.groupNumber && item.groupNumber !== params.groupNumber) {
      return false;
    }

    if (params.claimNumber && item.claimNumber !== params.claimNumber) {
      return false;
    }

    if (params.q) {
      const needle = params.q.toLowerCase();
      const haystack = [
        item.id,
        item.caseNumber,
        item.memberName,
        item.memberId,
        item.groupNumber,
        item.claimNumber,
      ]
        .map((value) => (value ?? "").toString().toLowerCase());

      if (!haystack.some((value) => value.includes(needle))) {
        return false;
      }
    }

    if (params.statuses && params.statuses.length > 0 && !params.statuses.includes(item.status)) {
      return false;
    }

    return true;
  });
}

function emptyCaseStatusCounts(): CaseStatusCounts {
  return {
    open: 0,
    waiting: 0,
    escalated: 0,
    closed: 0,
  };
}

export class JsonCaseRepo implements CaseRepo {
  async list(): Promise<CaseSummary[]> {
    return sortCaseSummaries(readDatabase().cases.map(mapCaseSummary));
  }

  async listPage(params: CaseListQuery): Promise<CursorPageResult<CaseSummary>> {
    let items = applyCaseSearch(await this.list(), params);

    if (params.cursor) {
      const cursor = decodeCaseCursor(params.cursor);
      items = items.filter((item) =>
        item.createdAt < cursor.createdAt
        || (item.createdAt === cursor.createdAt && item.id < cursor.id)
      );
    }

    const pageItems = items.slice(0, params.limit + 1);
    const hasNext = pageItems.length > params.limit;
    const itemsForResponse = hasNext ? pageItems.slice(0, params.limit) : pageItems;
    const lastItem = itemsForResponse.at(-1);

    return {
      items: itemsForResponse,
      pageInfo: {
        hasNext,
        nextCursor: hasNext && lastItem
          ? encodeCaseCursor({
              createdAt: lastItem.createdAt,
              id: lastItem.id,
            })
          : null,
      },
    };
  }

  async countByStatus(): Promise<CaseStatusCounts> {
    return readDatabase().cases.reduce((counts, item) => {
      if (item.status === "Open") {
        counts.open += 1;
      } else if (item.status === "Waiting") {
        counts.waiting += 1;
      } else if (item.status === "Escalated") {
        counts.escalated += 1;
      } else if (item.status === "Closed") {
        counts.closed += 1;
      }

      return counts;
    }, emptyCaseStatusCounts());
  }

  async getById(id: string): Promise<CaseDetail | null> {
    const found = readDatabase().cases.find((item) => item.id === id);
    return found ? decorateDetail(found) : null;
  }

  async assign(id: string, agent: string, author: string): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    const previousAgent = existingCase.agent ?? "";
    const timestamp = new Date().toISOString();
    existingCase.agent = agent;
    existingCase.updatedAt = timestamp;

    if (previousAgent !== agent) {
      existingCase.timeline.push({
        id: `tl-${id}-${Date.now()}`,
        type: "assignment",
        author,
        timestamp,
        from: previousAgent || null,
        to: agent || null,
        text: `Case assigned ${previousAgent ? `from ${previousAgent} ` : ""}to ${agent || "(unassigned)"}.`,
      });
    }

    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async addNote(id: string, text: string, author: string): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const entry: TimelineEntry = {
      id: `tl-${id}-${Date.now()}`,
      type: "note",
      author,
      timestamp,
      text,
    };

    existingCase.timeline.push(entry);
    existingCase.updatedAt = timestamp;
    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async addTask(
    id: string,
    title: string,
    dueDate: string | null,
    author: string,
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const text = `Task created: ${title}${dueDate ? ` (due ${dueDate})` : ""}`;
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "task",
      author,
      timestamp,
      taskDueDate: dueDate ?? undefined,
      text,
    });
    existingCase.updatedAt = timestamp;
    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async addCall(
    id: string,
    summary: string,
    outcome: string | null,
    author: string,
    metadata?: {
      direction?: CallDirection | null;
      durationSeconds?: number | null;
    },
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const text = `Call logged${outcome ? ` — ${outcome}` : ""}: ${summary}`;
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "call",
      author,
      timestamp,
      callDirection: metadata?.direction ?? undefined,
      callDurationSeconds: metadata?.durationSeconds ?? undefined,
      text,
    });
    existingCase.updatedAt = timestamp;
    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async updateStatus(
    id: string,
    status: CaseStatus,
    author: string,
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    const timestamp = new Date().toISOString();
    existingCase.status = status;
    existingCase.updatedAt = timestamp;
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "status",
      author,
      timestamp,
      toStatus: status,
      text: `Case status changed to ${status}.`,
    });
    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async addEmail(
    id: string,
    to: string,
    subject: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    if (
      inReplyToId
      && !existingCase.timeline.some((entry) => entry.id === inReplyToId && entry.type === "email-in")
    ) {
      throw new BadRequestError("inReplyToId must reference an email-in timeline entry on this case");
    }

    const timestamp = new Date().toISOString();
    existingCase.updatedAt = timestamp;
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "email-out",
      author,
      timestamp,
      inReplyToId: inReplyToId ?? undefined,
      to,
      subject,
      text: body,
    });
    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async addGlipOut(
    id: string,
    channel: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    if (
      inReplyToId
      && !existingCase.timeline.some((entry) => entry.id === inReplyToId && entry.type === "glip-message")
    ) {
      throw new BadRequestError("inReplyToId must reference a glip-message timeline entry on this case");
    }

    const timestamp = new Date().toISOString();
    existingCase.updatedAt = timestamp;
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "glip-out",
      author,
      timestamp,
      inReplyToId: inReplyToId ?? undefined,
      to: channel,
      text: body,
    });
    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async addNiftyOut(
    id: string,
    taskRef: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    if (
      inReplyToId
      && !existingCase.timeline.some((entry) => entry.id === inReplyToId && entry.type === "nifty-task")
    ) {
      throw new BadRequestError("inReplyToId must reference a nifty-task timeline entry on this case");
    }

    const timestamp = new Date().toISOString();
    existingCase.updatedAt = timestamp;
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "nifty-out",
      author,
      timestamp,
      inReplyToId: inReplyToId ?? undefined,
      to: taskRef,
      text: body,
    });
    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async close(
    id: string,
    author: string,
    payload: { fcr?: string; resolution?: string; resolutionDetails?: string },
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    const timestamp = new Date().toISOString();
    existingCase.status = "Closed";
    existingCase.closedAt = timestamp;
    existingCase.updatedAt = timestamp;
    existingCase.fcr = payload.fcr ?? null;
    existingCase.resolution = payload.resolution;
    existingCase.resolutionDetails = payload.resolutionDetails;
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "close",
      author,
      timestamp,
      text: `Case closed.${payload.resolution ? ` Resolution: ${payload.resolution}.` : ""}${payload.resolutionDetails ? ` ${payload.resolutionDetails}` : ""}${payload.fcr ? ` FCR: ${payload.fcr}.` : ""}`.trim(),
    });
    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async tagFcr(
    id: string,
    fcr: "yes" | "no" | null,
    author: string,
    callSessionId?: string | null,
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    if (existingCase.status === "Closed") {
      throw new ConflictError("Cannot tag FCR on a closed case");
    }

    const timestamp = new Date().toISOString();
    const previousFcr = existingCase.fcr
      ? (existingCase.fcr as string).toLowerCase()
      : null;
    const previousNormalized: "yes" | "no" | null =
      previousFcr === "yes" || previousFcr === "no" ? previousFcr : null;

    existingCase.fcr = fcr;
    existingCase.updatedAt = timestamp;

    const label =
      fcr === "yes"
        ? "Yes"
        : fcr === "no"
          ? "No"
          : "Clear";
    const sessionSuffix = callSessionId ? ` (call session ${callSessionId})` : "";
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "fcr-tagged",
      author,
      timestamp,
      from: previousNormalized,
      to: fcr,
      text: `FCR pre-tag: ${label}.${sessionSuffix}`,
    });

    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async setFirstCallResolution(
    id: string,
    value: boolean | null,
    author: string,
    callSessionId?: string | null,
  ): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const label = value === true ? "Yes" : value === false ? "No" : "Clear";
    const sessionSuffix = callSessionId ? ` (call session ${callSessionId})` : "";

    (existingCase as any).firstCallResolution = value;
    existingCase.updatedAt = timestamp;
    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "fcr-tagged",
      author,
      timestamp,
      text: `FCR (first call resolution): ${label}.${sessionSuffix}`,
    });

    writeDatabase(db);
    return decorateDetail(existingCase);
  }

  async reopen(id: string, author: string): Promise<CaseDetail | null> {
    const db = readDatabase();
    const existingCase = db.cases.find((item) => item.id === id);

    if (!existingCase) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const previousClosedAt = existingCase.closedAt;
    const previousFcr = existingCase.fcr ? existingCase.fcr.toLowerCase() : null;
    const reopenedAtMs = Date.parse(timestamp);
    const closedAtMs = previousClosedAt ? Date.parse(previousClosedAt) : NaN;
    const withinWindow =
      Number.isFinite(closedAtMs)
      && Number.isFinite(reopenedAtMs)
      && reopenedAtMs - closedAtMs <= env.fcrReopenRevokeWindowMs;
    const shouldRevokeFcr = withinWindow && previousFcr === "yes";

    existingCase.status = "Open";
    existingCase.closedAt = undefined;
    existingCase.updatedAt = timestamp;

    if (shouldRevokeFcr) {
      existingCase.fcr = null;
    }

    existingCase.timeline.push({
      id: `tl-${id}-${Date.now()}`,
      type: "open",
      author,
      timestamp,
      text: shouldRevokeFcr
        ? "Case reopened. FCR auto-revoked (reopened within window)."
        : "Case reopened.",
    });
    writeDatabase(db);
    return decorateDetail(existingCase);
  }
}
