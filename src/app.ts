import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { corsMiddleware, corsOptions } from "./config/cors";
import { sessionMiddleware } from "./config/session";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFound";
import { createAuthRouter } from "./routes/auth.routes";
import { createCallSessionsRouter } from "./routes/callSessions.routes";
import { createCasesRouter } from "./routes/cases.routes";
import { createIntakeRouter } from "./routes/intake.routes";
import { createMembersRouter } from "./routes/members.routes";
import { createAdminRouter } from "./routes/admin.routes";
import { createAgentRouter } from "./routes/agent.routes";
import { createRbacRouter } from "./routes/rbac.routes";
import { createUsersRouter } from "./routes/users.routes";
import { createRepos } from "./repos/createRepos";
import { AuthService } from "./services/auth.service";
import { MembersService } from "./services/members.service";
import { CasesService } from "./services/cases.service";
import { CallSessionsService } from "./services/callSessions.service";
import { AdminService } from "./services/admin.service";
import { UsersService } from "./services/users.service";
import { createAuthController } from "./controllers/auth.controller";
import { createMembersController } from "./controllers/members.controller";
import { createCasesController } from "./controllers/cases.controller";
import { createCallSessionsController } from "./controllers/callSessions.controller";
import { createIntakeController } from "./controllers/intake.controller";
import { createAdminController } from "./controllers/admin.controller";
import { createRbacController } from "./controllers/rbac.controller";
import { createUsersController } from "./controllers/users.controller";

export const app = express();

const { userRepo, memberRepo, caseRepo, rbacRepo, callSessionRepo } = createRepos(env.repoDriver);

const authService = new AuthService(userRepo);
const membersService = new MembersService(memberRepo);
const casesService = new CasesService(caseRepo);
const callSessionsService = new CallSessionsService(callSessionRepo, membersService);
const adminService = new AdminService(caseRepo, memberRepo);
const usersService = new UsersService(userRepo);

const authController = createAuthController(authService);
const membersController = createMembersController(membersService, casesService, callSessionsService);
const casesController = createCasesController(casesService, callSessionsService);
const callSessionsController = createCallSessionsController(callSessionsService);
const intakeController = createIntakeController(membersService);
const adminController = createAdminController(adminService);
const rbacController = createRbacController(rbacRepo);
const usersController = createUsersController(usersService);

const authRouter = createAuthRouter(authController);
const callSessionsRouter = createCallSessionsRouter(callSessionsController);
const casesRouter = createCasesRouter(casesController);
const intakeRouter = createIntakeRouter(intakeController);
const membersRouter = createMembersRouter(membersController);
const adminRouter = createAdminRouter(adminController);
const agentRouter = createAgentRouter(adminController);
const rbacRouter = createRbacRouter(rbacController);
const usersRouter = createUsersRouter(usersController);

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`,
    );
  });
  next();
});
app.use(corsMiddleware);
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(sessionMiddleware);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/v1/admin", adminRouter);
app.use("/v1/agent", agentRouter);
app.use("/v1/auth", authRouter);
app.use("/v1/call-sessions", callSessionsRouter);
app.use("/v1/cases", casesRouter);
app.use("/v1/intake", intakeRouter);
app.use("/v1/members", membersRouter);
app.use("/v1/users", usersRouter);
app.use("/v1/rbac", rbacRouter);

app.use(notFoundHandler);
app.use(errorHandler);
