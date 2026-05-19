import { RequestHandler, Router } from "express";
import { requireSession } from "../middleware/requireSession";

export function createIntakeRouter(controller: {
  searchIntake: RequestHandler;
}) {
  const intakeRouter = Router();

  intakeRouter.get("/search", requireSession, controller.searchIntake);

  return intakeRouter;
}
