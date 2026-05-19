import { RequestHandler, Router } from "express";
import { requireSession } from "../middleware/requireSession";

export function createCasesRouter(controller: {
  getCaseStats: RequestHandler;
  listCases: RequestHandler;
  getCaseDetail: RequestHandler;
  downloadCaseAttachment: RequestHandler;
  patchCase: RequestHandler;
  assignCase: RequestHandler;
  addCaseNote: RequestHandler;
  addCaseCall: RequestHandler;
  addCaseTask: RequestHandler;
  addCaseEmail: RequestHandler;
  addCaseGlipOut: RequestHandler;
  addCaseNiftyOut: RequestHandler;
  closeCase: RequestHandler;
  reopenCase: RequestHandler;
  updateCaseStatus: RequestHandler;
}) {
  const casesRouter = Router();

  casesRouter.get("/stats", requireSession, controller.getCaseStats);
  casesRouter.get("/", requireSession, controller.listCases);
  casesRouter.get(
    "/:caseId/attachments/:attachmentId/download",
    requireSession,
    controller.downloadCaseAttachment,
  );
  casesRouter.get("/:id", requireSession, controller.getCaseDetail);
  casesRouter.patch("/:id", requireSession, controller.patchCase);
  casesRouter.patch("/:id/assign", requireSession, controller.assignCase);
  casesRouter.post("/:id/notes", requireSession, controller.addCaseNote);
  casesRouter.post("/:id/calls", requireSession, controller.addCaseCall);
  casesRouter.post("/:id/tasks", requireSession, controller.addCaseTask);
  casesRouter.post("/:id/emails", requireSession, controller.addCaseEmail);
  casesRouter.post("/:id/glip", requireSession, controller.addCaseGlipOut);
  casesRouter.post("/:id/nifty", requireSession, controller.addCaseNiftyOut);
  casesRouter.post("/:id/close", requireSession, controller.closeCase);
  casesRouter.post("/:id/reopen", requireSession, controller.reopenCase);
  casesRouter.patch("/:id/status", requireSession, controller.updateCaseStatus);

  return casesRouter;
}
