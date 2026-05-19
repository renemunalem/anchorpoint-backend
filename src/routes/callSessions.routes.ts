import { RequestHandler, Router } from "express";
import { requireSession } from "../middleware/requireSession";

export function createCallSessionsRouter(controller: {
  startCallSession: RequestHandler;
  endCallSession: RequestHandler;
  getCallSession: RequestHandler;
  verifyCallSessionHipaa: RequestHandler;
  extendCallSession: RequestHandler;
}) {
  const callSessionsRouter = Router();

  callSessionsRouter.post("/", requireSession, controller.startCallSession);
  callSessionsRouter.post("/:id/end", requireSession, controller.endCallSession);
  callSessionsRouter.post("/:id/extend", requireSession, controller.extendCallSession);
  callSessionsRouter.post("/:id/hipaa/verify", requireSession, controller.verifyCallSessionHipaa);
  callSessionsRouter.get("/:id", requireSession, controller.getCallSession);

  return callSessionsRouter;
}
