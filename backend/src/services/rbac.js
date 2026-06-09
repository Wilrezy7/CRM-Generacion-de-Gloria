export const ROLES = ["ADMIN", "PASTOR", "SECRETARIA", "LIDER", "MENTOR"];

export const PERMISSIONS = {
  ADMIN: ["*"],
  PASTOR: [
    "dashboard:read",
    "youths:read",
    "attendance:read",
    "interactions:read",
    "interactions:write",
    "alerts:read",
    "consolidation:read",
    "reports:read"
  ],
  SECRETARIA: [
    "dashboard:read",
    "youths:read",
    "youths:write",
    "attendance:read",
    "attendance:write",
    "interactions:read",
    "alerts:read",
    "consolidation:read",
    "consolidation:write",
    "reports:read"
  ],
  LIDER: [
    "dashboard:read",
    "youths:read",
    "attendance:read",
    "attendance:write",
    "interactions:read",
    "interactions:write",
    "alerts:read",
    "consolidation:read",
    "consolidation:write"
  ],
  MENTOR: [
    "dashboard:read",
    "youths:read",
    "interactions:read",
    "interactions:write",
    "alerts:read"
  ]
};

export const ROLE_LABELS = {
  ADMIN: "Administrador",
  PASTOR: "Pastor",
  SECRETARIA: "Secretaria",
  LIDER: "Lider",
  MENTOR: "Mentor"
};

export const normalizeRole = (role) => {
  const value = String(role || "").trim().toUpperCase();
  if (value === "ASISTENTE") return "SECRETARIA";
  if (value === "LIDER" || value === "LÍDER") return "LIDER";
  return ROLES.includes(value) ? value : "MENTOR";
};

export const getPermissions = (role) => PERMISSIONS[normalizeRole(role)] || [];

export const hasPermission = (user, permission) => {
  const permissions = getPermissions(user?.role);
  return permissions.includes("*") || permissions.includes(permission);
};

export const requirePermission = (user, permission) => {
  if (hasPermission(user, permission)) return true;
  const error = new Error("No tienes permisos para realizar esta accion.");
  error.status = 403;
  throw error;
};
