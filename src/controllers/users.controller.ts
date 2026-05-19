import { RequestHandler } from "express";
import { errorBody } from "../types/http";
import { UsersService } from "../services/users.service";

const ALLOWED_ROLE_FILTERS = new Set(["agent", "admin"]);

export function createUsersController(usersService: UsersService) {
  const listUsers: RequestHandler = (req, res) => {
    const roleQuery = Array.isArray(req.query.role) ? req.query.role[0] : req.query.role;
    const role = typeof roleQuery === "string" ? roleQuery.trim().toLowerCase() : undefined;

    if (role && !ALLOWED_ROLE_FILTERS.has(role)) {
      res.status(400).json(errorBody("BAD_REQUEST", "role must be one of: agent, admin"));
      return;
    }

    void usersService
      .getAll(role)
      .then((users) => {
        res.json(users);
      })
      .catch((error: unknown) => {
        res.status(500).json(
          errorBody(
            "INTERNAL_ERROR",
            error instanceof Error ? error.message : "Failed to load users",
          ),
        );
      });
  };

  return {
    listUsers,
  };
}
