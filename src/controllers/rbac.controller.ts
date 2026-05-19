import { RequestHandler } from "express";
import { RbacRepo } from "../repos/RbacRepo";

export function createRbacController(rbacRepo: RbacRepo) {
  const listPermissions: RequestHandler = (_req, res) => {
    void rbacRepo
      .listPermissions()
      .then((permissions) => {
        res.json(permissions);
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message:
              error instanceof Error ? error.message : "Failed to load RBAC permissions",
          },
        });
      });
  };

  return {
    listPermissions,
  };
}
