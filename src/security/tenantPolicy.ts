/**
 * Tenant HIPAA Verification Display Policy
 *
 * Three-mode model approved by SECURITY-01 (2026-05-26):
 *   strict   — All PHI fields masked (••••••••) during verification. Agent enters
 *              caller's answer; system returns match/no-match only. Stored value is
 *              never transmitted. Current SMHA baseline.
 *   standard — Configured fields visible to authorized agents during an active,
 *              member-bound, verified call session with mandatory anti-leading copy.
 *              Requires Jeff/Kristine approval before SMHA activation (Decision 2).
 *   hybrid   — Per-field partial values visible (e.g., birth year only, last-4 phone).
 *              Partial masking MUST be enforced at backend response serialization —
 *              the API sends only the partial value; the frontend never receives the
 *              full value and masks it locally. Requires Jeff/Kristine approval.
 *
 * SECURITY non-negotiables (auto-ratified, require no further approval):
 *   1. Unknown/new tenants always resolve to STRICT. No accidental PHI exposure.
 *   2. effective_mode = min(tenantDefault, roleOverride) — least privilege wins.
 *   3. Hybrid partial masking is backend-enforced at response serialization.
 *   4. Audit record written BEFORE PHI is transmitted (see AUDIT_BEFORE_PHI_SEND).
 *   5. No PHI values in any audit log row (field names + outcomes only).
 *   6. Policy changes require Compliance/Admin role + non-empty reason.
 *   7. Change history is append-only; current value is never the only record.
 *
 * AUDIT_BEFORE_PHI_SEND invariant (applies when Standard/Hybrid activated):
 *   Any endpoint that releases a PHI field value under Standard or Hybrid mode MUST:
 *     1. Attempt to write a phi-unlock audit row via appendVerificationDisplayAuditEvent().
 *     2. If the write throws (filesystem error, DB error, etc.), respond with HTTP 500 —
 *        do NOT return the PHI field. The caller receives an error, not silently-unlogged PHI.
 *   Implementation pattern (pseudocode):
 *     try {
 *       appendVerificationDisplayAuditEvent({ eventType: "phi-unlock", fieldName, ... });
 *     } catch {
 *       return res.status(500).json({ code: "AUDIT_WRITE_FAILED" });
 *     }
 *     return res.json({ [fieldName]: phiValue });
 *
 * Mode activation gate for SMHA:
 *   Standard/Hybrid for SMHA is NOT active. resolveEffectiveModeForSmha() returns
 *   "strict" unconditionally until Jeff/Kristine decisions are received and a separate
 *   activation task is filed and authorized by Rene.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type VerificationDisplayMode = "strict" | "standard" | "hybrid";

/** Fields that may appear in a HIPAA verification interaction. */
export type VerificationField =
  | "dateOfBirth"
  | "addressLine1"
  | "zipCode"
  | "phoneNumber"
  | "memberId"
  | "ssnLast4"
  | "email";

/**
 * Per-field visibility under a given mode.
 *   visible — Full value rendered to the agent (Standard mode).
 *   partial — Only the partial/masked value rendered (Hybrid mode); backend enforces masking.
 *   hidden  — Field never rendered; agent enters caller's value; system returns match/no-match.
 */
export type FieldVisibility = "visible" | "partial" | "hidden";

/**
 * Defines what "partial" means for a given field in Hybrid mode.
 * The backend applies this transform before serializing the response — the frontend
 * receives only the partial value and must not un-mask it.
 */
export interface PartialMaskDefinition {
  field: VerificationField;
  /** Human-readable description for documentation and audit-log event detail. */
  description: string;
  /**
   * Backend transform function. Receives the raw stored value and returns the
   * partial value to transmit. Returns null if rawValue is null or empty.
   * Must not be used until Standard/Hybrid is activated for the tenant.
   */
  applyMask(rawValue: string | null): string | null;
}

// ---------------------------------------------------------------------------
// Partial mask definitions (Hybrid mode — backend-enforced)
// ---------------------------------------------------------------------------

