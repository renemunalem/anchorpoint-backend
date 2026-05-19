import { Router } from "express";
import { requireSession } from "../middleware/requireSession";

export function createAdminRouter(controller: {
  getDashboardSummary: import("express").RequestHandler;
  getCaseSlaGrid: import("express").RequestHandler;
  getHipaaMetrics: import("express").RequestHandler;
  getFcrTrend: import("express").RequestHandler;
}) {
  const router = Router();
  router.get("/dashboard/summary", requireSession, controller.getDashboardSummary);
  router.get("/dashboard/case-sla", requireSession, controller.getCaseSlaGrid);
  router.get("/dashboard/hipaa-metrics", requireSession, controller.getHipaaMetrics);
  router.get("/dashboard/fcr-trend", requireSession, controller.getFcrTrend);
  return router;
}
