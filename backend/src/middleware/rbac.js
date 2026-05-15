import { requirePermission } from "../services/rbac.js";

export const requireUserPermission = (user, permission, message) =>
  requirePermission(user, permission, message);
