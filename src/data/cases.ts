import {
  CaseAttachmentSummary,
  CaseDetail,
  CaseOrigin,
  CasePriority,
  CaseSummary,
  TimelineEntry,
} from "../types/models";
import { members } from "./members";

const caseTypes = ["Eligibility", "Claims", "Prior Auth", "Appeal"] as const;
const statuses = ["Open", "Waiting", "Escalated", "Closed"] as const;
const urgencyMatrix = [
  { label: "4h", tone: "critical" as const },
  { label: "24h", tone: "warning" as const },
  { label: "48h", tone: "normal" as const },
  { label: "Same day", tone: "critical" as const },
  { label: "72h", tone: "normal" as const },
];
// 60% Normal / 30% High / 10% Urgent — closer to a realistic operational mix.
const priorities: CasePriority[] = [
  "Normal",
  "Normal",
  "Normal",
  "High",
  "Normal",
  "Normal",
  "Normal",
  "High",
  "High",
  "Urgent",
];

// Mixed origins so the demo shows every chip type at least once. Cycles
// across cases keyed by index. Keep "phone" as the dominant value to match
// real-world TPA volumes.
const origins: CaseOrigin[] = [
  "phone",
  "email",
  "phone",
  "portal",
  "phone",
  "nifty",
  "phone",
  "email",
  "phone",
  "glip",
];
const agents = [
  "Avery Stone",
  "Jordan Lee",
  "Agent One",
] as const;

function buildActionItem(
  member: (typeof members)[number],
  caseType: (typeof caseTypes)[number],
  index: number,
) {
  if (caseType === "Eligibility") {
    if (member.memberStatus === "Terminated") {
      return `Confirm termination date and ${member.planName} eligibility for ${member.firstName}.`;
    }

    return `Verify ${member.coverageTier} coverage and group ${member.groupNumber} eligibility for ${member.firstName}.`;
  }

  if (caseType === "Claims") {
    if (member.cobStatus === "Yes") {
      return `Confirm claim coordination with ${member.cobCoverageTypes.join(", ") || "secondary coverage"} for ${member.firstName}.`;
    }

    return `Review carrier adjudication status and next claims step for ${member.firstName}.`;
  }

  if (caseType === "Prior Auth") {
    return `Validate prior authorization requirements for ${member.planName} and notify ${member.relationshipType.toLowerCase()} contact.`;
  }

  if (member.cobra) {
    return `Prepare appeal summary with COBRA eligibility context for ${member.firstName}.`;
  }

  return index % 2 === 0
    ? `Prepare appeal review summary for ${member.firstName} ${member.lastName}.`
    : `Collect supporting documentation before appeal review for ${member.firstName}.`;
}

function buildTimeline(
  caseId: string,
  member: (typeof members)[number],
  caseType: (typeof caseTypes)[number],
  status: (typeof statuses)[number],
  origin: CaseOrigin,
  createdAt: Date,
  updatedAt: Date,
  index: number,
): TimelineEntry[] {
  const openedAt = createdAt.toISOString();
  const reviewAt = new Date(createdAt.getTime() + 45 * 60 * 1000).toISOString();
  const followUpAt = updatedAt.toISOString();
  const channelAt = new Date(createdAt.getTime() + 30 * 60 * 1000).toISOString();

  const entries: TimelineEntry[] = [
    {
      id: `tl-${caseId}-open`,
      type: "status",
      author: "System",
      timestamp: openedAt,
      toStatus: status,
      text: `${caseType} case opened for ${member.firstName} ${member.lastName}.`,
    },
  ];

  // Cross-channel intake — seed at least one of each new entry type so the
  // FE AwaitingBanner generalisation (FE-031) has data to drive.
  if (origin === "nifty") {
    entries.push({
      id: `tl-${caseId}-nifty`,
      type: "nifty-task",
      author: `Nifty / ${member.accountGroupName}`,
      timestamp: channelAt,
      text: `Nifty task created for ${member.firstName} ${member.lastName} (case ${caseId}).`,
    });
  } else if (origin === "glip") {
    entries.push({
      id: `tl-${caseId}-glip`,
      type: "glip-message",
      author: `${member.firstName} ${member.lastName}`,
      timestamp: channelAt,
      text: `Inbound GLIP message: please confirm next step on case ${caseId}.`,
    });
  } else if (origin === "portal") {
    entries.push({
      id: `tl-${caseId}-portal`,
      type: "portal-message",
      author: `${member.firstName} ${member.lastName}`,
      timestamp: channelAt,
      text: `Member portal message received on case ${caseId}.`,
    });
  }

  entries.push(
    {
      id: `tl-${caseId}-review`,
      type: "note",
      author: agents[index % agents.length],
      timestamp: reviewAt,
      text:
        caseType === "Claims"
          ? `Reviewed claim context for ${member.planName} and captured initial next step.`
          : `Reviewed member context and prepared follow-up guidance for ${member.firstName}.`,
    },
    {
      id: `tl-${caseId}-followup`,
      type: "note",
      author: "System",
      timestamp: followUpAt,
      text:
        status === "Closed"
          ? "Case marked resolved after final review."
          : "Case remains active and queued for next action.",
    },
  );

  return entries;
}

