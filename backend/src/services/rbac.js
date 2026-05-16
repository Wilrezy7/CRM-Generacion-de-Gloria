export const SYSTEM_ROLES = {
  ADMIN: "ADMIN",
  PASTOR: "PASTOR",
  LIDER: "LIDER",
  MENTOR: "MENTOR",
  SECRETARIA: "SECRETARIA"
};

export const ALLOWED_SYSTEM_ROLES = Object.values(SYSTEM_ROLES);

export const MEMBER_ROLES = {
  ADMIN: "Administrador",
  PASTOR: "Pastor",
  LIDER: "Lider",
  MENTOR: "Mentor",
  SECRETARIA: "Secretaria",
  MIEMBRO: "Miembro",
  VISITANTE: "Visitante",
  NUEVO: "Nuevo",
  CONGREGANTE: "Congregante"
};

export const ROLE_LABELS = {
  [SYSTEM_ROLES.ADMIN]: "Administrador",
  [SYSTEM_ROLES.PASTOR]: "Pastor",
  [SYSTEM_ROLES.LIDER]: "Lider",
  [SYSTEM_ROLES.MENTOR]: "Mentor",
  [SYSTEM_ROLES.SECRETARIA]: "Secretaria"
};

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard:view",
  MEMBERS_VIEW: "members:view",
  MEMBERS_CREATE: "members:create",
  MEMBERS_UPDATE: "members:update",
  MEMBERS_DELETE: "members:delete",
  MEMBERS_ASSIGN: "members:assign",
  MEMBERS_IMPORT: "members:import",
  ATTENDANCE_VIEW: "attendance:view",
  ATTENDANCE_CREATE: "attendance:create",
  INTERACTIONS_VIEW: "interactions:view",
  INTERACTIONS_CREATE: "interactions:create",
  ALERTS_VIEW: "alerts:view",
  ALERTS_ATTEND: "alerts:attend",
  USERS_VIEW: "users:view",
  USERS_MANAGE: "users:manage",
  REPORTS_VIEW: "reports:view",
  REPORTS_GENERATE: "reports:generate",
  REPORTS_EXPORT: "reports:export",
  SETTINGS_MANAGE: "settings:manage"
};

const allPermissions = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS = {
  [SYSTEM_ROLES.ADMIN]: allPermissions,
  [SYSTEM_ROLES.PASTOR]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.MEMBERS_VIEW,
    PERMISSIONS.MEMBERS_CREATE,
    PERMISSIONS.MEMBERS_UPDATE,
    PERMISSIONS.MEMBERS_ASSIGN,
    PERMISSIONS.MEMBERS_IMPORT,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_CREATE,
    PERMISSIONS.INTERACTIONS_VIEW,
    PERMISSIONS.INTERACTIONS_CREATE,
    PERMISSIONS.ALERTS_VIEW,
    PERMISSIONS.ALERTS_ATTEND,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.REPORTS_EXPORT
  ],
  [SYSTEM_ROLES.LIDER]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.MEMBERS_VIEW,
    PERMISSIONS.MEMBERS_CREATE,
    PERMISSIONS.MEMBERS_UPDATE,
    PERMISSIONS.MEMBERS_ASSIGN,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_CREATE,
    PERMISSIONS.INTERACTIONS_VIEW,
    PERMISSIONS.INTERACTIONS_CREATE,
    PERMISSIONS.ALERTS_VIEW,
    PERMISSIONS.ALERTS_ATTEND
  ],
  [SYSTEM_ROLES.MENTOR]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.MEMBERS_VIEW,
    PERMISSIONS.MEMBERS_UPDATE,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_CREATE,
    PERMISSIONS.INTERACTIONS_VIEW,
    PERMISSIONS.INTERACTIONS_CREATE,
    PERMISSIONS.ALERTS_VIEW,
    PERMISSIONS.ALERTS_ATTEND
  ],
  [SYSTEM_ROLES.SECRETARIA]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.MEMBERS_VIEW,
    PERMISSIONS.MEMBERS_CREATE,
    PERMISSIONS.MEMBERS_UPDATE,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_CREATE,
    PERMISSIONS.INTERACTIONS_VIEW,
    PERMISSIONS.INTERACTIONS_CREATE,
    PERMISSIONS.ALERTS_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_GENERATE,
    PERMISSIONS.REPORTS_EXPORT
  ]
};

