import { MemberRepo } from "../repos/MemberRepo";
import { IntakeSearchQuery, MemberListQuery } from "../types/http";
import { Member } from "../types/models";

function emptyToNull(v: string | null | undefined): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

// Consistent masked display ID for list columns — last-4 with **** prefix,
// matching the BE-027 intake subscriberLast4 convention. Full id is preserved
// for navigation/API calls; displayId is for UI column rendering only.
// IDs of any length (including <=4-char stub/malformed IDs) always get the
// **** prefix so raw short IDs never appear in the display column.
function computeDisplayId(id: string): string {
  return id.length >= 4 ? `****${id.slice(-4)}` : `****${id}`;
}

// Salesforce-sourced members may carry empty-string "" for absent demographic
// fields instead of null. Normalize to null so callers get a consistent signal.
// Also sets displayId for consistent list-column rendering across all ID formats.
function normalizeMember(member: Member): Member {
  return {
    ...member,
    firstName: emptyToNull(member.firstName),
    lastName: emptyToNull(member.lastName),
    birthdate: emptyToNull(member.birthdate),
    ssn: emptyToNull(member.ssn),
    phoneNumber: emptyToNull(member.phoneNumber),
    email: emptyToNull(member.email),
    addressLine1: emptyToNull(member.addressLine1),
    city: emptyToNull(member.city),
    state: emptyToNull(member.state),
    zipCode: emptyToNull(member.zipCode),
    planName: emptyToNull(member.planName),
    planId: emptyToNull(member.planId),
    cobDetails: emptyToNull(member.cobDetails),
    niftyMemberId: emptyToNull(member.niftyMemberId),
    glipChannelId: emptyToNull(member.glipChannelId),
    network: emptyToNull(member.network),
    displayId: computeDisplayId(member.id),
    openCaseCount: member.openCaseCount ?? null,
    openClaimCount: null,
  };
}

export class MembersService {
  constructor(private readonly memberRepo: MemberRepo) {}

  async getAll() {
    const items = await this.memberRepo.list();
    return items.map(normalizeMember);
  }

  async getPage(params: MemberListQuery) {
    if (this.memberRepo.listPage) {
      const page = await this.memberRepo.listPage(params);
      return { ...page, items: page.items.map(normalizeMember) };
    }

    const items = await this.memberRepo.list();
    return {
      items: items.map(normalizeMember),
      pageInfo: {
        nextCursor: null,
        hasNext: false,
      },
    };
  }

  async getById(id: string) {
    const member = await this.memberRepo.getById(id);
    return member ? normalizeMember(member) : null;
  }

  async searchIntakeCandidates(query: IntakeSearchQuery) {
    return this.memberRepo.searchIntakeCandidates(query);
  }
}