export const PARTIAL_MASK_DEFINITIONS: Record<VerificationField, PartialMaskDefinition> = {
  dateOfBirth: {
    field: "dateOfBirth",
    description: "Birth year only (e.g., •• / •• / 1980). Full DOB never transmitted.",
    applyMask(raw) {
      if (!raw) return null;
      // Expects ISO 8601 (YYYY-MM-DD) or YYYY; extract year.
      const yearMatch = raw.match(/(\d{4})/);
      return yearMatch ? `•• / •• / ${yearMatch[1]}` : null;
    },
  },
  addressLine1: {
    field: "addressLine1",
    description: "Street name suppressed; city/state retained via separate zipCode field.",
    applyMask(raw) {
      if (!raw) return null;
      // Suppress street number and name; emit masked placeholder.
      return "•••••• St";
    },
  },
  zipCode: {
    field: "zipCode",
    description: "First 3 digits masked; last 2 retained (e.g., ••8 12 for 85012).",
    applyMask(raw) {
      if (!raw) return null;
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 2) return null;
      const masked = "•".repeat(Math.max(0, digits.length - 2));
      return masked + digits.slice(-2);
    },
  },
  phoneNumber: {
    field: "phoneNumber",
    description: "Last 4 digits only (e.g., (•••) •••-4412).",
    applyMask(raw) {
      if (!raw) return null;
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 4) return null;
      return `(•••) •••-${digits.slice(-4)}`;
    },
  },
  memberId: {
    field: "memberId",
    description: "Last 4 of member ID (e.g., ····1001). Same as pre-verify safe display.",
    applyMask(raw) {
      if (!raw) return null;
      return raw.length > 4 ? `····${raw.slice(-4)}` : raw;
    },
  },
  ssnLast4: {
    field: "ssnLast4",
    description: "Only last-4 SSN digits ever transmitted (no additional Hybrid masking needed).",
    applyMask(raw) {
      if (!raw) return null;
      const digits = raw.replace(/\D/g, "");
      return digits.length >= 4 ? digits.slice(-4) : null;
    },
  },
  email: {
    field: "email",
    description: "Local part masked; domain retained (e.g., ••••••@example.com).",
    applyMask(raw) {
      if (!raw) return null;
      const atIdx = raw.indexOf("@");
      if (atIdx < 1) return null;
      return `••••••${raw.slice(atIdx)}`;
    },
  },
};

// ---------------------------------------------------------------------------
// Policy model
// ---------------------------------------------------------------------------

/** Per-field visibility map. Missing field entries default to "hidden". */
export type FieldVisibilityMap = Partial<Record<VerificationField, FieldVisibility>>;

/**
 * Tenant-level HIPAA Verification Display Policy.
 * Stored in tenant_verification_policies (authored schema; not yet applied).
 */
export interface TenantVerificationPolicy {
  /** Tenant identifier. Maps to the tenant that owns this policy. */
  tenantId: string;
  /** Tenant-level default mode. */
  defaultMode: VerificationDisplayMode;
  /**
   * Per-field visibility overrides for the default mode.
   * Fields not listed default to "hidden" — safest fallback.
   */
  fieldVisibility: FieldVisibilityMap;
  createdAt: string;
  updatedAt: string;
  /** Actor who last changed this policy record. */
  lastChangedByActorId: string;
  lastChangedByRole: string;
  /** Required non-empty reason for the most recent change. */
  lastChangeReason: string;
}

/**
 * Per-role override that pins a role to a specific mode.
 * Enforces least-privilege: a role pinned to "strict" remains strict even if
 * the tenant default is "standard". No role may be pinned to a LOOSER mode than
 * the tenant default.
 */
export interface RoleVerificationOverride {
  tenantId: string;
  role: string;
  /** Pinned mode. Must be <= tenant default on the least-privilege scale. */
  pinnedMode: VerificationDisplayMode;
  createdAt: string;
  setByActorId: string;
  setByRole: string;
  /** Required non-empty reason. */
  reason: string;
}

/**
 * Append-only change history record. One row per policy change event.
 * Stored in tenant_policy_change_history; rows are never updated or deleted.
 */
