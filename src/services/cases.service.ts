import { CaseRepo } from "../repos/CaseRepo";
import { CaseListQuery } from "../types/http";
import { CallDirection, CaseAttachmentSummary, CaseOrigin, CaseStatus, CaseSummary, TimelineEntry, TimelineEntryType } from "../types/models";
import { OPEN_CASE_STATUSES, OpenWorkCounts } from "./openWorkCounts";

export interface MinimalCaseForMember {
  id: string;
  caseNumber: string;
  caseType: CaseSummary["caseType"];
  status: CaseStatus;
  createdAt: string;
  agent: string;
  fcr: string | null;
}

export interface MemberAttachmentEntry extends CaseAttachmentSummary {
  caseId: string;
  caseNumber: string;
  caseStatus: CaseStatus;
}

export interface MemberInteraction {
  id: string;
  caseId: string;
  caseNumber: string;
  type: TimelineEntryType;
  direction: CallDirection | null;
  title: string;
  occurredAt: string;
  author: string | null;
  source: CaseOrigin;
  hasAttachments: boolean;
  isPhiLocked: boolean;
}

function buildInteractionTitle(entry: TimelineEntry): string {
  switch (entry.type) {
    case "note": return "Agent note";
    case "call": return entry.callDirection ? `Call — ${entry.callDirection}` : "Call";
    case "email-out": return "Outbound email";
    case "email-in": return "Inbound email";
    case "task": return "Task";
    case "status": return entry.toStatus ? `Status: ${entry.toStatus}` : "Status update";
    case "close": return "Case closed";
    case "open": return "Case opened";
    case "assignment": return "Case assigned";
    case "glip-message": return "Inbound GLIP message";
    case "glip-out": return "Outbound GLIP message";
    case "nifty-task": return "Nifty task";
    case "nifty-out": return "Outbound Nifty message";
    case "portal-message": return "Portal message";
    case "fcr-tagged": return "FCR tagged";
    default: return "Interaction";
  }
}

export class CasesService {
  constructor(private readonly caseRepo: CaseRepo) {}

  getAll() {
    return this.caseRepo.list();
  }

  async getPage(params: CaseListQuery) {
    if (this.caseRepo.listPage) {
      return this.caseRepo.listPage(params);
    }

    const items = await this.caseRepo.list();
    return {
      items,
      pageInfo: {
        nextCursor: null,
        hasNext: false,
      },
    };
  }

  async getOpenWorkCountsForMember(memberId: string): Promise<OpenWorkCounts> {
    const items = await this.getMinimalForMember(memberId, OPEN_CASE_STATUSES);
    return { openCaseCount: items.length, openClaimCount: null };
  }

  async getMinimalForMember(
    memberId: string,
    statuses?: CaseStatus[],
  ): Promise<MinimalCaseForMember[]> {
    const all = await this.caseRepo.list();
    const statusFilter = statuses && statuses.length > 0 ? new Set(statuses) : null;
    return all
      .filter((item) => item.memberId === memberId)
      .filter((item) => !statusFilter || statusFilter.has(item.status))
      .map((item) => ({
        id: item.id,
        caseNumber: item.caseNumber,
        caseType: item.caseType,
        status: item.status,
        createdAt: item.createdAt,
        agent: item.agent,
        fcr: item.fcr ?? null,
      }));
  }

  async getAttachmentsForMember(memberId: string): Promise<MemberAttachmentEntry[]> {
    const all = await this.caseRepo.list();
    const memberCases = all.filter((item) => item.memberId === memberId);
    const details = await Promise.all(
      memberCases.map((summary) => this.caseRepo.getById(summary.id)),
    );

    const out: MemberAttachmentEntry[] = [];
    for (const detail of details) {
      if (!detail) continue;
      for (const attachment of detail.attachments ?? []) {
        out.push({
          ...attachment,
          caseId: detail.id,
          caseNumber: detail.caseNumber,
          caseStatus: detail.status,
        });
      }
    }
    return out;
  }

  // Types where the author is the member (not an agent) — author is PHI pre-verify.
  // Agent-authored types (note, status, close, assignment, etc.) are excluded from this set
  // because agent names are not member PHI per the Hybrid ruling.
  private static readonly MEMBER_AUTHORED_TYPES = new Set<TimelineEntryType>([
    "portal-message",
    "glip-message",
  ]);

  async getInteractionsForMember(
    memberId: string,
    isVerified: boolean,
    limit = 50,
  ): Promise<MemberInteraction[]> {
    const all = await this.caseRepo.list();
    const memberCases = all.filter((c) => c.memberId === memberId);
    const details = await Promise.all(memberCases.map((s) => this.caseRepo.getById(s.id)));

    const rows: MemberInteraction[] = [];
    for (const detail of details) {
      if (!detail) continue;
      const hasAttachments = (detail.attachments?.length ?? 0) > 0;
      const source: CaseOrigin = detail.origin ?? "phone";
      for (const entry of detail.timeline) {
        const isMemberAuthored = CasesService.MEMBER_AUTHORED_TYPES.has(entry.type);
        rows.push({
          id: entry.id,
          caseId: detail.id,
          caseNumber: detail.caseNumber,
          type: entry.type,
          direction: entry.callDirection ?? null,
          title: buildInteractionTitle(entry),
          occurredAt: entry.timestamp,
          author: !isVerified && isMemberAuthored ? null : entry.author,
          source,
          hasAttachments,
          isPhiLocked: !isVerified,
        });
      }
    }

    rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return rows.slice(0, limit);
  }

  getById(id: string) {
    return this.caseRepo.getById(id);
  }

  getStats() {
    return this.caseRepo.countByStatus();
  }

  assignCase(id: string, agent: string, author: string) {
    return this.caseRepo.assign(id, agent, author);
  }

  addNote(id: string, text: string, author: string) {
    return this.caseRepo.addNote(id, text, author);
  }

  addTask(id: string, title: string, dueDate: string | null, author: string) {
    return this.caseRepo.addTask(id, title, dueDate, author);
  }

  addCall(
    id: string,
    summary: string,
    outcome: string | null,
    author: string,
    metadata?: {
      direction?: CallDirection | null;
      durationSeconds?: number | null;
    },
  ) {
    return this.caseRepo.addCall(id, summary, outcome, author, metadata);
  }

  updateStatus(id: string, status: CaseStatus, author: string) {
    return this.caseRepo.updateStatus(id, status, author);
  }

  addEmail(
    id: string,
    to: string,
    subject: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ) {
    return this.caseRepo.addEmail(id, to, subject, body, author, inReplyToId);
  }

  addGlipOut(
    id: string,
    channel: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ) {
    return this.caseRepo.addGlipOut(id, channel, body, author, inReplyToId);
  }

  addNiftyOut(
    id: string,
    taskRef: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ) {
    return this.caseRepo.addNiftyOut(id, taskRef, body, author, inReplyToId);
  }

  closeCase(
    id: string,
    author: string,
    payload: { fcr?: string; resolution?: string; resolutionDetails?: string },
  ) {
    return this.caseRepo.close(id, author, payload);
  }

  reopenCase(id: string, author: string) {
    return this.caseRepo.reopen(id, author);
  }

  tagFcr(
    id: string,
    fcr: "yes" | "no" | null,
    author: string,
    callSessionId?: string | null,
  ) {
    return this.caseRepo.tagFcr(id, fcr, author, callSessionId);
  }

  setFirstCallResolution(
    id: string,
    value: boolean | null,
    author: string,
    callSessionId?: string | null,
  ) {
    return this.caseRepo.setFirstCallResolution(id, value, author, callSessionId);
  }
}
