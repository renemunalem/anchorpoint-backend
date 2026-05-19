import { RequestHandler, Router } from "express";
import { requireSession } from "../middleware/requireSession";

export function createMembersRouter(controller: {
  getMembers: RequestHandler;
  getMemberById: RequestHandler;
  verifyMemberHipaa: RequestHandler;
  listCasesForMember: RequestHandler;
  listAttachmentsForMember: RequestHandler;
  listInteractionsForMember: RequestHandler;
  ssnReveal: RequestHandler;
}) {
  const membersRouter = Router();

  membersRouter.get("/", requireSession, controller.getMembers);
  membersRouter.post("/:id/hipaa/verify", requireSession, controller.verifyMemberHipaa);
  membersRouter.post("/:id/ssn/reveal", requireSession, controller.ssnReveal);
  membersRouter.get("/:id/cases", requireSession, controller.listCasesForMember);
  membersRouter.get("/:id/attachments", requireSession, controller.listAttachmentsForMember);
  membersRouter.get("/:id/interactions", requireSession, controller.listInteractionsForMember);
  membersRouter.get("/:id", requireSession, controller.getMemberById);

  return membersRouter;
}