export interface PolicyChangeRecord {
  id: string;
  tenantId: string;
  changedAt: string;
  actorId: string;
  actorRole: string;
  targetType: "tenant-policy" | "role-override";
  targetIdentifier: string;
  oldMode: VerificationDisplayMode | null;
  newMode: VerificationDisplayMode;
  oldFieldVisibility: FieldVisibilityMap | null;
  newFieldVisibility: FieldVisibilityMap;
  /** Non-empty reason text required before a policy change is accepted. */
  reason: string;
  /** Free-form comment (optional; reason is required). */
  comment?: string;
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------

/**
 * Least-privilege mode ordering.
 * strict < standard < hybrid — lower index = more restrictive.
 */
const MODE_ORDER: ReadonlyArray<VerificationDisplayMode> = ["strict", "standard", "hybrid"];

function modeIndex(mode: VerificationDisplayMode): number {
  return MODE_ORDER.indexOf(mode);
}

/**
 * Resolves the effective verification display mode for a given agent call.
 *
 * Rule: effective_mode = min(tenantDefault, roleOverride) — least privilege wins.
 * A role pinned to "strict" stays "strict" even when the tenant default is "standard".
 * No role can be elevated to a looser mode than the tenant default.
 *
 * When no tenantPolicy is provided (unknown/new tenant), returns "strict".
 * When no roleOverride is provided, returns the tenant default.
 */
export function resolveEffectiveMode(
  tenantPolicy: TenantVerificationPolicy | null | undefined,
  roleOverride: RoleVerificationOverride | null | undefined,
): VerificationDisplayMode {
  if (!tenantPolicy) {
    // SECURITY non-negotiable: unknown/new tenant always resolves to Strict.
    return "strict";
  }
  const tenantIdx = modeIndex(tenantPolicy.defaultMode);
  if (!roleOverride) {
    return tenantPolicy.defaultMode;
  }
  const overrideIdx = modeIndex(roleOverride.pinnedMode);
  // Return whichever is more restrictive (lower index).
  return overrideIdx <= tenantIdx ? roleOverride.pinnedMode : tenantPolicy.defaultMode;
}

/**
 * Returns the Strict fallback policy used when no tenant record exists.
 * All fields default to "hidden". Mode is "strict".
 * This is NOT a real tenant record — callers must not persist this as a DB row.
 */
export function getStrictFallbackPolicy(tenantId: string): TenantVerificationPolicy {
  return {
    tenantId,
    defaultMode: "strict",
    fieldVisibility: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastChangedByActorId: "system",
    lastChangedByRole: "system",
    lastChangeReason: "Automatic strict fallback — no policy record found for tenant.",
  };
}

/**
 * SMHA activation gate.
 *
 * Returns "strict" unconditionally until Jeff/Kristine Decisions 1–4 are received
 * and TRIAGE files a separate activation task authorized by Rene.
 *
 * Standard/Hybrid activation for SMHA must NOT be done by changing this function
 * in isolation. The correct path:
 *   1. Record Jeff/Kristine decisions in ba_suggestions.md / triage_log.md.
 *   2. TRIAGE files an activation BE task (e.g., BE-076).
 *   3. Rene approves the task.
 *   4. BACKEND-01 inserts/updates the tenant policy record in the DB.
 *   5. This function (or a policy-lookup repo call) reads the live DB record.
 */
export function resolveEffectiveModeForSmha(
  _agentRole: string,
): VerificationDisplayMode {
  // Activation gate: Standard/Hybrid not yet approved for SMHA.
  // See: hipaa_verification_display_policy_decision_package.md — Decisions 1–4 pending.
  return "strict";
}

// ---------------------------------------------------------------------------
// Validation helpers (used by policy-change write path when it is implemented)
// ---------------------------------------------------------------------------

/**
 * Validates that a PolicyChangeRecord has a non-empty reason.
 * The policy-change endpoint must call this before persisting a change.
 * Returns an error string if invalid, null if valid.
 */
export function validatePolicyChangeReason(reason: string | undefined | null): string | null {
  if (!reason || reason.trim().length === 0) {
    return "Policy change requires a non-empty reason/comment.";
  }
  return null;
}

/**
 * Validates that a proposed role override does not elevate a role above the
 * tenant default (least-privilege enforcement).
 * Returns an error string if invalid, null if valid.
 */
export function validateRoleOverrideNotEscalating(
  tenantPolicy: TenantVerificationPolicy,
  proposedPinnedMode: VerificationDisplayMode,
): string | null {
  const tenantIdx = modeIndex(tenantPolicy.defaultMode);
  const proposedIdx = modeIndex(proposedPinnedMode);
  if (proposedIdx > tenantIdx) {
    return (
      `Role override cannot be set to a looser mode (${proposedPinnedMode}) ` +
      `than the tenant default (${tenantPolicy.defaultMode}).`
    );
  }
  return null;
}
