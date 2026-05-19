import { CaseListQuery, CaseStatusCounts, CursorPageResult } from "../types/http";
import { CallDirection, CaseDetail, CaseStatus, CaseSummary } from "../types/models";

export interface CaseRepo {
  list(): Promise<CaseSummary[]>;
  listPage?(params: CaseListQuery): Promise<CursorPageResult<CaseSummary>>;
  countByStatus(): Promise<CaseStatusCounts>;
  getById(id: string): Promise<CaseDetail | null>;
  assign(id: string, agent: string, author: string): Promise<CaseDetail | null>;
  addNote(id: string, text: string, author: string): Promise<CaseDetail | null>;
  addTask(
    id: string,
    title: string,
    dueDate: string | null,
    author: string,
  ): Promise<CaseDetail | null>;
  addCall(
    id: string,
    summary: string,
    outcome: string | null,
    author: string,
    metadata?: {
      direction?: CallDirection | null;
      durationSeconds?: number | null;
    },
  ): Promise<CaseDetail | null>;
  updateStatus(id: string, status: CaseStatus, author: string): Promise<CaseDetail | null>;
  addEmail(
    id: string,
    to: string,
    subject: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null>;
  addGlipOut(
    id: string,
    channel: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null>;
  addNiftyOut(
    id: string,
    taskRef: string,
    body: string,
    author: string,
    inReplyToId?: string | null,
  ): Promise<CaseDetail | null>;
  close(
    id: string,
    author: string,
    payload: { fcr?: string; resolution?: string; resolutionDetails?: string },
  ): Promise<CaseDetail | null>;
  reopen(id: string, author: string): Promise<CaseDetail | null>;
  tagFcr(
    id: string,
    fcr: "yes" | "no" | null,
    author: string,
    callSessionId?: string | null,
  ): Promise<CaseDetail | null>;
  setFirstCallResolution(
    id: string,
    value: boolean | null,
    author: string,
    callSessionId?: string | null,
  ): Promise<CaseDetail | null>;
}
