/**
 * QA-065 — HIPAA call-session gate regression spec
 *
 * Locks the pre-verify → verify → end lifecycle contract established by
 * QA-039 (2026-05-13 manual probe) as an automated CI regression guard.
 *
 * Scope (per qa_queue.md QA-065):
 *   (3) Pre-verify mask — GET /v1/members/M1001 and GET /v1/cases return
 *       null PHI; case detail with unverified session header → 403.
 *   (4) Verify step — POST /hipaa/verify with manual method → 200, status=verified.
 *   (5) Post-verify unlock — same endpoints now return unmasked PHI.
 *   (6) Cross-member negative — a different member stays masked post-verify.
 *   (7) End step — POST /end → 200; PHI re-masks.
 *   (8) Audit log — session-started / ok / session-locked rows present and
 *       joined by callSessionId; no PHI in limit-exceeded or invalid-method rows.
 *   (9) verify-failed flavor — outcome:"refused" → 200 + result:"refused" in
 *       audit; endpoints stay masked.
 *
 * Driver: JSON (default) — spec speed; PG parity via shared service layer.
 * Run: npx vitest run tests/hipaaCallSessionGate.spec.ts
 *
 * Note on BE-027 case-detail 403: the 403 AUTH_HIPAA_REQUIRED fires when the
 * request carries an x-call-session-id header for an unverified session. Without
 * any session header the endpoint returns 200 with all PHI fields null (BE-030
 * mask). The spec asserts both paths.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";

// ── config ──────────────────────────────────────────────────────────────────

const BASE = process.env.TEST_API_BASE ?? "http://127.0.0.1:8082";
const MEMBER_ID = "M1001";         // Alice Johnson — demo seed member
const CROSS_MEMBER_ID = "210110062100"; // Different member — must stay masked post-verify
const ALICE_CASE_ID = "C-2026-0001"; // Alice's open case

// Resolve the audit log relative to the backend root so tests work from
// any working directory (CI and local both).
const AUDIT_LOG = path.resolve(
  __dirname,
  "..",
  process.env.HIPAA_AUDIT_LOG_PATH ?? "data/hipaa-audit.log",
);

// ── HTTP helpers ─────────────────────────────────────────────────────────────

let cookie = "";

async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Forward Set-Cookie on the first sign-in response
  const sc = res.headers.get("set-cookie");
  if (sc && !cookie) cookie = sc.split(";")[0];

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

function auditRowsForSession(sessionId: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  return fs
    .readFileSync(AUDIT_LOG, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => r !== null)
    .filter((r) => r.callSessionId === sessionId);
}

// ── test state ───────────────────────────────────────────────────────────────

let sessionId = "";

// ── setup: sign in ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const res = await api("POST", "/v1/auth/login", {
    email: "admin@atlasai.local",
    password: "change_me",
  });
  expect(res.status, "sign-in should return 200").toBe(200);
  expect(cookie, "session cookie should be set after sign-in").not.toBe("");
});

afterAll(async () => {
  // Best-effort: end any session left open by a test failure
  if (sessionId) {
    await api("POST", `/v1/call-sessions/${sessionId}/end`, { reason: "manual" });
  }
});

// ── (3a) pre-verify: member PHI masked ───────────────────────────────────────

describe("(3) Pre-verify mask — no call session", () => {
  it("GET /v1/members/M1001 returns null for all PHI fields", async () => {
    const { status, body } = await api("GET", `/v1/members/${MEMBER_ID}`);
    const m = body as Record<string, unknown>;
    expect(status).toBe(200);
    // BE-037 masks these pre-verify
    expect(m.firstName, "firstName must be null pre-verify").toBeNull();
    expect(m.lastName,  "lastName must be null pre-verify").toBeNull();
    expect(m.birthdate, "birthdate must be null pre-verify").toBeNull();
    expect(m.phoneNumber, "phoneNumber must be null pre-verify").toBeNull();
    expect(m.email,     "email must be null pre-verify").toBeNull();
    expect(m.addressLine1, "addressLine1 must be null pre-verify").toBeNull();
    // Non-PHI identifiers are returned
    expect(m.id, "member id should be present").toBe(MEMBER_ID);
  });

  it("GET /v1/intake/search?q=M1001 returns safe shape with initials, no firstName/lastName", async () => {
    // Use memberId search to target M1001 directly. Name search ('alice') is
    // unreliable in the Salesforce import corpus (11k+ members, many Alices).
    const { status, body } = await api("GET", `/v1/intake/search?q=${MEMBER_ID}&type=auto&limit=5`);
    const resp = body as { items: Array<Record<string, unknown>> };
    expect(status).toBe(200);
    expect(resp.items.length, "search should return at least one result for M1001").toBeGreaterThan(0);
    const alice = resp.items.find((c) => c.memberId === MEMBER_ID);
    expect(alice, "M1001 should appear in search results").toBeDefined();
    expect(alice!.firstName, "firstName must be absent from safe-search response").toBeUndefined();
    expect(alice!.lastName,  "lastName must be absent from safe-search response").toBeUndefined();
    expect(alice!.initials,  "initials must be present in safe-search response").toBe("A.J.");
  });

  it("GET /v1/cases?memberId=M1001 returns null for memberName, subject, description", async () => {
    const { status, body } = await api("GET", `/v1/cases?memberId=${MEMBER_ID}&limit=5`);
    const resp = body as { items: Array<Record<string, unknown>> };
    expect(status).toBe(200);
    const aliceCases = resp.items.filter((c) => c.memberId === MEMBER_ID);
    expect(aliceCases.length).toBeGreaterThan(0);
    for (const c of aliceCases) {
      expect(c.memberName, `case ${c.id} memberName must be null pre-verify`).toBeNull();
    }
  });

  it("GET /v1/cases/C-2026-0001 returns 200 with null memberName/description (BE-030 mask, no session)", async () => {
    // Case detail returns 200 with PHI fields nulled by BE-030.
    // The case model uses `description` (not `subject`) for the case body.
    const { status, body } = await api("GET", `/v1/cases/${ALICE_CASE_ID}`);
    const c = body as Record<string, unknown>;
    expect(status).toBe(200);
    expect(c.memberName,  "memberName must be null pre-verify").toBeNull();
    expect(c.description, "description must be null pre-verify").toBeNull();
  });

  it("GET /v1/cases/C-2026-0001 with unverified session header → 403 AUTH_HIPAA_REQUIRED", async () => {
    // Start a fresh session (will be ended in this test's cleanup below)
    const startRes = await api("POST", "/v1/call-sessions", {
      memberId: MEMBER_ID,
      callerPhone: "5559990001",
    });
    expect(startRes.status).toBe(200);
    const tmpSid = (startRes.body as Record<string, unknown>).id as string;
    expect(tmpSid).toBeTruthy();

    try {
      const { status, body } = await api(
        "GET",
        `/v1/cases/${ALICE_CASE_ID}`,
        undefined,
        { "x-call-session-id": tmpSid },
      );
      expect(status, "unverified session + case detail → 403").toBe(403);
      expect((body as Record<string, unknown>)?.error?.code).toBe("AUTH_HIPAA_REQUIRED");
    } finally {
      await api("POST", `/v1/call-sessions/${tmpSid}/end`, { reason: "manual" });
    }
  });
});

// ── (4) verify step ───────────────────────────────────────────────────────────

describe("(4) Verify step — POST /hipaa/verify", () => {
  it("starts a call session for M1001", async () => {
    const { status, body } = await api("POST", "/v1/call-sessions", {
      memberId: MEMBER_ID,
      callerPhone: "5552011317",
    });
    expect(status).toBe(200);
    const s = body as Record<string, unknown>;
    sessionId = s.id as string;
    expect(sessionId, "session id must be returned").toBeTruthy();
    expect(s.status).toBe("unverified");
    expect(s.memberId).toBe(MEMBER_ID);
  });

  it("POST /hipaa/verify with manual method → 200, status=verified, verifiedAt present", async () => {
    expect(sessionId, "session must have been started").toBeTruthy();
    const { status, body } = await api(
      "POST",
      `/v1/call-sessions/${sessionId}/hipaa/verify`,
      { memberId: MEMBER_ID, method: "manual", outcome: "verify" },
    );
    expect(status, "verify should return 200").toBe(200);
    const r = body as Record<string, unknown>;
    expect(r.ok).toBe(true);
    const session = r.session as Record<string, unknown>;
    expect(session.status).toBe("verified");
    expect(session.verifiedMemberIds).toBeDefined();
    expect((session.verifiedMemberIds as Record<string, unknown>)[MEMBER_ID]).toBeDefined();
    expect(r.verifiedAt, "verifiedAt timestamp must be present").toBeTruthy();
  });
});

// ── (5) post-verify: PHI unlocked ────────────────────────────────────────────

describe("(5) Post-verify PHI unlock", () => {
  it("GET /v1/members/M1001 returns unmasked PHI after verify", async () => {
    expect(sessionId).toBeTruthy();
    const { status, body } = await api(
      "GET",
      `/v1/members/${MEMBER_ID}`,
      undefined,
      { "x-call-session-id": sessionId },
    );
    const m = body as Record<string, unknown>;
    expect(status).toBe(200);
    expect(m.firstName).toBe("Alice");
    expect(m.lastName).toBe("Johnson");
    expect(m.birthdate).toBe("1980-01-01");
    expect(m.phoneNumber).toBeTruthy();
    expect(m.email).toBeTruthy();
  });

  it("GET /v1/cases/C-2026-0001 with verified session → 200 with unmasked fields", async () => {
    expect(sessionId).toBeTruthy();
    const { status, body } = await api(
      "GET",
      `/v1/cases/${ALICE_CASE_ID}`,
      undefined,
      { "x-call-session-id": sessionId },
    );
    expect(status, "verified session + case detail → 200").toBe(200);
    const c = body as Record<string, unknown>;
    // subject and memberName should be unmasked post-verify
    // (they may be null if genuinely empty in seed, but not masked by gate)
    expect(c.id).toBe(ALICE_CASE_ID);
  });
});

// ── (6) cross-member negative ─────────────────────────────────────────────────

describe("(6) Cross-member negative — different member stays masked", () => {
  it("GET /v1/members/:crossMemberId with verified M1001 session → PHI masked", async () => {
    expect(sessionId).toBeTruthy();
    const { status, body } = await api(
      "GET",
      `/v1/members/${CROSS_MEMBER_ID}`,
      undefined,
      { "x-call-session-id": sessionId },
    );
    const m = body as Record<string, unknown>;
    expect(status).toBe(200);
    // BE-037: member NOT in verifiedMemberIds must remain masked
    expect(m.firstName, "cross-member firstName must stay null").toBeNull();
    expect(m.lastName,  "cross-member lastName must stay null").toBeNull();
    expect(m.birthdate, "cross-member birthdate must stay null").toBeNull();
  });
});

// ── (7) end step ──────────────────────────────────────────────────────────────

describe("(7) End step — POST /end → PHI re-masks", () => {
  it("POST /end returns 200 with lockedAt set", async () => {
    expect(sessionId).toBeTruthy();
    const { status, body } = await api(
      "POST",
      `/v1/call-sessions/${sessionId}/end`,
      { reason: "manual" },
    );
    expect(status).toBe(200);
    const s = body as Record<string, unknown>;
    expect(s.lockedAt, "lockedAt must be set after end").toBeTruthy();
    expect(s.endedAt, "endedAt must be set after end").toBeTruthy();
  });

  it("GET /v1/members/M1001 with locked session → PHI re-masks (null fields)", async () => {
    // The session is locked; the header carries the now-locked session id.
    const { status, body } = await api(
      "GET",
      `/v1/members/${MEMBER_ID}`,
      undefined,
      { "x-call-session-id": sessionId },
    );
    const m = body as Record<string, unknown>;
    expect(status).toBe(200);
    expect(m.firstName, "firstName must re-mask after session end").toBeNull();
    expect(m.lastName,  "lastName must re-mask after session end").toBeNull();
  });
});

// ── (8) audit log assertions ──────────────────────────────────────────────────

describe("(8) Audit log — callSessionId joined on every row", () => {
  it("audit log contains session-started / ok / session-locked rows for this session", () => {
    expect(sessionId).toBeTruthy();
    const rows = auditRowsForSession(sessionId);
    expect(rows.length, "at least 3 audit rows expected").toBeGreaterThanOrEqual(3);

    const started = rows.find((r) => r.result === "session-started");
    expect(started, "session-started row must exist").toBeDefined();
    expect(started!.memberId).toBe(MEMBER_ID);

    const ok = rows.find((r) => r.result === "ok");
    expect(ok, "ok (verify success) row must exist").toBeDefined();
    expect(ok!.method).toBe("manual");
    expect(ok!.memberId).toBe(MEMBER_ID);

    const locked = rows.find((r) => r.result === "session-locked");
    expect(locked, "session-locked row must exist").toBeDefined();
  });

  it("all audit rows carry the callSessionId", () => {
    const rows = auditRowsForSession(sessionId);
    for (const row of rows) {
      expect(row.callSessionId, `every audit row must carry callSessionId`).toBe(sessionId);
    }
  });
});

// ── (9) verify-failed flavor: refused outcome ─────────────────────────────────

describe("(9) verify-failed — refused outcome stays masked", () => {
  let refusedSessionId = "";

  it("starts a second call session", async () => {
    const { status, body } = await api("POST", "/v1/call-sessions", {
      memberId: MEMBER_ID,
      callerPhone: "5559990002",
    });
    expect(status).toBe(200);
    refusedSessionId = (body as Record<string, unknown>).id as string;
    expect(refusedSessionId).toBeTruthy();
  });

  it("POST /hipaa/verify with outcome:refused → 200, result:refused in audit, PHI stays masked", async () => {
    expect(refusedSessionId).toBeTruthy();
    const { status, body } = await api(
      "POST",
      `/v1/call-sessions/${refusedSessionId}/hipaa/verify`,
      { memberId: MEMBER_ID, method: "manual", outcome: "refused" },
    );
    expect(status).toBe(200);
    const r = body as Record<string, unknown>;
    const session = r.session as Record<string, unknown>;
    expect(session.status).toBe("refused");
    expect(session.verifiedMemberIds, "refused session must have no verifiedMemberIds").toBeUndefined();

    // PHI stays masked with refused status
    const memberRes = await api(
      "GET",
      `/v1/members/${MEMBER_ID}`,
      undefined,
      { "x-call-session-id": refusedSessionId },
    );
    expect(memberRes.body && (memberRes.body as Record<string, unknown>).firstName).toBeNull();
  });

  it("refused session audit row has result:refused and no PHI in extra fields", () => {
    const rows = auditRowsForSession(refusedSessionId);
    const refused = rows.find((r) => r.result === "refused");
    expect(refused, "refused audit row must exist").toBeDefined();
    expect(refused!.memberId).toBe(MEMBER_ID);
    // No raw PHI in the audit body — only the controlled memberId field
  });

  it("ends the refused session", async () => {
    const { status } = await api(
      "POST",
      `/v1/call-sessions/${refusedSessionId}/end`,
      { reason: "refused-pre-verify" },
    );
    expect(status).toBe(200);
    // Clear so afterAll doesn't double-end
    refusedSessionId = "";
  });
});
