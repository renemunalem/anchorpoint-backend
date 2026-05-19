import { Member } from "../types/models";

const names = [
  // M1001 — curated demo persona for BE-018 / "Alice Johnson" end-to-end flow.
  ["Alice", "Johnson"],
  ["James", "Patel"],
  ["Olivia", "Chen"],
  ["Liam", "Johnson"],
  ["Sophia", "Rivera"],
  ["Noah", "Turner"],
  ["Emma", "Nguyen"],
  ["Elijah", "Brown"],
  ["Ava", "Martinez"],
  ["Mason", "Wilson"],
  ["Isabella", "Davis"],
  ["Lucas", "Anderson"],
  ["Mia", "Clark"],
  ["Ethan", "Lewis"],
  ["Charlotte", "Walker"],
  ["Benjamin", "Hall"],
  ["Amelia", "Allen"],
  ["Henry", "Young"],
  ["Harper", "King"],
  ["Alexander", "Wright"],
] as const;

const groups = [
  { accountGroupName: "Northwind Manufacturing", groupNumber: "GRP-2001", planName: "PPO Plus", planId: "PLN-7781" },
  { accountGroupName: "Summit Logistics", groupNumber: "GRP-2002", planName: "HMO Choice", planId: "PLN-5520" },
  { accountGroupName: "Blue Harbor Health", groupNumber: "GRP-2003", planName: "HDHP Saver", planId: "PLN-8844" },
  { accountGroupName: "Cedar Retail Group", groupNumber: "GRP-2004", planName: "EPO Select", planId: "PLN-6612" },
];

const coverageTiers = ["Single", "Family", "Employee + Spouse", "Employee + Children"] as const;
const relationships = ["Subscriber", "Spouse", "Child", "Other"] as const;
const cobStatuses = ["No", "Yes", "Unknown"] as const;
const cities = [
  { city: "Phoenix", state: "AZ", zipCode: "85016" },
  { city: "San Diego", state: "CA", zipCode: "92108" },
  { city: "Denver", state: "CO", zipCode: "80203" },
  { city: "Las Vegas", state: "NV", zipCode: "89117" },
  { city: "Austin", state: "TX", zipCode: "78731" },
  { city: "Mesa", state: "AZ", zipCode: "85204" },
  { city: "Sacramento", state: "CA", zipCode: "95814" },
  { city: "Fort Collins", state: "CO", zipCode: "80525" },
  { city: "Henderson", state: "NV", zipCode: "89052" },
  { city: "Plano", state: "TX", zipCode: "75024" },
  { city: "Tempe", state: "AZ", zipCode: "85282" },
  { city: "Irvine", state: "CA", zipCode: "92618" },
  { city: "Boulder", state: "CO", zipCode: "80302" },
  { city: "Reno", state: "NV", zipCode: "89509" },
  { city: "Round Rock", state: "TX", zipCode: "78681" },
  { city: "Scottsdale", state: "AZ", zipCode: "85258" },
  { city: "Oakland", state: "CA", zipCode: "94612" },
  { city: "Colorado Springs", state: "CO", zipCode: "80918" },
  { city: "Summerlin", state: "NV", zipCode: "89135" },
  { city: "Frisco", state: "TX", zipCode: "75034" },
] as const;

const addresses = [
  "201 Market Street",
  "58 Juniper Lane",
  "1408 Skyline Drive",
  "925 Desert Bloom Way",
  "410 Lakeview Terrace",
  "782 Canyon Road",
  "111 Harbor Point",
  "239 Aspen Court",
  "640 Copper Ridge",
  "75 Walnut Street",
  "1880 Sunrise Avenue",
  "333 Orchard Park",
  "519 Willow Bend",
  "87 Red Rock Trail",
  "1220 Elm Grove Road",
  "460 Camino Verde",
  "905 Highland Avenue",
  "214 Silver Mesa",
  "16 Ridgecrest Court",
  "730 Maple Hollow",
] as const;

