import { RequestHandler, Router } from "express";

export function createAuthRouter(controller: {
  getCsrf: RequestHandler;
  login: RequestHandler;
  getSession: RequestHandler;
  logout: RequestHandler;
  requestPasswordReset: RequestHandler;
}) {
  const authRouter = Router();

  authRouter.get("/csrf", controller.getCsrf);
  authRouter.post("/login", controller.login);
  authRouter.post("/password-reset", controller.requestPasswordReset);
  authRouter.get("/session", controller.getSession);
  authRouter.post("/logout", controller.logout);

  return authRouter;
}
