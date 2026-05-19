import { randomBytes } from "crypto";
import { CallSession, CallSessionStatus } from "../../types/models";
import {
  CallSessionEndResult,
  CallSessionMutateResult,
  CallSessionRepo,
  CallSessionStartInput,
  ExtendSessionResult,
} from "../CallSessionRepo";
import { getPostgresPool } from "./client";

type CallSessionRow = {
  id: string;
  agentId: string;
  callerPhone: string | null;
  memberId: string | null;
  status: CallSessionStatus;
  startedAt: string;
  endedAt: string | null;
  lockedAt: string | null;
  verifiedMemberIds: unknown;
};

function newSessionId() {
  const random = randomBytes(6).toString("base64url");
  return `cs-${Date.now().toString(36)}-${random}`;
}

function parseVerifiedMemberIds(value: unknown): CallSession["verifiedMemberIds"] {
  if (!value) return undefined;
  if (typeof value === "string") return JSON.parse(value);
  return value as CallSession["verifiedMemberIds"];
}

function mapRow(row: CallSessionRow): CallSession {
  const verified = parseVerifiedMemberIds(row.verifiedMemberIds);
  return {
    id: row.id,
    agentId: row.agentId,
    callerPhone: row.callerPhone,
    memberId: row.memberId,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    lockedAt: row.lockedAt,
    verifiedMemberIds: verified && Object.keys(verified).length > 0 ? verified : undefined,
  };
}

const SELECT_COLUMNS = `
  id,
  agent_id AS "agentId",
  caller_phone AS "callerPhone",
  member_id AS "memberId",
  status,
  started_at AS "startedAt",
  ended_at AS "endedAt",
  locked_at AS "lockedAt",
  verified_member_ids AS "verifiedMemberIds"
`;

export class PostgresCallSessionRepo implements CallSessionRepo {
  async startSession(input: CallSessionStartInput): Promise<CallSession> {
    const pool = getPostgresPool();
    const id = newSessionId();
    const startedAt = new Date().toISOString();
    const status: CallSessionStatus = "unverified";

    const { rows } = await pool.query<CallSessionRow>(
      `
        INSERT INTO call_sessions
          (id, agent_id, caller_phone, member_id, status, started_at, ended_at, locked_at, verified_member_ids)
        VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, '{}'::jsonb)
        RETURNING ${SELECT_COLUMNS}
      `,
      [id, input.agentId, input.callerPhone ?? null, input.memberId ?? null, status, startedAt],
    );

    return mapRow(rows[0]);
  }

  async endSession(id: string): Promise<CallSessionEndResult | null> {
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<CallSessionRow>(
        `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = $1 FOR UPDATE`,
        [id],
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      const session = mapRow(existing.rows[0]);
      if (session.lockedAt) {
        await client.query("ROLLBACK");
        return { session, transitioned: false };
      }

      const timestamp = new Date().toISOString();
      const updated = await client.query<CallSessionRow>(
        `
          UPDATE call_sessions
          SET ended_at = $1, locked_at = $1
          WHERE id = $2
          RETURNING ${SELECT_COLUMNS}
        `,
        [timestamp, id],
      );

      await client.query("COMMIT");
      return { session: mapRow(updated.rows[0]), transitioned: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<CallSession | null> {
    const pool = getPostgresPool();
    const { rows } = await pool.query<CallSessionRow>(
      `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async verifyMember(
    id: string,
    memberId: string,
    method: string,
  ): Promise<CallSessionMutateResult> {
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<CallSessionRow>(
        `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = $1 FOR UPDATE`,
        [id],
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        return { kind: "not-found" };
      }

      const current = mapRow(existing.rows[0]);
      if (current.lockedAt) {
        await client.query("ROLLBACK");
        return { kind: "locked", session: current };
      }

      const stamp = { verifiedAtMs: Date.now(), method };
      const updated = await client.query<CallSessionRow>(
        `
          UPDATE call_sessions
          SET status = 'verified',
              verified_member_ids = COALESCE(verified_member_ids, '{}'::jsonb)
                || jsonb_build_object($1::text, $2::jsonb)
          WHERE id = $3
          RETURNING ${SELECT_COLUMNS}
        `,
        [memberId, JSON.stringify(stamp), id],
      );

      await client.query("COMMIT");
      return { kind: "ok", session: mapRow(updated.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async extendSession(id: string): Promise<ExtendSessionResult> {
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<CallSessionRow>(
        `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = $1 FOR UPDATE`,
        [id],
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        return { kind: "not-found" };
      }

      const current = mapRow(existing.rows[0]);
      if (current.lockedAt) {
        await client.query("ROLLBACK");
        return { kind: "locked", session: current };
      }

      const verified = current.verifiedMemberIds;
      if (!verified || Object.keys(verified).length === 0) {
        await client.query("ROLLBACK");
        return { kind: "no-verified-members" };
      }

      const nowMs = Date.now();
      const extendedAt = new Date(nowMs).toISOString();
      const refreshed: typeof verified = {};
      for (const [memberId, stamp] of Object.entries(verified)) {
        refreshed[memberId] = { verifiedAtMs: nowMs, method: stamp.method };
      }

      const updated = await client.query<CallSessionRow>(
        `
          UPDATE call_sessions
          SET verified_member_ids = $1::jsonb
          WHERE id = $2
          RETURNING ${SELECT_COLUMNS}
        `,
        [JSON.stringify(refreshed), id],
      );

      await client.query("COMMIT");
      return { kind: "ok", session: mapRow(updated.rows[0]), extendedAt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async markRefused(id: string): Promise<CallSessionMutateResult> {
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<CallSessionRow>(
        `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = $1 FOR UPDATE`,
        [id],
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        return { kind: "not-found" };
      }

      const current = mapRow(existing.rows[0]);
      if (current.lockedAt) {
        await client.query("ROLLBACK");
        return { kind: "locked", session: current };
      }

      const updated = await client.query<CallSessionRow>(
        `
          UPDATE call_sessions
          SET status = 'refused'
          WHERE id = $1
          RETURNING ${SELECT_COLUMNS}
        `,
        [id],
      );

      await client.query("COMMIT");
      return { kind: "ok", session: mapRow(updated.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
