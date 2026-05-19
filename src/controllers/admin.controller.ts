import { RequestHandler } from "express";
import { AdminService } from "../services/admin.service";
import { errorBody } from "../types/http";

export function createAdminController(adminService: AdminService) {
  function requireAdmin(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]): boolean {
    const user = (req.session as any)?.user;
    if (!user || user.role !== "Admin") {
      res.status(403).json(errorBody("FORBIDDEN", "Admin role required"));
      return false;
    }
    return true;
  }

  const getDashboardSummary: RequestHandler = (req, res) => {
    if (!requireAdmin(req, res)) return;
    adminService
      .getDashboardSummary()
      .then((summary) => res.json(summary))
      .catch((err: unknown) => {
        console.error("[admin] getDashboardSummary error:", err);
        res.status(500).json(errorBody("INTERNAL_ERROR", "Failed to compute dashboard summary"));
      });
  };

  const getCaseSlaGrid: RequestHandler = (req, res) => {
    if (!requireAdmin(req, res)) return;
    adminService
      .getCaseSlaGrid()
      .then((grid) => res.json(grid))
      .catch((err: unknown) => {
        console.error("[admin] getCaseSlaGrid error:", err);
        res.status(500).json(errorBody("INTERNAL_ERROR", "Failed to compute SLA grid"));
      });
  };

  const getHipaaMetrics: RequestHandler = (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rawRange = typeof req.query.range === "string" ? req.query.range : "today";
    let rangeDays = 1;
    if (rawRange !== "today") {
      const match = rawRange.match(/^(\d+)d$/);
      if (match) {
        rangeDays = Math.min(Math.max(parseInt(match[1], 10), 1), 90);
      }
    }
    try {
      res.json(adminService.getHipaaMetrics(rangeDays));
    } catch (err) {
      console.error("[admin] getHipaaMetrics error:", err);
      res.status(500).json(errorBody("INTERNAL_ERROR", "Failed to compute HIPAA metrics"));
    }
  };

  const getFcrTrend: RequestHandler = (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rawRange = typeof req.query.range === "string" ? req.query.range : "30d";
    const match = rawRange.match(/^(\d+)d$/);
    const rangeDays = match
      ? Math.min(Math.max(parseInt(match[1], 10), 1), 90)
      : 30;
    adminService
      .getFcrTrend(rangeDays)
      .then((trend) => res.json(trend))
      .catch((err: unknown) => {
        console.error("[admin] getFcrTrend error:", err);
        res.status(500).json(errorBody("INTERNAL_ERROR", "Failed to compute FCR trend"));
      });
  };

  const getAgentDashboardSummary: RequestHandler = (req, res) => {
    const user = (req.session as any)?.user;
    if (!user) {
      res.status(401).json(errorBody("UNAUTHORIZED", "Session required"));
      return;
    }
    // Accessible to Agents; Admins calling this get their own-agent view too (additive).
    // Non-session callers already blocked by requireSession middleware.
    const agentEmail: string = user.email ?? "";
    const agentDisplayName: string =
      `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
    adminService
      .getAgentDashboardSummary(agentEmail, agentDisplayName)
      .then((summary) => res.json(summary))
      .catch((err: unknown) => {
        console.error("[admin] getAgentDashboardSummary error:", err);
        res.status(500).json(errorBody("INTERNAL_ERROR", "Failed to compute agent dashboard summary"));
      });
  };

  return { getDashboardSummary, getCaseSlaGrid, getHipaaMetrics, getFcrTrend, getAgentDashboardSummary };
}
