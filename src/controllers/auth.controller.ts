import { Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { persistentSessionMaxAgeMs } from "../config/session";
import { AuthService, LoginThrottleState } from "../services/auth.service";
import { authErrorBody } from "../types/http";
import { LoginRequest, PasswordResetRequest } from "../types/models";

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function wantsPersistentSession(credentials: LoginRequest) {
  return Boolean(
    credentials.keepMeLoggedIn ?? credentials.rememberMe ?? credentials.persistSession,
  );
}

function isValidLoginRequest(value: LoginRequest) {
  return isValidEmail(value?.email) && typeof value?.password === "string";
}

function logAuthError(event: string, error: unknown) {
  console.error(
    `${new Date().toISOString()} ${event} ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

function authThrottleDetails(state: LoginThrottleState) {
  return {
    failedAttempts: state.failedAttempts,
    remainingAttempts: state.remainingAttempts,
    maxFailedAttempts: state.maxFailedAttempts,
    ...(state.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: state.retryAfterSeconds }
      : {}),
    ...(state.lockedUntil ? { lockedUntil: state.lockedUntil } : {}),
  };
}

export function createAuthController(authService: AuthService) {
  const login: RequestHandler = (req, res) => {
    void (async () => {
      const credentials = req.body as LoginRequest;
      if (!isValidLoginRequest(credentials)) {
        res
          .status(400)
          .json(authErrorBody("AUTH_INVALID_REQUEST", "Enter a valid email and password."));
        return;
      }

      const throttle = authService.checkLoginThrottle(credentials.email);

      if (throttle.limited) {
        res
          .status(429)
          .json(
            authErrorBody(
              "AUTH_ACCOUNT_LOCKED",
              "Too many sign-in attempts. Try again later.",
              authThrottleDetails(throttle),
            ),
          );
        return;
      }

      const user = await authService.login(credentials);

      if (!user) {
        const failureState = authService.recordLoginFailure(credentials.email);
        if (failureState.limited) {
          res
            .status(429)
            .json(
              authErrorBody(
                "AUTH_ACCOUNT_LOCKED",
                "Too many sign-in attempts. Try again later.",
                authThrottleDetails(failureState),
              ),
            );
          return;
        }

        res
          .status(401)
          .json(
            authErrorBody(
              "AUTH_INVALID_CREDENTIALS",
              "Invalid email or password.",
              authThrottleDetails(failureState),
            ),
          );
        return;
      }

      authService.recordLoginSuccess(credentials.email);
      const persistent = wantsPersistentSession(credentials);
      req.session.cookie.maxAge = persistent ? persistentSessionMaxAgeMs : undefined;
      req.session.cookie.expires = persistent ? req.session.cookie.expires : null;
      (req.session as any).user = user;
      req.session.save((error) => {
        if (error) {
          logAuthError("AUTH_SESSION_SAVE_ERROR", error);
          res
            .status(500)
            .json(authErrorBody("AUTH_INTERNAL", "Authentication is temporarily unavailable."));
          return;
        }

        res.status(200).json({ user, sessionId: req.sessionID, persistent });
      });
    })().catch((error: unknown) => {
      logAuthError("AUTH_LOGIN_ERROR", error);
      res
        .status(500)
        .json(authErrorBody("AUTH_INTERNAL", "Authentication is temporarily unavailable."));
    });
  };

  const getSession: RequestHandler = (req, res) => {
    const user = (req.session as any).user;

    if (!user) {
      res
        .status(401)
        .json(authErrorBody("AUTH_SESSION_REQUIRED", "Sign in is required."));
      return;
    }

    res.json({ user, sessionId: req.sessionID });
  };

  const logout: RequestHandler = (req, res) => {
    req.session.destroy((error) => {
      if (error) {
        logAuthError("AUTH_LOGOUT_ERROR", error);
        res
          .status(500)
          .json(authErrorBody("AUTH_INTERNAL", "Authentication is temporarily unavailable."));
        return;
      }

      res.clearCookie(env.sessionCookieName, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
      });
      res.json({ ok: true });
    });
  };

  const getCsrf: RequestHandler = (_req, res) => {
    res.json({ csrfToken: "dev-csrf-token" });
  };

  const requestPasswordReset: RequestHandler = (req, res) => {
    void (async () => {
      const resetRequest = req.body as PasswordResetRequest;
      if (!isValidEmail(resetRequest?.email)) {
        res
          .status(400)
          .json(authErrorBody("AUTH_INVALID_REQUEST", "Enter a valid email address."));
        return;
      }

      const result = await authService.requestPasswordReset(resetRequest);
      console.log(
        `${new Date().toISOString()} PASSWORD_RESET_REQUEST email=${resetRequest.email.trim().toLowerCase()} matchedUser=${result.matchedUser}`,
      );
      res.status(202).json({
        ok: true,
        message: "If an account exists for that email, reset instructions will be sent.",
      });
    })().catch((error: unknown) => {
      logAuthError("AUTH_PASSWORD_RESET_ERROR", error);
      res
        .status(500)
        .json(authErrorBody("AUTH_INTERNAL", "Authentication is temporarily unavailable."));
    });
  };

  return {
    login,
    getSession,
    logout,
    getCsrf,
    requestPasswordReset,
  };
}