const emailDomains = [
  "northwindbenefits.com",
  "summitcare.net",
  "membermail.io",
  "blueharborhealth.org",
  "cedarretailbenefits.com",
] as const;

const cobCoverageCatalog = [
  ["Medicare Advantage"],
  ["Spouse Employer Plan"],
  ["VA Benefits"],
  ["Marketplace Plan"],
  ["Retiree Coverage", "Dental Rider"],
] as const;

// BE-072: Members with intentionally incomplete profiles for demo variety (profile
// completeness story and "(not on file)" masking in FE-177). These IDs are chosen
// because they map to members with Closed cases (openCaseCount=0), so incomplete
// profile + no open work is a realistic low-activity member archetype.
const INCOMPLETE_PROFILE_IDS = new Set(["M1004", "M1008", "M1012", "M1016"]);

export const members: Member[] = names.map(([firstName, lastName], index) => {
  const n = index + 1;
  const memberNumeric = 1000 + n;
  const memberId = `M${memberNumeric}`;
  const displayMemberId = memberId;
  const group = groups[index % groups.length];
  const cobStatus = cobStatuses[index % cobStatuses.length];
  const relationshipType = relationships[index % relationships.length];
  const location = cities[index % cities.length];
  const emailDomain = emailDomains[index % emailDomains.length];
  const effectiveMonth = String((index % 9) + 1).padStart(2, "0");
  const effectiveDay = String(((index * 3) % 20) + 1).padStart(2, "0");
  const reportedDay = String((n % 18) + 1).padStart(2, "0");
  const subscriberBirthYear = 1980 + (index % 12);
  const cobra = index % 5 === 0;
  const memberStatus = index % 7 === 0 ? "Terminated" : "Active";
  const cobCoverageTypes =
    cobStatus === "Yes" ? [...cobCoverageCatalog[index % cobCoverageCatalog.length]] : [];
  const cobDetails =
    cobStatus === "Yes"
      ? `${cobCoverageTypes.join(" + ")} reported during coordination of benefits screening.`
      : cobStatus === "Unknown"
        ? "Member was unsure whether secondary medical or pharmacy coverage remains active."
        : "No other coverage reported.";

  const isIncomplete = INCOMPLETE_PROFILE_IDS.has(memberId);

  return {
    id: memberId,
    subscriberMemberId: displayMemberId,
    firstName,
    lastName,
    birthdate: isIncomplete ? null : `${subscriberBirthYear}-${effectiveMonth}-${String(((index * 2) % 27) + 1).padStart(2, "0")}`,
    ssn: isIncomplete ? null : String(3200 + n).padStart(4, "0"),
    phoneNumber: isIncomplete ? null : `(555) ${String(200 + n).padStart(3, "0")}-${String(1300 + n * 17).slice(-4)}`,
    email: isIncomplete ? null : `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${emailDomain}`,
    addressLine1: isIncomplete ? null : addresses[index % addresses.length],
    city: isIncomplete ? null : location.city,
    state: isIncomplete ? null : location.state,
    zipCode: isIncomplete ? null : location.zipCode,
    accountGroupName: group.accountGroupName,
    groupNumber: group.groupNumber,
    planName: group.planName,
    planId: group.planId,
    cobra,
    coverageEffectiveDate: `2026-${effectiveMonth}-${effectiveDay}`,
    coverageTermDate:
      memberStatus === "Terminated"
        ? `2026-${String(((index + 4) % 12) + 1).padStart(2, "0")}-28`
        : `2027-${effectiveMonth}-31`,
    coverageTier: coverageTiers[index % coverageTiers.length],
    relationshipType,
    memberStatus,
    cobStatus,
    cobCoverageTypes,
    cobDetails,
    cobReportedAt: `2026-04-${reportedDay}T14:15:00.000Z`,
    niftyMemberId: memberId === "M1001" ? "NF-1001" : null,
    glipChannelId: memberId === "M1001" ? "glip-team-cochran" : null,
    network: memberId === "M1001" ? "HMO" : null,
  };
});