const ALICE_DEMO_AGENT = "Agent One";
const ALICE_DEMO_MEMBER_ID = "M1001";
const ALICE_OPEN_CASE_ID = "C-2026-0001";
const ALICE_OPEN_PORTAL_CASE_ID = "C-2026-O002";
const ALICE_FCR_YES_CASE_ID = "C-2026-A001";
const ALICE_FCR_NO_CASE_ID = "C-2026-A002";
const ALICE_FCR_YES_ELIG_CASE_ID = "C-2026-A003";
const ALICE_ESCALATED_CASE_ID = "C-2026-E001";

function embedCaseMember(member: (typeof members)[number]): CaseDetail["member"] {
  return {
    id: member.id,
    subscriberMemberId: member.subscriberMemberId,
    firstName: member.firstName,
    lastName: member.lastName,
    accountGroupName: member.accountGroupName,
    groupNumber: member.groupNumber,
    planName: member.planName,
    planId: member.planId,
    coverageTier: member.coverageTier,
    relationshipType: member.relationshipType,
    memberStatus: member.memberStatus,
    cobStatus: member.cobStatus,
  };
}

export function buildDueAt(status: string, priority: CasePriority): string | null {
  if (status === "Closed") return null;
  const now = Date.now();
  if (status === "Escalated" || priority === "Urgent") return new Date(now - 2 * 60 * 60 * 1000).toISOString();
  if (status === "Waiting" || priority === "High") return new Date(now + 20 * 60 * 60 * 1000).toISOString();
  return new Date(now + 46 * 60 * 60 * 1000).toISOString();
}

