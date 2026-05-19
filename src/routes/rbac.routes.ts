import { RequestHandler, Router } from "express";
import { requireSession } from "../middleware/requireSession";

export function createRbacRouter(controller: {
  listPermissions: RequestHandler;
}) {
  const rbacRouter = Router();

  rbacRouter.get("/permissions", requireSession, controller.listPermissions);

  return rbacRouter;
}
