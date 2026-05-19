import { RequestHandler, Router } from "express";
import { requireSession } from "../middleware/requireSession";

export function createUsersRouter(controller: {
  listUsers: RequestHandler;
}) {
  const usersRouter = Router();

  usersRouter.get("/", requireSession, controller.listUsers);

  return usersRouter;
}