function buildAliceDemoCases(member: (typeof members)[number]): CaseDetail[] {
  const openedAt = new Date(Date.UTC(2026, 4, 1, 14, 30, 0));
  const niftyAt = new Date(openedAt.getTime() + 5 * 60 * 1000);
  const noteAt = new Date(openedAt.getTime() + 30 * 60 * 1000);
  const glipAt = new Date(openedAt.getTime() + 90 * 60 * 1000);
  const updatedOpenAt = new Date(openedAt.getTime() + 6 * 60 * 60 * 1000);

  const eobAttachment: CaseAttachmentSummary = {
    id: `att-${ALICE_OPEN_CASE_ID}-eob`,
    kind: "content-version",
    name: "EOB-2026-0001.pdf",
    title: "Explanation of Benefits",
    description: "EOB pulled from carrier portal for the 2026-04 claim cycle.",
    mimeType: "application/pdf",
    fileType: "PDF",
    sizeBytes: 184_320,
    isPrivate: false,
    createdAt: niftyAt.toISOString(),
    owner: ALICE_DEMO_AGENT,
    sourceTrace: {
      source: "salesforce",
      externalId: `demo-cv-${ALICE_OPEN_CASE_ID}`,
      object: "ContentVersion",
      attachmentKind: "content-version",
      linkKind: "case-direct",
      linkedCaseId: ALICE_OPEN_CASE_ID,
      linkedEntityId: ALICE_OPEN_CASE_ID,
      linkedEntityType: "Case",
    },
  };

  const openCase: CaseDetail = {
    id: ALICE_OPEN_CASE_ID,
    caseNumber: ALICE_OPEN_CASE_ID,
    memberId: member.id,
    memberName: `${member.firstName} ${member.lastName}`,
    caseType: "Eligibility",
    status: "Open",
    actionItem: `Confirm ${member.coverageTier} coverage and reply to ${member.firstName} on GLIP.`,
    urgency: { label: "24h", tone: "warning" },
    createdAt: openedAt.toISOString(),
    updatedAt: updatedOpenAt.toISOString(),
    agent: ALICE_DEMO_AGENT,
    groupNumber: member.groupNumber,
    claimNumber: null,
    priority: "High",
    dueAt: buildDueAt("Open", "High"),
    origin: "nifty",
    description: `Eligibility check requested via Nifty for ${member.firstName} ${member.lastName}.`,
    timeline: [
      {
        id: `tl-${ALICE_OPEN_CASE_ID}-open`,
        type: "status",
        author: "System",
        timestamp: openedAt.toISOString(),
        toStatus: "Open",
        text: `Eligibility case opened for ${member.firstName} ${member.lastName}.`,
      },
      {
        id: `tl-${ALICE_OPEN_CASE_ID}-nifty`,
        type: "nifty-task",
        author: `Nifty / ${member.accountGroupName}`,
        timestamp: niftyAt.toISOString(),
        text: `Nifty task NF-T-2026-0001 routed for ${member.firstName} ${member.lastName} (${member.niftyMemberId ?? "-"}).`,
      },
      {
        id: `tl-${ALICE_OPEN_CASE_ID}-note`,
        type: "note",
        author: ALICE_DEMO_AGENT,
        timestamp: noteAt.toISOString(),
        text: `Pulled latest EOB from carrier portal; awaiting member confirmation on GLIP channel ${member.glipChannelId ?? "-"}.`,
      },
      {
        id: `tl-${ALICE_OPEN_CASE_ID}-glip`,
        type: "glip-message",
        author: `${member.firstName} ${member.lastName}`,
        timestamp: glipAt.toISOString(),
        text: `Inbound GLIP message on ${member.glipChannelId ?? "channel"}: "Got the EOB — does this mean my visit is covered?"`,
      },
    ],
    attachments: [eobAttachment],
    member: embedCaseMember(member),
  };

  const fcrYesClosedAt = new Date(Date.UTC(2026, 3, 20, 17, 0, 0));
  const fcrYesCreatedAt = new Date(fcrYesClosedAt.getTime() - 90 * 60 * 1000);
  const fcrYesCase: CaseDetail = {
    id: ALICE_FCR_YES_CASE_ID,
    caseNumber: ALICE_FCR_YES_CASE_ID,
    memberId: member.id,
    memberName: `${member.firstName} ${member.lastName}`,
    caseType: "Claims",
    status: "Closed",
    actionItem: null,
    urgency: { label: "Closed", tone: "normal" },
    createdAt: fcrYesCreatedAt.toISOString(),
    updatedAt: fcrYesClosedAt.toISOString(),
    closedAt: fcrYesClosedAt.toISOString(),
    fcr: "yes",
    resolution: "Claim reprocessed",
    resolutionDetails:
      "Confirmed coordination of benefits with secondary carrier; member confirmed resolution on the same call.",
    agent: ALICE_DEMO_AGENT,
    groupNumber: member.groupNumber,
    claimNumber: "CLM-20260117",
    priority: "Normal",
    dueAt: null,
    origin: "phone",
    description: `Claims question resolved on first contact for ${member.firstName} ${member.lastName}.`,
    timeline: [
      {
        id: `tl-${ALICE_FCR_YES_CASE_ID}-open`,
        type: "status",
        author: "System",
        timestamp: fcrYesCreatedAt.toISOString(),
        toStatus: "Open",
        text: `Claims case opened for ${member.firstName} ${member.lastName}.`,
      },
      {
        id: `tl-${ALICE_FCR_YES_CASE_ID}-close`,
        type: "close",
        author: ALICE_DEMO_AGENT,
        timestamp: fcrYesClosedAt.toISOString(),
        text: "Case closed. Resolution: Claim reprocessed. FCR: yes.",
      },
    ],
    member: embedCaseMember(member),
  };

  const fcrNoClosedAt = new Date(Date.UTC(2026, 2, 12, 19, 30, 0));
  const fcrNoCreatedAt = new Date(fcrNoClosedAt.getTime() - 4 * 24 * 60 * 60 * 1000);
  const fcrNoCase: CaseDetail = {
    id: ALICE_FCR_NO_CASE_ID,
    caseNumber: ALICE_FCR_NO_CASE_ID,
    memberId: member.id,
    memberName: `${member.firstName} ${member.lastName}`,
    caseType: "Prior Auth",
    status: "Closed",
    actionItem: null,
    urgency: { label: "Closed", tone: "normal" },
    createdAt: fcrNoCreatedAt.toISOString(),
    updatedAt: fcrNoClosedAt.toISOString(),
    closedAt: fcrNoClosedAt.toISOString(),
    fcr: "no",
    resolution: "Auth approved after escalation",
    resolutionDetails:
      "Required two follow-up calls and a clinical review before the prior authorization was approved.",
    agent: ALICE_DEMO_AGENT,
    groupNumber: member.groupNumber,
    claimNumber: null,
    priority: "High",
    dueAt: null,
    origin: "phone",
    description: `Prior auth resolved after escalation for ${member.firstName} ${member.lastName}.`,
    timeline: [
      {
        id: `tl-${ALICE_FCR_NO_CASE_ID}-open`,
        type: "status",
        author: "System",
        timestamp: fcrNoCreatedAt.toISOString(),
        toStatus: "Open",
        text: `Prior Auth case opened for ${member.firstName} ${member.lastName}.`,
      },
      {
        id: `tl-${ALICE_FCR_NO_CASE_ID}-close`,
        type: "close",
        author: ALICE_DEMO_AGENT,
        timestamp: fcrNoClosedAt.toISOString(),
        text: "Case closed. Resolution: Auth approved after escalation. FCR: no.",
      },
    ],
    member: embedCaseMember(member),
  };

  const portalOpenedAt = new Date(Date.UTC(2026, 4, 3, 9, 15, 0));
  const portalMessageAt = new Date(portalOpenedAt.getTime() + 12 * 60 * 1000);
  const portalNoteAt = new Date(portalOpenedAt.getTime() + 75 * 60 * 1000);
  const portalUpdatedAt = new Date(portalOpenedAt.getTime() + 4 * 60 * 60 * 1000);

  const portalDenialAttachment: CaseAttachmentSummary = {
    id: `att-${ALICE_OPEN_PORTAL_CASE_ID}-denial`,
    kind: "content-version",
    name: "Denial-Letter-2026-0405.pdf",
    title: "Denial Letter",
    description: "Carrier denial letter uploaded by member through the portal.",
    mimeType: "application/pdf",
    fileType: "PDF",
    sizeBytes: 92_416,
    isPrivate: false,
    createdAt: portalMessageAt.toISOString(),
    owner: `${member.firstName} ${member.lastName}`,
    sourceTrace: {
      source: "salesforce",
      externalId: `demo-cv-${ALICE_OPEN_PORTAL_CASE_ID}`,
      object: "ContentVersion",
      attachmentKind: "content-version",
      linkKind: "case-direct",
      linkedCaseId: ALICE_OPEN_PORTAL_CASE_ID,
      linkedEntityId: ALICE_OPEN_PORTAL_CASE_ID,
      linkedEntityType: "Case",
    },
  };

  const portalOpenCase: CaseDetail = {
    id: ALICE_OPEN_PORTAL_CASE_ID,
    caseNumber: ALICE_OPEN_PORTAL_CASE_ID,
    memberId: member.id,
    memberName: `${member.firstName} ${member.lastName}`,
    caseType: "Claims",
    status: "Open",
    actionItem: `Review denial letter uploaded via portal and confirm next step with ${member.firstName}.`,
    urgency: { label: "48h", tone: "normal" },
    createdAt: portalOpenedAt.toISOString(),
    updatedAt: portalUpdatedAt.toISOString(),
    agent: ALICE_DEMO_AGENT,
    groupNumber: member.groupNumber,
    claimNumber: "CLM-20260405",
    priority: "Normal",
    dueAt: buildDueAt("Open", "Normal"),
    origin: "portal",
    description: `Member uploaded a denial letter via the member portal asking for an appeal review.`,
    timeline: [
      {
        id: `tl-${ALICE_OPEN_PORTAL_CASE_ID}-open`,
        type: "status",
        author: "System",
        timestamp: portalOpenedAt.toISOString(),
        toStatus: "Open",
        text: `Claims case opened from portal upload for ${member.firstName} ${member.lastName}.`,
      },
      {
        id: `tl-${ALICE_OPEN_PORTAL_CASE_ID}-portal`,
        type: "portal-message",
        author: `${member.firstName} ${member.lastName}`,
        timestamp: portalMessageAt.toISOString(),
        text: `Inbound portal message: "Attached the denial letter — please tell me what's next for the appeal."`,
      },
      {
        id: `tl-${ALICE_OPEN_PORTAL_CASE_ID}-note`,
        type: "note",
        author: ALICE_DEMO_AGENT,
        timestamp: portalNoteAt.toISOString(),
        text: `Logged denial letter; preparing appeal packet.`,
      },
    ],
    attachments: [portalDenialAttachment],
    member: embedCaseMember(member),
  };

  const fcrYesElEligClosedAt = new Date(Date.UTC(2026, 1, 18, 16, 45, 0));
  const fcrYesElEligCreatedAt = new Date(fcrYesElEligClosedAt.getTime() - 70 * 60 * 1000);
  const fcrYesEligEobAttachment: CaseAttachmentSummary = {
    id: `att-${ALICE_FCR_YES_ELIG_CASE_ID}-eob`,
    kind: "content-version",
    name: "Eligibility-Confirmation-2026-0218.pdf",
    title: "Eligibility Confirmation",
    description: "Carrier eligibility confirmation shared with member during the resolution call.",
    mimeType: "application/pdf",
    fileType: "PDF",
    sizeBytes: 73_088,
    isPrivate: false,
    createdAt: fcrYesElEligClosedAt.toISOString(),
    owner: ALICE_DEMO_AGENT,
    sourceTrace: {
      source: "salesforce",
      externalId: `demo-cv-${ALICE_FCR_YES_ELIG_CASE_ID}`,
      object: "ContentVersion",
      attachmentKind: "content-version",
      linkKind: "case-direct",
      linkedCaseId: ALICE_FCR_YES_ELIG_CASE_ID,
      linkedEntityId: ALICE_FCR_YES_ELIG_CASE_ID,
      linkedEntityType: "Case",
    },
  };

  const fcrYesEligCase: CaseDetail = {
    id: ALICE_FCR_YES_ELIG_CASE_ID,
    caseNumber: ALICE_FCR_YES_ELIG_CASE_ID,
    memberId: member.id,
    memberName: `${member.firstName} ${member.lastName}`,
    caseType: "Eligibility",
    status: "Closed",
    actionItem: null,
    urgency: { label: "Closed", tone: "normal" },
    createdAt: fcrYesElEligCreatedAt.toISOString(),
    updatedAt: fcrYesElEligClosedAt.toISOString(),
    closedAt: fcrYesElEligClosedAt.toISOString(),
    fcr: "yes",
    resolution: "Eligibility confirmed",
    resolutionDetails:
      "Carrier eligibility confirmed for the active plan; PDF shared with member during the same call.",
    agent: ALICE_DEMO_AGENT,
    groupNumber: member.groupNumber,
    claimNumber: null,
    priority: "Normal",
    dueAt: null,
    origin: "phone",
    description: `Eligibility confirmation resolved on first contact for ${member.firstName} ${member.lastName}.`,
    timeline: [
      {
        id: `tl-${ALICE_FCR_YES_ELIG_CASE_ID}-open`,
        type: "status",
        author: "System",
        timestamp: fcrYesElEligCreatedAt.toISOString(),
        toStatus: "Open",
        text: `Eligibility case opened for ${member.firstName} ${member.lastName}.`,
      },
      {
        id: `tl-${ALICE_FCR_YES_ELIG_CASE_ID}-close`,
        type: "close",
        author: ALICE_DEMO_AGENT,
        timestamp: fcrYesElEligClosedAt.toISOString(),
        text: "Case closed. Resolution: Eligibility confirmed. FCR: yes.",
      },
    ],
    attachments: [fcrYesEligEobAttachment],
    member: embedCaseMember(member),
  };

  const escalatedOpenedAt = new Date(Date.UTC(2026, 4, 10, 11, 0, 0));
  const escalatedEscalatedAt = new Date(escalatedOpenedAt.getTime() + 2 * 24 * 60 * 60 * 1000);
  const escalatedUpdatedAt = new Date(escalatedEscalatedAt.getTime() + 30 * 60 * 1000);

  const escalatedCase: CaseDetail = {
    id: ALICE_ESCALATED_CASE_ID,
    caseNumber: ALICE_ESCALATED_CASE_ID,
    memberId: member.id,
    memberName: `${member.firstName} ${member.lastName}`,
    caseType: "Appeal",
    status: "Escalated",
    actionItem: `Urgent: COB dispute unresolved — carrier denial requires supervisor review for ${member.firstName}.`,
    urgency: { label: "Overdue", tone: "critical" },
    createdAt: escalatedOpenedAt.toISOString(),
    updatedAt: escalatedUpdatedAt.toISOString(),
    agent: ALICE_DEMO_AGENT,
    groupNumber: member.groupNumber,
    claimNumber: "CLM-20260510",
    priority: "Urgent",
    dueAt: buildDueAt("Escalated", "Urgent"),
    origin: "phone",
    description: `COB dispute escalated for ${member.firstName} ${member.lastName} — secondary carrier denying claim; supervisor review required.`,
    timeline: [
      {
        id: `tl-${ALICE_ESCALATED_CASE_ID}-open`,
        type: "status",
        author: "System",
        timestamp: escalatedOpenedAt.toISOString(),
        toStatus: "Open",
        text: `Benefits case opened for ${member.firstName} ${member.lastName} — COB dispute on CLM-20260510.`,
      },
      {
        id: `tl-${ALICE_ESCALATED_CASE_ID}-note`,
        type: "note",
        author: ALICE_DEMO_AGENT,
        timestamp: new Date(escalatedOpenedAt.getTime() + 45 * 60 * 1000).toISOString(),
        text: `Called secondary carrier — denial stands pending clinical review. Escalating to supervisor.`,
      },
      {
        id: `tl-${ALICE_ESCALATED_CASE_ID}-escalate`,
        type: "status",
        author: ALICE_DEMO_AGENT,
        timestamp: escalatedEscalatedAt.toISOString(),
        toStatus: "Escalated",
        text: `Escalated: secondary carrier denial unresolved after two follow-up calls. Supervisor intervention required.`,
      },
    ],
    member: embedCaseMember(member),
  };

  return [openCase, portalOpenCase, fcrYesCase, fcrNoCase, fcrYesEligCase, escalatedCase];
}

