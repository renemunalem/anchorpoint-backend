import { MemberRepo } from "../MemberRepo";
import {
  BadRequestError,
  CursorPageResult,
  IntakeCandidate,
  IntakeCandidateCob,
  IntakeCandidateEligibility,
  IntakeCandidateRole,
  IntakeSearchQuery,
  MemberListQuery,
  MemberSortField,
  SortDir,
} from "../../types/http";
import { Member } from "../../types/models";
import { readDatabase } from "./jsonStore";

function buildOpenCaseCountMap(): Map<string, number> {
  const db = readDatabase();
  const counts = new Map<string, number>();
  for (const c of db.cases ?? []) {
    if (c.status !== "Closed" && c.memberId) {
      counts.set(c.memberId, (counts.get(c.memberId) ?? 0) + 1);
    }
  }
  return counts;
}

function buildLastUpdatedMap(): Map<string, string> {
  const db = readDatabase();
  const latest = new Map<string, string>();
  for (const c of db.cases ?? []) {
    if (!c.memberId) continue;
    const ts = c.updatedAt ?? c.createdAt;
    if (!ts) continue;
    const current = latest.get(c.memberId);
    if (!current || ts > current) latest.set(c.memberId, ts);
  }
  return latest;
}

function withOpenWorkCounts(member: Member, counts: Map<string, number>, lastUpdated: Map<string, string>): Member {
  return {
    ...member,
    openCaseCount: counts.get(member.id) ?? 0,
    openClaimCount: null,
    lastUpdatedAt: lastUpdated.get(member.id) ?? null,
  };
}

function cobFor(member: Member): IntakeCandidateCob {
  switch (member.cobStatus) {
    case "Yes":
      return "secondary";
    case "No":
      return "primary";
    default:
      return "none";
  }
}

function eligibilityFor(member: Member): IntakeCandidateEligibility {
  return member.memberStatus === "Terminated" ? "terminated" : "active";
}

function roleFor(member: Member): IntakeCandidateRole {
  return member.relationshipType === "Subscriber" ? "subscriber" : "dependent";
}

function digitsOnly(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function initialsOf(member: Member) {
  const first = (member.firstName ?? "").trim().charAt(0).toUpperCase();
  const last = (member.lastName ?? "").trim().charAt(0).toUpperCase();
  return `${first}${first ? "." : ""}${last}${last ? "." : ""}`.trim() || "?";
}

function dobYearOf(member: Member): number | null {
  if (!member.birthdate) return null;
  const match = /^(\d{4})/.exec(member.birthdate);
  return match ? Number.parseInt(match[1], 10) : null;
}

function subscriberLast4(member: Member): string | null {
  const digits = digitsOnly(member.subscriberMemberId);
  if (digits.length < 4) {
    return member.subscriberMemberId ? `****${member.subscriberMemberId.slice(-4)}` : null;
  }
  return `****${digits.slice(-4)}`;
}

type MemberCursorPayload = {
  subscriberMemberId: string;
  id: string;
};

type SortedMemberCursorPayload = {
  kind: "sorted";
  field: MemberSortField;
  dir: SortDir;
  value: number | string | null;
  id: string;
};

function sortMembers<T extends { subscriberMemberId: string; id: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    if (left.subscriberMemberId !== right.subscriberMemberId) {
      return left.subscriberMemberId.localeCompare(right.subscriberMemberId);
    }

    return left.id.localeCompare(right.id);
  });
}

function sortMembersBy(items: Member[], sortBy: MemberSortField, sortDir: SortDir): Member[] {
  return [...items].sort((a, b) => {
    if (sortBy === "openCaseCount") {
      const av = a.openCaseCount ?? 0;
      const bv = b.openCaseCount ?? 0;
      const cmp = av - bv;
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
    } else {
      const av = a.lastUpdatedAt ?? null;
      const bv = b.lastUpdatedAt ?? null;
      if (av === null && bv === null) {
        // fall through to id tie-breaker
      } else if (av === null) {
        return 1; // nulls last
      } else if (bv === null) {
        return -1; // nulls last
      } else {
        const cmp = av.localeCompare(bv);
        if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      }
    }
    return a.id.localeCompare(b.id);
  });
}

