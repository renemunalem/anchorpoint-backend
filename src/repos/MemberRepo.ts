import { CursorPageResult, IntakeCandidate, IntakeSearchQuery, MemberListQuery } from "../types/http";
import { Member } from "../types/models";

export interface MemberRepo {
  list(): Promise<Member[]>;
  listPage?(params: MemberListQuery): Promise<CursorPageResult<Member>>;
  getById(id: string): Promise<Member | null>;
  searchIntakeCandidates(query: IntakeSearchQuery): Promise<IntakeCandidate[]>;
}
