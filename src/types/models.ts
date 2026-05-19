export type CaseType = "Eligibility" | "Claims" | "Prior Auth" | "Appeal";
export type CaseStatus = "Open" | "Waiting" | "Escalated" | "Closed";
export type UrgencyTone = "critical" | "warning" | "normal";
export type CasePriority = "Normal" | "High" | "Urgent";
export type CoverageTier =
  | "Single"
  | "Family"
  | "Employee + Spouse"
  | "Employee + Children";
export type RelationshipType = "Subscriber" | "Spouse" | "Child" | "Other";
export type MemberStatus = "Active" | "Terminated";
export type ExternalSource = "salesforce";
export type CallDirection = "Inbound" | "Outbound";
export type CaseOrigin = "nifty" | "glip" | "portal" | "phone" | "email";
export type TimelineEntryType =
  | "note"
  | "task"
  | "status"
  | "email-out"
  | "email-in"
  | "call"
  | "close"
  | "open"
  | "assignment"
  | "nifty-task"
  | "nifty-out"
  | "glip-message"
  | "glip-out"
  | "portal-message"
  | "fcr-tagged";
export type SalesforceTimelineObject =
  | "Case"
  | "CaseHistory2"
  | "EmailMessage"
  | "Task"
  | "FeedPost";
export type CaseAttachmentKind = "legacy-attachment" | "content-version";
export type CaseAttachmentLinkKind = "case-direct" | "related-record";
export type SalesforceAttachmentObject =
  | "Attachment"
  | "ContentDocumentLink"
  | "ContentVersion";
export type SalesforceAttachmentLinkedObject =
  | "Case"
  | "EmailMessage"
  | "FeedPost"
  | "Task"
  | "Unknown";

export interface SourceTrace {
  source: ExternalSource;
  externalId: string;
}

export interface SalesforceCaseTrace extends SourceTrace {
  contactId?: string;
  accountId?: string;
  ownerId?: string;
  memberExternalId?: string;
}

export interface SalesforceMemberTrace extends SourceTrace {
  accountId?: string;
}

export interface SalesforceUserTrace extends SourceTrace {
  alias?: string;
  userType?: string;
}

export interface TimelineSourceTrace extends SourceTrace {
  object: SalesforceTimelineObject;
  parentId?: string;
  relatedToId?: string;
}

export interface SalesforceAttachmentTrace extends SourceTrace {
  object: SalesforceAttachmentObject;
  attachmentKind: CaseAttachmentKind;
  linkKind: CaseAttachmentLinkKind;
  linkedCaseId?: string;
  linkedEntityId?: string;
  linkedEntityType?: SalesforceAttachmentLinkedObject;
  attachmentId?: string;
  contentDocumentLinkId?: string;
  contentDocumentId?: string;
  contentVersionId?: string;
  parentId?: string;
}

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "Agent" | "Admin";
  status: "Active" | "Inactive";
  lastLogin?: string;
  photo?: string;
  sourceTrace?: SalesforceUserTrace;
}

export interface SeedUser extends SessionUser {
  password: string;
}

export interface CaseSummary {
  id: string;
  caseNumber: string;
  memberId: string;
  memberName: string | null;
  caseType: CaseType;
  status: CaseStatus;
  actionItem: string | null;
  urgency: {
    label: string;
    tone: UrgencyTone;
  };
  createdAt: string;
  updatedAt: string;
  agent: string;
  groupNumber: string;
  claimNumber: string | null;
  priority: CasePriority;
  description?: string | null;
  closedAt?: string;
  fcr?: string | null;
  firstCallResolution?: boolean | null;
  resolution?: string | null;
  resolutionDetails?: string | null;
  origin?: CaseOrigin;
  attachmentCount?: number;
  dueAt: string | null;
  sourceTrace?: SalesforceCaseTrace;
  // Per-row call-session accessibility flag (populated when x-call-session-id header present).
  // null = no active call session; true = session verified for this row's member;
  // false = session exists but not verified for this member (FE-161 can show lock icon).
  sessionAccessible?: boolean | null;
}

export interface TimelineEntry {
  id: string;
  type: TimelineEntryType;
  author: string;
  timestamp: string;
  inReplyToId?: string;
  callDirection?: CallDirection;
  callDurationSeconds?: number;
  taskDueDate?: string;
  text?: string | null;
  toStatus?: CaseStatus;
  subject?: string | null;
  from?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  sourceTrace?: TimelineSourceTrace;
}

export interface CaseAttachmentSummary {
  id: string;
  kind: CaseAttachmentKind;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  fileType?: string;
  sizeBytes?: number;
  isPrivate?: boolean;
  createdAt?: string;
  owner?: string;
  exportRelativePath?: string;
  sourceTrace: SalesforceAttachmentTrace;
}

export interface CaseDetail extends CaseSummary {
  timeline: TimelineEntry[];
  attachments?: CaseAttachmentSummary[];
  callerType?: string | null;
  callerName?: string | null;
  callerContact?: string | null;
  amountBilled?: string | null;
  dateOfService?: string | null;
  claimStatus?: string | null;
  closedCaseNotes?: string | null;
  followUpDate?: string | null;
  member?: Pick<
    Member,
    | "id"
    | "subscriberMemberId"
    | "firstName"
    | "lastName"
    | "accountGroupName"
    | "groupNumber"
    | "planName"
    | "planId"
    | "coverageTier"
    | "relationshipType"
    | "memberStatus"
    | "cobStatus"
  >;
}

export interface Member {
  id: string;
  subscriberMemberId: string;
  firstName: string | null;
  lastName: string | null;
  birthdate: string | null;
  ssn: string | null;
  phoneNumber: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  accountGroupName: string;
  groupNumber: string;
  planName: string | null;
  planId: string | null;
  cobra: boolean;
  coverageEffectiveDate: string;
  coverageTermDate: string;
  coverageTier: CoverageTier;
  relationshipType: RelationshipType;
  memberStatus: MemberStatus;
  cobStatus: "Yes" | "No" | "Unknown";
  cobCoverageTypes: string[];
  cobDetails: string | null;
  cobReportedAt: string;
  niftyMemberId?: string | null;
  glipChannelId?: string | null;
  network?: string | null;
  sourceTrace?: SalesforceMemberTrace;
  hasSsnOnFile?: boolean;
  displayId?: string;
  openCaseCount?: number | null;
  openClaimCount?: null;
  lastUpdatedAt?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
  keepMeLoggedIn?: boolean;
  rememberMe?: boolean;
  persistSession?: boolean;
}

export interface PasswordResetRequest {
  email: string;
}

export type CallSessionStatus =
  | "unverified"
  | "verified"
  | "refused"
  | "no-member";

export interface CallSessionVerificationStamp {
  verifiedAtMs: number;
  method: string;
}

export interface CallSession {
  id: string;
  agentId: string;
  callerPhone: string | null;
  memberId: string | null;
  status: CallSessionStatus;
  startedAt: string;
  endedAt: string | null;
  lockedAt: string | null;
  verifiedMemberIds?: Record<string, CallSessionVerificationStamp>;
}

export interface DatabaseState {
  users: SeedUser[];
  members: Member[];
  cases: CaseDetail[];
  rbacPermissions: Array<{
    id: string;
    role: string;
    permissions: Record<string, boolean>;
  }>;
  callSessions?: CallSession[];
}
