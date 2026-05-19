import { Request, Response } from "express";
import { errorBody } from "../types/http";

export function notFoundHandler(req: Request, res: Response) {
  if (req.path.startsWith("/v1/")) {
    res.status(404).json(errorBody("NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
    return;
  }

  res.status(404).json(errorBody("NOT_FOUND", "Route not found"));
}
