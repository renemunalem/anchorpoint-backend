import { randomBytes } from "crypto";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { CallSession, CallSessionStatus } from "../../types/models";
import {
  CallSessionEndResult,
  CallSessionMutateResult,
  CallSessionRepo,
  CallSessionStartInput,
  ExtendSessionResult,
} from "../CallSessionRepo";
import { getMySqlPool } from "./client";

type CallSessionRow = RowDataPacket & {
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

const SELECT_COLUMNS = `
  id,
  agent_id AS agentId,
  caller_phone AS callerPhone,
  member_id AS memberId,
  status,
  started_at AS startedAt,
  ended_at AS endedAt,
  locked_at AS lockedAt,
  verified_member_ids AS verifiedMemberIds
`;

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

export class MySqlCallSessionRepo implements CallSessionRepo {
  async startSession(input: CallSessionStartInput): Promise<CallSession> {
    const pool = getMySqlPool();
    const id = newSessionId();
    const startedAt = new Date().toISOString();
    const status: CallSessionStatus = "unverified";

    await pool.execute<ResultSetHeader>(
      `
        INSERT INTO call_sessions
          (id, agent_id, caller_phone, member_id, status, started_at, ended_at, locked_at, verified_member_ids)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `,
      [id, input.agentId, input.callerPhone ?? null, input.memberId ?? null, status, startedAt, "{}"],
    );

    const fetched = await this.getById(id);
    if (!fetched) throw new Error(`Failed to read back inserted call session ${id}`);
    return fetched;
  }

  async endSession(id: string): Promise<CallSessionEndResult | null> {
    const pool = getMySqlPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<CallSessionRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = ? FOR UPDATE`,
        [id],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return null;
      }

      const session = mapRow(rows[0]);
      if (session.lockedAt) {
        await connection.rollback();
        return { session, transitioned: false };
      }

      const timestamp = new Date().toISOString();
      await connection.execute<ResultSetHeader>(
        `UPDATE call_sessions SET ended_at = ?, locked_at = ? WHERE id = ?`,
        [timestamp, timestamp, id],
      );

      await connection.commit();
      const fetched = await this.getById(id);
      if (!fetched) throw new Error(`Failed to read back ended call session ${id}`);
      return { session: fetched, transitioned: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getById(id: string): Promise<CallSession | null> {
    const pool = getMySqlPool();
    const [rows] = await pool.query<CallSessionRow[]>(
      `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async verifyMember(
    id: string,
    memberId: string,
    method: string,
  ): Promise<CallSessionMutateResult> {
    const pool = getMySqlPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<CallSessionRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = ? FOR UPDATE`,
        [id],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return { kind: "not-found" };
      }

      const current = mapRow(rows[0]);
      if (current.lockedAt) {
        await connection.rollback();
        return { kind: "locked", session: current };
      }

      const stamp = { verifiedAtMs: Date.now(), method };
      await connection.execute<ResultSetHeader>(
        `
          UPDATE call_sessions
          SET status = 'verified',
              verified_member_ids = JSON_SET(COALESCE(verified_member_ids, JSON_OBJECT()), ?, CAST(? AS JSON))
          WHERE id = ?
        `,
        [`$."${memberId.replace(/"/g, '\\"')}"`, JSON.stringify(stamp), id],
      );

      await connection.commit();
      const fetched = await this.getById(id);
      if (!fetched) throw new Error(`Failed to read back verified call session ${id}`);
      return { kind: "ok", session: fetched };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async extendSession(id: string): Promise<ExtendSessionResult> {
    const pool = getMySqlPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<CallSessionRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = ? FOR UPDATE`,
        [id],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return { kind: "not-found" };
      }

      const current = mapRow(rows[0]);
      if (current.lockedAt) {
        await connection.rollback();
        return { kind: "locked", session: current };
      }

      const verified = current.verifiedMemberIds;
      if (!verified || Object.keys(verified).length === 0) {
        await connection.rollback();
        return { kind: "no-verified-members" };
      }

      const nowMs = Date.now();
      const extendedAt = new Date(nowMs).toISOString();
      const refreshed: typeof verified = {};
      for (const [memberId, stamp] of Object.entries(verified)) {
        refreshed[memberId] = { verifiedAtMs: nowMs, method: stamp.method };
      }

      await connection.execute<ResultSetHeader>(
        `UPDATE call_sessions SET verified_member_ids = ? WHERE id = ?`,
        [JSON.stringify(refreshed), id],
      );

      await connection.commit();
      const fetched = await this.getById(id);
      if (!fetched) throw new Error(`Failed to read back extended call session ${id}`);
      return { kind: "ok", session: fetched, extendedAt };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async markRefused(id: string): Promise<CallSessionMutateResult> {
    const pool = getMySqlPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<CallSessionRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM call_sessions WHERE id = ? FOR UPDATE`,
        [id],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return { kind: "not-found" };
      }

      const current = mapRow(rows[0]);
      if (current.lockedAt) {
        await connection.rollback();
        return { kind: "locked", session: current };
      }

      await connection.execute<ResultSetHeader>(
        `UPDATE call_sessions SET status = 'refused' WHERE id = ?`,
        [id],
      );

      await connection.commit();
      const fetched = await this.getById(id);
      if (!fetched) throw new Error(`Failed to read back refused call session ${id}`);
      return { kind: "ok", session: fetched };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