const generatedCases: CaseDetail[] = members.map((member, index) => {
  const caseType = caseTypes[index % caseTypes.length];
  const status = statuses[index % statuses.length];
  const createdAt = new Date(Date.UTC(2026, 3, 19 - index, 14 + (index % 5), (index * 7) % 60, 0));
  const updatedAt = new Date(createdAt.getTime() + ((index % 4) + 1) * 60 * 60 * 1000);
  const priority = priorities[index % priorities.length];
  const caseNumber = `C-2026-${String(index + 1).padStart(4, "0")}`;
  const caseId = caseNumber;

  return {
    id: caseId,
    caseNumber,
    memberId: member.id,
    memberName: `${member.firstName} ${member.lastName}`,
    caseType,
    status,
    actionItem: buildActionItem(member, caseType, index),
    urgency: urgencyMatrix[index % urgencyMatrix.length],
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    agent: agents[index % agents.length],
    groupNumber: member.groupNumber,
    claimNumber: caseType === "Claims" ? `CLM-${20260000 + index + 1}` : "",
    priority,
    dueAt: buildDueAt(status, priority),
    origin: origins[index % origins.length],
    description: `${caseType} case opened for ${member.firstName} ${member.lastName} under ${member.planName}.`,
    timeline: buildTimeline(
      caseId,
      member,
      caseType,
      status,
      origins[index % origins.length],
      createdAt,
      updatedAt,
      index,
    ),
    member: {
      id: member.id,
      subscriberMemberId: member.subscriberMemberId,
      firstName: member.firstName,
      lastName: member.lastName,
      accountGroupName: member.accountGroupName,
      groupNumber: member.groupNumber,
      planName: member.planName,
      planId: member.planId,
      coverageTier: member.coverageTier,
      relationshipType: member.relationshipType,
      memberStatus: member.memberStatus,
      cobStatus: member.cobStatus,
    },
  };
});

