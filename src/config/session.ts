import session from "express-session";
import { env } from "./env";

export const persistentSessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

export const sessionMiddleware = session({
  name: env.sessionCookieName,
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
  },
});