function isAfterSortedCursor(member: Member, cursor: SortedMemberCursorPayload): boolean {
  const { field, dir, value, id } = cursor;

  if (field === "openCaseCount") {
    const mv = member.openCaseCount ?? 0;
    const cv = (value as number | null) ?? 0;
    if (mv !== cv) return dir === "desc" ? mv < cv : mv > cv;
    return member.id > id;
  }

  // lastUpdatedAt, nulls last
  const mv = member.lastUpdatedAt ?? null;
  const cv = value as string | null;

  if (cv === null) {
    return mv === null && member.id > id;
  }
  if (mv === null) {
    return true; // null comes after all non-null (nulls last)
  }
  if (mv !== cv) return dir === "desc" ? mv < cv : mv > cv;
  return member.id > id;
}

function encodeMemberCursor(cursor: MemberCursorPayload) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeMemberCursor(cursor: string): MemberCursorPayload {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<MemberCursorPayload>;

    if (typeof decoded.subscriberMemberId !== "string" || typeof decoded.id !== "string") {
      throw new Error("invalid");
    }

    return {
      subscriberMemberId: decoded.subscriberMemberId,
      id: decoded.id,
    };
  } catch {
    throw new BadRequestError("Invalid cursor for members pagination");
  }
}

function encodeSortedMemberCursor(cursor: SortedMemberCursorPayload) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSortedMemberCursor(cursor: string): SortedMemberCursorPayload {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<SortedMemberCursorPayload>;

    if (
      decoded.kind !== "sorted"
      || (decoded.field !== "openCaseCount" && decoded.field !== "lastUpdatedAt")
      || (decoded.dir !== "asc" && decoded.dir !== "desc")
      || typeof decoded.id !== "string"
    ) {
      throw new Error("invalid");
    }

    return decoded as SortedMemberCursorPayload;
  } catch {
    throw new BadRequestError("Invalid cursor for members pagination");
  }
}

export class JsonMemberRepo implements MemberRepo {
  async list() {
    const counts = buildOpenCaseCountMap();
    const lastUpdated = buildLastUpdatedMap();
    return sortMembers(readDatabase().members.map((m) => withOpenWorkCounts(m, counts, lastUpdated)));
  }

  async listPage(params: MemberListQuery): Promise<CursorPageResult<Member>> {
    const counts = buildOpenCaseCountMap();
    const lastUpdated = buildLastUpdatedMap();
    let items = (await this.list()).map((m) => withOpenWorkCounts(m, counts, lastUpdated));

    items = items.filter((member) => {
      if (params.subscriberMemberId && member.subscriberMemberId !== params.subscriberMemberId) {
        return false;
      }
      if (params.memberId && member.id !== params.memberId) {
        return false;
      }
      if (params.q) {
        const q = params.q.toLowerCase();
        const first = (member.firstName ?? "").toLowerCase();
        const last = (member.lastName ?? "").toLowerCase();
        const fullName = `${first} ${last}`;
        if (!first.startsWith(q) && !last.startsWith(q) && !fullName.includes(q)) {
          return false;
        }
      }
      if (params.hasOpenCases && (member.openCaseCount ?? 0) === 0) {
        return false;
      }
      return true;
    });

    if (params.sortBy) {
      const sortDir = params.sortDir ?? "desc";
      items = sortMembersBy(items, params.sortBy, sortDir);

      if (params.cursor) {
        const cursor = decodeSortedMemberCursor(params.cursor);
        items = items.filter((m) => isAfterSortedCursor(m, cursor));
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
            ? encodeSortedMemberCursor({
                kind: "sorted",
                field: params.sortBy,
                dir: sortDir,
                value: params.sortBy === "openCaseCount"
                  ? (lastItem.openCaseCount ?? null)
                  : (lastItem.lastUpdatedAt ?? null),
                id: lastItem.id,
              })
            : null,
        },
      };
    }

