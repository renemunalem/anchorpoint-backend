import { NextFunction, Request, Response } from "express";
import { errorBody } from "../types/http";

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const user = (req.session as any)?.user;
  const sessionId = req.sessionID;

  if (!user || !sessionId) {
    res.status(401).json(errorBody("UNAUTHORIZED", "Session expired or unauthorized"));
    return;
  }

  next();
}
