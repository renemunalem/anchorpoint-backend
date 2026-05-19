import fs from "fs";
import path from "path";
import { CaseRepo } from "../repos/CaseRepo";
import { MemberRepo } from "../repos/MemberRepo";
import { AgentDashboardSummary, CaseSlaGrid, CaseSlaRow, DashboardSummary, FcrTrend, FcrTrendDay, HipaaMetrics, SlaTier } from "../types/http";
import { CasePriority } from "../types/models";
import { env } from "../config/env";

function todayUtcMidnight(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function readAuditLines(): string[] {
  const raw = env.hipaaAuditLogPath;
  if (!raw) return [];
  const logPath = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  if (!fs.existsSync(logPath)) return [];
  try {
    return fs.readFileSync(logPath, "utf8").split("\n").filter((l) => l.trim());
  } catch {
    return [];
  }
}

function countVerificationsToday(): number {
  const today = todayUtcMidnight();
  let count = 0;
  for (const line of readAuditLines()) {
    try {
      const entry = JSON.parse(line) as { result?: string; timestamp?: string };
      if (entry.result === "ok" && typeof entry.timestamp === "string" && entry.timestamp.startsWith(today)) {
        count++;
      }
    } catch { /* skip malformed */ }
  }
  return count;
}

export class AdminService {
  constructor(
    private readonly caseRepo: CaseRepo,
    private readonly memberRepo: MemberRepo,
  ) {}

  async getDashboardSummary(): Promise<DashboardSummary> {
    const asOf = new Date().toISOString();
    const today = todayUtcMidnight();

    const [statusCounts, allCases, allMembers] = await Promise.all([
      this.caseRepo.countByStatus(),
      this.caseRepo.list(),
      this.memberRepo.list(),
    ]);

    const openCasesCount =
      statusCounts.open + statusCounts.waiting + statusCounts.escalated;

    const membersCount = allMembers.length;

    const closedToday = allCases.filter(
      (c) =>
        c.status === "Closed" &&
        typeof (c as { closedAt?: string | null }).closedAt === "string" &&
        ((c as { closedAt?: string | null }).closedAt as string).startsWith(today),
    );
    let fcrRateToday: number | null = null;
    if (closedToday.length > 0) {
      const fcrCounted = closedToday.filter(
        (c) => c.fcr === "yes" || c.fcr === "no",
      );
      if (fcrCounted.length > 0) {
        const fcrYes = fcrCounted.filter((c) => c.fcr === "yes").length;
        fcrRateToday = Math.round((fcrYes / fcrCounted.length) * 1000) / 10;
      }
    }

    const verificationsToday = countVerificationsToday();

    return {
      openCasesCount,
      fcrRateToday,
      membersCount,
      verificationsToday,
      asOf,
    };
  }

  async getCaseSlaGrid(): Promise<CaseSlaGrid> {
    const asOf = new Date().toISOString();
    const nowMs = Date.now();
    const h24Ms = 24 * 60 * 60 * 1000;

    const allCases = await this.caseRepo.list();
    const openCases = allCases.filter((c) => c.status !== "Closed");

    const PRIORITIES: CasePriority[] = ["Urgent", "High", "Normal"];
    const TIERS: SlaTier[] = ["past-due", "within-24h", "beyond-24h", "no-deadline"];

    function slaTier(dueAt: string | null | undefined): SlaTier {
      if (!dueAt) return "no-deadline";
      const dueMs = new Date(dueAt).getTime();
      if (isNaN(dueMs)) return "no-deadline";
      const diffMs = dueMs - nowMs;
      if (diffMs < 0) return "past-due";
      if (diffMs <= h24Ms) return "within-24h";
      return "beyond-24h";
    }

    const counts: Record<string, number> = {};
    for (const c of openCases) {
      const priority: CasePriority =
        c.priority === "Urgent" || c.priority === "High" ? c.priority : "Normal";
      const tier = slaTier(c.dueAt);
      const key = `${priority}|${tier}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const rows: CaseSlaRow[] = [];
    for (const priority of PRIORITIES) {
      for (const tier of TIERS) {
        const count = counts[`${priority}|${tier}`] ?? 0;
        if (count > 0) {
          rows.push({ priority, tier, count });
        }
      }
    }

    return { rows, totalOpen: openCases.length, asOf };
  }

  getHipaaMetrics(rangeDays: number): HipaaMetrics {
    const asOf = new Date().toISOString();
    const rangeLabel = rangeDays === 1 ? "today" : `${rangeDays}d`;
    const cutoffMs = Date.now() - (rangeDays - 1) * 24 * 60 * 60 * 1000;
    // For "today" treat cutoff as UTC midnight to match verificationsToday; for multi-day use rolling window.
    const cutoffStr = rangeDays === 1 ? todayUtcMidnight() : null;

    let ok = 0, failed = 0, refused = 0, limitExceeded = 0;

    for (const line of readAuditLines()) {
      try {
        const entry = JSON.parse(line) as { result?: string; detail?: string; timestamp?: string };
        if (typeof entry.timestamp !== "string") continue;

        const inWindow = cutoffStr
          ? entry.timestamp.startsWith(cutoffStr)
          : new Date(entry.timestamp).getTime() >= cutoffMs;
        if (!inWindow) continue;

        if (entry.result === "ok") {
          ok++;
        } else if (entry.result === "refused") {
          refused++;
        } else if (
          entry.result === "failed" &&
          typeof entry.detail === "string" &&
          entry.detail.startsWith("attempt-limit-exceeded")
        ) {
          limitExceeded++;
        } else if (entry.result === "failed") {
          failed++;
        }
      } catch { /* skip malformed */ }
    }

    const total = ok + failed + refused + limitExceeded;
    return { range: rangeLabel, ok, failed, refused, attemptLimitExceeded: limitExceeded, total, asOf };
  }

  async getFcrTrend(rangeDays: number): Promise<FcrTrend> {
    const asOf = new Date().toISOString();
    const rangeLabel = `${rangeDays}d`;
    const nowMs = Date.now();
    const cutoffMs = nowMs - rangeDays * 24 * 60 * 60 * 1000;

    const allCases = await this.caseRepo.list();

    // bucket: "YYYY-MM-DD" → {yes, no}
    const buckets = new Map<string, { yes: number; no: number }>();

    for (const c of allCases) {
      if (c.status !== "Closed") continue;
      if (c.fcr !== "yes" && c.fcr !== "no") continue;

      const dateStr: string | undefined =
        (c as { closedAt?: string | null }).closedAt ||
        c.updatedAt ||
        c.createdAt;
      if (!dateStr) continue;

      const ts = new Date(dateStr).getTime();
      if (isNaN(ts) || ts < cutoffMs) continue;

      const day = dateStr.slice(0, 10);
      const bucket = buckets.get(day) ?? { yes: 0, no: 0 };
      if (c.fcr === "yes") bucket.yes++;
      else bucket.no++;
      buckets.set(day, bucket);
    }

    // Build sorted day array covering every calendar day in range (sparse → include only days with data)
    const days: FcrTrendDay[] = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { yes, no }]) => ({ date, fcrYes: yes, fcrNo: no, total: yes + no }));

    const totalFcrYes = days.reduce((s, d) => s + d.fcrYes, 0);
    const totalFcrNo = days.reduce((s, d) => s + d.fcrNo, 0);
    const denominator = totalFcrYes + totalFcrNo;
    const fcrRate = denominator > 0
      ? Math.round((totalFcrYes / denominator) * 1000) / 10
      : null;

    return { range: rangeLabel, days, totalFcrYes, totalFcrNo, fcrRate, asOf };
  }

  async getAgentDashboardSummary(
    agentEmail: string,
    agentDisplayName: string,
  ): Promise<AgentDashboardSummary> {
    const asOf = new Date().toISOString();
    const nowMs = Date.now();
    const h24Ms = 24 * 60 * 60 * 1000;
    const d30Ms = 30 * 24 * 60 * 60 * 1000;
    const today = todayUtcMidnight();

    const allCases = await this.caseRepo.list();

    // Cases store the agent's display name (e.g. "Agent One"), not their email.
    // Match on display name first, fall back to email for flexibility.
    const myCases = allCases.filter((c) => {
      const a = c.agent ?? "";
      return a === agentDisplayName || a === agentEmail || a.toLowerCase() === agentEmail.toLowerCase();
    });

    const myOpen = myCases.filter((c) => c.status !== "Closed");
    let myOverdue = 0;
    let myDueSoon = 0;
    for (const c of myOpen) {
      if (!c.dueAt) continue;
      const dueMs = new Date(c.dueAt).getTime();
      if (isNaN(dueMs)) continue;
      const diff = dueMs - nowMs;
      if (diff < 0) myOverdue++;
      else if (diff <= h24Ms) myDueSoon++;
    }

    const cutoff30d = nowMs - d30Ms;
    const myClosed30d = myCases.filter((c) => {
      if (c.status !== "Closed") return false;
      const dateStr = (c as { closedAt?: string | null }).closedAt || c.updatedAt || c.createdAt;
      if (!dateStr) return false;
      return new Date(dateStr).getTime() >= cutoff30d;
    });
    let myFcrRateLast30d: number | null = null;
    const fcrCounted = myClosed30d.filter((c) => c.fcr === "yes" || c.fcr === "no");
    if (fcrCounted.length > 0) {
      const yes = fcrCounted.filter((c) => c.fcr === "yes").length;
      myFcrRateLast30d = Math.round((yes / fcrCounted.length) * 1000) / 10;
    }

    // Count ok audit rows for this agent today
    let myVerificationsToday = 0;
    for (const line of readAuditLines()) {
      try {
        const entry = JSON.parse(line) as {
          result?: string;
          timestamp?: string;
          actor?: { email?: string; id?: string };
        };
        if (
          entry.result === "ok" &&
          typeof entry.timestamp === "string" &&
          entry.timestamp.startsWith(today) &&
          (entry.actor?.email === agentEmail || entry.actor?.id === agentEmail)
        ) {
          myVerificationsToday++;
        }
      } catch { /* skip */ }
    }

    return {
      myOpenCasesCount: myOpen.length,
      myOverdueCasesCount: myOverdue,
      myDueSoonCasesCount: myDueSoon,
      myFcrRateLast30d,
      myVerificationsToday,
      asOf,
    };
  }
}