    // Default sort: subscriber_member_id ASC, id ASC (already applied by sortMembers in list())
    if (params.cursor) {
      const cursor = decodeMemberCursor(params.cursor);
      items = items.filter((member) =>
        member.subscriberMemberId > cursor.subscriberMemberId
        || (member.subscriberMemberId === cursor.subscriberMemberId && member.id > cursor.id)
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
          ? encodeMemberCursor({
              subscriberMemberId: lastItem.subscriberMemberId,
              id: lastItem.id,
            })
          : null,
      },
    };
  }

  async getById(id: string) {
    const member = readDatabase().members.find((m) => m.id === id) ?? null;
    if (!member) return null;
    const counts = buildOpenCaseCountMap();
    const lastUpdated = buildLastUpdatedMap();
    return withOpenWorkCounts(member, counts, lastUpdated);
  }

  async searchIntakeCandidates(query: IntakeSearchQuery): Promise<IntakeCandidate[]> {
    const db = readDatabase();
    const { q, type, limit } = query;
    const trimmed = q.trim();
    if (!trimmed) return [];

    const lowered = trimmed.toLowerCase();
    const queryDigits = digitsOnly(trimmed);
    const looksNumeric = queryDigits.length >= 4 && queryDigits.length === trimmed.replace(/[\s\-().+]/g, "").length;

    const matchedMembers = db.members.filter((m) => {
      if (type === "caseId" || type === "claimId") return false;

      if (type === "phone" || (type === "auto" && looksNumeric && queryDigits.length >= 7)) {
        const memberDigits = digitsOnly(m.phoneNumber);
        return memberDigits.length > 0 && memberDigits.endsWith(queryDigits);
      }

      if (type === "memberId" || (type === "auto" && (m.id === trimmed || m.subscriberMemberId === trimmed))) {
        return (
          m.id.toLowerCase().startsWith(lowered)
          || m.subscriberMemberId.toLowerCase().startsWith(lowered)
        );
      }

      if (type === "name" || type === "auto") {
        const first = (m.firstName ?? "").toLowerCase();
        const last = (m.lastName ?? "").toLowerCase();
        const full = `${first} ${last}`;
        return (
          first.startsWith(lowered)
          || last.startsWith(lowered)
          || full.includes(lowered)
        );
      }

      return false;
    });

    const limited = matchedMembers.slice(0, limit);

    return limited.map<IntakeCandidate>((m) => {
      const memberCases = db.cases.filter((c) => c.memberId === m.id);
      const openCaseCount = memberCases.filter((c) => c.status !== "Closed").length;
      const candidateTimestamps: string[] = [];
      let attachmentCount = 0;
      for (const c of memberCases) {
        if (c.updatedAt) candidateTimestamps.push(c.updatedAt);
        if (c.createdAt) candidateTimestamps.push(c.createdAt);
        for (const entry of c.timeline ?? []) {
          if (entry.timestamp) candidateTimestamps.push(entry.timestamp);
        }
        attachmentCount += c.attachments?.length ?? c.attachmentCount ?? 0;
      }
      const lastContactDate = candidateTimestamps.length > 0
        ? candidateTimestamps.sort().at(-1) ?? null
        : null;

      return {
        memberId: m.id,
        initials: initialsOf(m),
        dobYear: dobYearOf(m),
        subscriberLast4: subscriberLast4(m),
        groupCode: m.groupNumber,
        city: m.city,
        state: m.state,
        openCaseCount,
        lastContactDate,
        cob: cobFor(m),
        planTier: null,
        eligibility: eligibilityFor(m),
        role: roleFor(m),
        attachmentCount,
      };
    });
  }
}