export const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export const normalizeMemberRole = (value, fallback = null) => {
  const map = {
    admin: MEMBER_ROLES.ADMIN,
    administrador: MEMBER_ROLES.ADMIN,
    administradora: MEMBER_ROLES.ADMIN,
    pastor: MEMBER_ROLES.PASTOR,
    pastora: MEMBER_ROLES.PASTOR,
    lider: MEMBER_ROLES.LIDER,
    leader: MEMBER_ROLES.LIDER,
    co_lider: MEMBER_ROLES.LIDER,
    colider: MEMBER_ROLES.LIDER,
    mentor: MEMBER_ROLES.MENTOR,
    mentora: MEMBER_ROLES.MENTOR,
    secretaria: MEMBER_ROLES.SECRETARIA,
    secretario: MEMBER_ROLES.SECRETARIA,
    miembro: MEMBER_ROLES.MIEMBRO,
    integrante: MEMBER_ROLES.MIEMBRO,
    visitante: MEMBER_ROLES.VISITANTE,
    nuevo: MEMBER_ROLES.NUEVO,
    nueva: MEMBER_ROLES.NUEVO,
    congregante: MEMBER_ROLES.CONGREGANTE
  };
  return map[normalizeKey(value)] || fallback;
};

export const normalizeSystemRole = (value, fallback = null) => {
  const map = {
    admin: SYSTEM_ROLES.ADMIN,
    administrador: SYSTEM_ROLES.ADMIN,
    administradora: SYSTEM_ROLES.ADMIN,
    pastor: SYSTEM_ROLES.PASTOR,
    pastora: SYSTEM_ROLES.PASTOR,
    lider: SYSTEM_ROLES.LIDER,
    leader: SYSTEM_ROLES.LIDER,
    mentor: SYSTEM_ROLES.MENTOR,
    mentora: SYSTEM_ROLES.MENTOR,
    asistente: SYSTEM_ROLES.MENTOR,
    secretaria: SYSTEM_ROLES.SECRETARIA,
    secretario: SYSTEM_ROLES.SECRETARIA
  };
  return map[normalizeKey(value)] || fallback;
};

export const systemRoleFromMemberRole = (memberRole) => {
  const normalized = normalizeMemberRole(memberRole, MEMBER_ROLES.MIEMBRO);
  return {
    [MEMBER_ROLES.ADMIN]: SYSTEM_ROLES.ADMIN,
    [MEMBER_ROLES.PASTOR]: SYSTEM_ROLES.PASTOR,
    [MEMBER_ROLES.LIDER]: SYSTEM_ROLES.LIDER,
    [MEMBER_ROLES.MENTOR]: SYSTEM_ROLES.MENTOR,
    [MEMBER_ROLES.SECRETARIA]: SYSTEM_ROLES.SECRETARIA,
    [MEMBER_ROLES.MIEMBRO]: null,
    [MEMBER_ROLES.VISITANTE]: null,
    [MEMBER_ROLES.NUEVO]: null,
    [MEMBER_ROLES.CONGREGANTE]: null
  }[normalized];
};

export const getRolePermissions = (role) =>
  ROLE_PERMISSIONS[normalizeSystemRole(role)] || [];

export const hasPermission = (user, permission) =>
  Boolean(user && getRolePermissions(user.role).includes(permission));

export const requirePermission = (user, permission, message = "No tienes permiso para esta accion.") => {
  if (hasPermission(user, permission)) return;
  const error = new Error(message);
  error.status = 403;
  throw error;
};

export const canAccessAllMembers = (user) =>
  [SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.PASTOR, SYSTEM_ROLES.LIDER, SYSTEM_ROLES.SECRETARIA].includes(
    normalizeSystemRole(user?.role)
  );

export const canManageAssignments = (user) =>
  hasPermission(user, PERMISSIONS.MEMBERS_ASSIGN);

export const canAccessYouth = (user, youth) => {
  if (!user || !youth) return false;
  if (canAccessAllMembers(user)) return true;
  const role = normalizeSystemRole(user.role);
  if (role === SYSTEM_ROLES.MENTOR) {
    return youth.assignedUserId === user.id || youth.id === user.memberId;
  }
  return youth.id === user.memberId;
};

export const canBeAssignedAsMentor = (user) =>
  [SYSTEM_ROLES.PASTOR, SYSTEM_ROLES.LIDER, SYSTEM_ROLES.MENTOR].includes(
    normalizeSystemRole(user?.role)
  ) && user?.active !== false;