// BE-072: Extra open cases for two non-Alice members so the amber badge (3+ open) is
// visible in JSON/fake-backend mode without relying solely on Alice's demo persona.
// M1005 = Sophia Rivera (index 4), M1010 = Mason Wilson (index 9).
function buildVarietyCases(memberId: string, memberName: string, groupNumber: string, planName: string | null): CaseDetail[] {
  const base = new Date(Date.UTC(2026, 3, 10, 9, 0, 0));
  return [
    {
      id: `C-VAR-${memberId}-001`,
      caseNumber: `C-VAR-${memberId}-001`,
      memberId,
      memberName,
      caseType: "Claims",
      status: "Waiting",
      actionItem: `Awaiting carrier response on claims adjudication for ${memberName.split(" ")[0]}.`,
      urgency: { label: "24h", tone: "warning" as const },
      createdAt: new Date(base.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(base.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      agent: "Jordan Blake",
      groupNumber,
      claimNumber: `CLM-VAR-${memberId}-1`,
      priority: "High" as CasePriority,
      dueAt: buildDueAt("Waiting", "High"),
      origin: "phone" as CaseOrigin,
      description: `Claims review for ${memberName} under ${planName ?? "group plan"}.`,
      timeline: [{
        id: `tl-C-VAR-${memberId}-001-open`,
        type: "status",
        author: "System",
        timestamp: new Date(base.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        toStatus: "Waiting",
        text: `Claims case opened for ${memberName}.`,
      }],
    },
    {
      id: `C-VAR-${memberId}-002`,
      caseNumber: `C-VAR-${memberId}-002`,
      memberId,
      memberName,
      caseType: "Prior Auth",
      status: "Open",
      actionItem: `Prior auth request pending review for ${memberName.split(" ")[0]}.`,
      urgency: { label: "48h", tone: "normal" as const },
      createdAt: new Date(base.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: base.toISOString(),
      agent: "Jordan Blake",
      groupNumber,
      claimNumber: null,
      priority: "Normal" as CasePriority,
      dueAt: buildDueAt("Open", "Normal"),
      origin: "portal" as CaseOrigin,
      description: `Prior auth required for ${memberName} under ${planName ?? "group plan"}.`,
      timeline: [{
        id: `tl-C-VAR-${memberId}-002-open`,
        type: "status",
        author: "System",
        timestamp: new Date(base.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        toStatus: "Open",
        text: `Prior auth case opened for ${memberName}.`,
      }],
    },
  ];
}

const aliceMember = members.find((m) => m.id === ALICE_DEMO_MEMBER_ID);
const aliceDemoCases = aliceMember ? buildAliceDemoCases(aliceMember) : [];
const aliceDemoIds = new Set(aliceDemoCases.map((c) => c.id));

const sophiaMember = members.find((m) => m.id === "M1005");
const sophiaVarietyCases = sophiaMember
  ? buildVarietyCases("M1005", `${sophiaMember.firstName} ${sophiaMember.lastName}`, sophiaMember.groupNumber, sophiaMember.planName ?? null)
  : [];

const masonMember = members.find((m) => m.id === "M1010");
const masonVarietyCases = masonMember
  ? buildVarietyCases("M1010", `${masonMember.firstName} ${masonMember.lastName}`, masonMember.groupNumber, masonMember.planName ?? null)
  : [];

const varietyIds = new Set([...sophiaVarietyCases, ...masonVarietyCases].map((c) => c.id));

export const cases: CaseDetail[] = [
  ...aliceDemoCases,
  ...sophiaVarietyCases,
  ...masonVarietyCases,
  ...generatedCases.filter(
    (c) => c.memberId !== ALICE_DEMO_MEMBER_ID && !aliceDemoIds.has(c.id) && !varietyIds.has(c.id),
  ),
];

export const caseSummaries: CaseSummary[] = cases;
