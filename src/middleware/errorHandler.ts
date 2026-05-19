import { NextFunction, Request, Response } from "express";
import { errorBody } from "../types/http";

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  console.error("Unhandled error:", error);
  res.status(500).json(errorBody("INTERNAL_ERROR", "Unexpected server error"));
}
