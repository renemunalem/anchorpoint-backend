import { Router } from "express";
import { requireSession } from "../middleware/requireSession";

export function createAgentRouter(controller: {
  getAgentDashboardSummary: import("express").RequestHandler;
}) {
  const router = Router();
  router.get("/dashboard/summary", requireSession, controller.getAgentDashboardSummary);
  return router;
}
