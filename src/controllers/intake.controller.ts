import { RequestHandler } from "express";
import { MembersService } from "../services/members.service";
import { errorBody, IntakeSearchType } from "../types/http";

const ALLOWED_TYPES: ReadonlySet<IntakeSearchType> = new Set([
  "auto",
  "phone",
  "memberId",
  "caseId",
  "claimId",
  "name",
]);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export function createIntakeController(membersService: MembersService) {
  const searchIntake: RequestHandler = (req, res) => {
    const rawQ = req.query.q;
    const rawType = req.query.type ?? "auto";
    const rawLimit = req.query.limit;

    const q = typeof rawQ === "string" ? rawQ.trim() : "";
    if (!q) {
      res.status(400).json(errorBody("BAD_REQUEST", "q is required"));
      return;
    }

    const type = typeof rawType === "string" && ALLOWED_TYPES.has(rawType as IntakeSearchType)
      ? (rawType as IntakeSearchType)
      : "auto";

    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
      const parsed = typeof rawLimit === "string" ? Number.parseInt(rawLimit, 10) : NaN;
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        res.status(400).json(errorBody("BAD_REQUEST", `limit must be an integer between 1 and ${MAX_LIMIT}`));
        return;
      }
      limit = parsed;
    }

    void membersService
      .searchIntakeCandidates({ q, type, limit })
      .then((items) => {
        res.json({ items });
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Failed to run intake search",
          },
        });
      });
  };

  return { searchIntake };
}
