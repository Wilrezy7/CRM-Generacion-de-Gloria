import { readDb, writeDb } from "../repositories/database.js";
import {
  createId,
  normalizeText,
  nowIso,
  sameMonth,
  sameWeek,
  sortByDateDesc
} from "../utils/helpers.js";
import { comparePassword, hashPassword } from "../utils/security.js";
import {
  MEMBER_ROLES,
  PERMISSIONS,
  ROLE_LABELS,
  canAccessAllMembers,
  canAccessYouth,
  canBeAssignedAsMentor,
  canManageAssignments,
  getRolePermissions,
  normalizeMemberRole,
  normalizeSystemRole,
  requirePermission,
  systemRoleFromMemberRole
} from "./rbac.js";

const youthVisibilityFilter = (user) => (youth) =>
  canAccessYouth(user, youth);

const ensureYouthAccess = (user, youth) => {
  if (!youth) {
    const error = new Error("Joven no encontrado.");
    error.status = 404;
    throw error;
  }
  if (canAccessYouth(user, youth)) {
    return youth;
  }
  const error = new Error("No tienes acceso a este joven.");
  error.status = 403;
  throw error;
};

const ensurePermission = (user, permission, message) =>
  requirePermission(user, permission, message);

const defaultSyncedPasswordHash = () => hashPassword("Cambio123*");

const syncUsersFromMembers = (data) => {
  data.users = Array.isArray(data.users) ? data.users : [];
  data.youths = Array.isArray(data.youths) ? data.youths : [];

  data.users = data.users.map((user) => ({
    assignedYouthIds: [],
    active: true,
    ...user,
    role: normalizeSystemRole(user.role),
    assignedYouthIds: Array.isArray(user.assignedYouthIds)
      ? user.assignedYouthIds
      : []
  }));

  const usersByMemberId = new Map(
    data.users.filter((user) => user.memberId).map((user) => [user.memberId, user])
  );
  const usersByEmail = new Map(
    data.users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user])
  );

  data.youths = data.youths.map((youth) => ({
    ...youth,
    memberRole: normalizeMemberRole(youth.memberRole || youth.rol || youth.role, MEMBER_ROLES.MIEMBRO)
  }));

  for (const youth of data.youths) {
    const email = normalizeText(youth.email).toLowerCase();
    if (!email) continue;

    const role = systemRoleFromMemberRole(youth.memberRole);
    let account = usersByMemberId.get(youth.id) || usersByEmail.get(email);

    if (!account) {
      account = {
        id: createId("usr"),
        passwordHash: defaultSyncedPasswordHash(),
        createdAt: nowIso(),
        assignedYouthIds: []
      };
      data.users.push(account);
    }

    account.memberId = youth.id;
    account.fullName = youth.fullName;
    account.email = email;
    account.role = role;
    account.memberRole = youth.memberRole;
    account.active = youth.status !== "inactivo";
    account.passwordHash = account.passwordHash || defaultSyncedPasswordHash();

    usersByMemberId.set(youth.id, account);
    usersByEmail.set(email, account);
  }

  const memberIds = new Set(data.youths.map((youth) => youth.id));
  data.users = data.users.map((user) =>
    user.memberId && !memberIds.has(user.memberId)
      ? { ...user, active: false, assignedYouthIds: [] }
      : user
  );

  const assignedByUser = new Map(data.users.map((user) => [user.id, []]));
  const validUserIds = new Set(data.users.map((user) => user.id));
  const assignableMentorIds = new Set(
    data.users.filter(canBeAssignedAsMentor).map((user) => user.id)
  );

  data.youths = data.youths.map((youth) => {
    if (!youth.assignedUserId) return youth;
    if (!validUserIds.has(youth.assignedUserId) || !assignableMentorIds.has(youth.assignedUserId)) {
      return { ...youth, assignedUserId: null };
    }
    assignedByUser.get(youth.assignedUserId).push(youth.id);
    return youth;
  });

  data.users = data.users.map((user) => ({
    ...user,
    role: normalizeSystemRole(user.role),
    assignedYouthIds: assignedByUser.get(user.id) || []
  }));
};

const sanitizeUserWithAssignments = (data, user) => ({
  ...sanitizeUser(user),
  assignedYouthIds: data.youths
    .filter((youth) => youth.assignedUserId === user.id)
    .map((youth) => youth.id)
});

const serializeYouth = (data, youth) => {
  const account = data.users.find((user) => user.memberId === youth.id) || null;
  const assignedMentor = youth.assignedUserId
    ? data.users.find((user) => user.id === youth.assignedUserId) || null
    : null;
  return {
    ...youth,
    accountId: account?.id || null,
    accountRole: account?.role || null,
    assignedMentor: assignedMentor ? sanitizeUser(assignedMentor) : null
  };
};

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const validateYouthPayload = (payload) => {
  const fullName = normalizeText(payload.fullName);
  const documentId = normalizeText(payload.documentId || payload.cedula);
  const address = normalizeText(payload.address);
  const phone = normalizeText(payload.phone);
  const email = normalizeText(payload.email).toLowerCase();
  const birthDate = normalizeText(payload.birthDate || payload.fechaNacimiento);
  const baptizedRaw = normalizeText(payload.baptized || payload.bautizado || "NO");
  const memberRole = normalizeText(
    payload.memberRole || payload.rolMiembro || payload.role || "Miembro"
  );
  const joinDate = normalizeText(payload.joinDate);
  const status = normalizeText(payload.status || "activo").toLowerCase();
  const age = Number(payload.age);
  if (!fullName || !documentId || !phone || !birthDate) {
    const error = new Error("Datos del joven incompletos o invalidos.");
    error.status = 400;
    throw error;
  }
  if (!["activo", "inactivo"].includes(status)) {
    const error = new Error("Estado no valido.");
    error.status = 400;
    throw error;
  }
  const normalizedRole = normalizeMemberRole(memberRole);
  if (!normalizedRole) {
    const error = new Error("Rol ministerial no valido.");
    error.status = 400;
    throw error;
  }
  const baptizedNormalized = ["SI", "NO"].includes(baptizedRaw.toUpperCase())
    ? baptizedRaw.toUpperCase()
    : null;
  if (!baptizedNormalized) {
    const error = new Error("El campo bautizados solo permite SI o NO.");
    error.status = 400;
    throw error;
  }
  const derivedAge =
    Number.isNaN(age) || age <= 0
      ? Math.max(
          0,
          new Date().getFullYear() - new Date(`${birthDate}T00:00:00`).getFullYear()
        )
      : age;
  return {
    fullName,
    documentId,
    age: derivedAge,
    phone,
    email,
    birthDate,
    baptized: baptizedNormalized,
    memberRole: normalizedRole,
    address,
    joinDate: joinDate || new Date().toISOString().slice(0, 10),
    status,
    assignedUserId: payload.assignedUserId || null,
    notes: normalizeText(payload.notes)
  };
};

const validateUserPayload = (payload) => {
  const fullName = normalizeText(payload.fullName);
  const email = normalizeText(payload.email).toLowerCase();
  const role = normalizeSystemRole(payload.role, null);
  if (!fullName || !email || !role) {
    const error = new Error("Datos de usuario invalidos.");
    error.status = 400;
    throw error;
  }
  return {
    fullName,
    email,
    role,
    active: payload.active !== false,
    assignedYouthIds: Array.isArray(payload.assignedYouthIds)
      ? payload.assignedYouthIds
      : []
  };
};

const recalculateAlerts = (data) => {
  const attendedAlerts = data.alerts.filter((alert) => alert.status === "atendida");
  const autoAlerts = [];
  const sessions = [...data.attendanceSessions].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  for (const youth of data.youths) {
    let misses = 0;
    let lastAbsentDate = null;
    for (const session of sessions) {
      const record = session.attendance.find((item) => item.youthId === youth.id);
      if (!record) continue;
      if (record.present) {
        misses = 0;
      } else {
        misses += 1;
        lastAbsentDate = session.date;
      }
      if (misses >= 2) {
        const generatedAt = `${lastAbsentDate}T00:00:00.000Z`;
        const alreadyHandled = attendedAlerts.some(
          (alert) =>
            alert.youthId === youth.id &&
            alert.reason === "2 ausencias consecutivas" &&
            alert.generatedAt === generatedAt
        );
        if (alreadyHandled) {
          misses = 0;
          lastAbsentDate = null;
          continue;
        }
        autoAlerts.push({
          id: `auto_${youth.id}_${lastAbsentDate.replace(/[^0-9]/g, "")}`,
          youthId: youth.id,
          reason: "2 ausencias consecutivas",
          status: "pendiente",
          generatedAt,
          attendedAt: null,
          attendedBy: null
        });
        break;
      }
    }
  }

  data.alerts = [...attendedAlerts, ...autoAlerts];
};

export const sanitizeUser = (user) => {
  const { passwordHash, ...safeUser } = user;
  const role = normalizeSystemRole(safeUser.role);
  return {
    ...safeUser,
    role,
    roleLabel: ROLE_LABELS[role] || role,
    permissions: getRolePermissions(role)
  };
};

export const getSetupStatus = async () => {
  const data = await readDb();
  return {
    setupRequired: data.users.length === 0,
    totalUsers: data.users.length
  };
};

export const bootstrapSystem = async (payload) => {
  const data = await readDb();
  if (data.users.length > 0) {
    const error = new Error("El sistema ya fue inicializado.");
    error.status = 400;
    throw error;
  }

  const fullName = normalizeText(payload.fullName);
  const email = normalizeText(payload.email).toLowerCase();
  const password = String(payload.password || "");
  const churchName = normalizeText(payload.churchName) || data.meta.churchName;

  if (!fullName || !email || password.length < 8) {
    const error = new Error(
      "Debes indicar nombre, correo y una contrasena de al menos 8 caracteres."
    );
    error.status = 400;
    throw error;
  }

  const admin = {
    id: createId("usr"),
    fullName,
    email,
    passwordHash: hashPassword(password),
    role: "ADMIN",
    memberRole: MEMBER_ROLES.ADMIN,
    assignedYouthIds: [],
    active: true,
    createdAt: nowIso()
  };

  data.meta = {
    ...data.meta,
    churchName,
    updatedAt: nowIso()
  };
  data.users = [admin];
  await writeDb(data);
  return sanitizeUser(admin);
};

export const login = async ({ email, password }) => {
  const data = await readDb();
  syncUsersFromMembers(data);
  await writeDb(data);
  if (!data.users.length) {
    const error = new Error("El sistema aun no ha sido configurado.");
    error.status = 403;
    throw error;
  }
  const user = data.users.find((item) => item.email === String(email).toLowerCase());
  if (!user || !comparePassword(String(password || ""), user.passwordHash)) {
    const error = new Error("Credenciales invalidas.");
    error.status = 401;
    throw error;
  }
  if (user.active === false) {
    const error = new Error("Usuario inactivo. Solicita reactivacion al administrador.");
    error.status = 403;
    throw error;
  }
  return sanitizeUser(user);
};

export const getDashboard = async (user) => {
  const data = await readDb();
  ensurePermission(user, PERMISSIONS.DASHBOARD_VIEW);
  const visibleYouths = data.youths.filter(youthVisibilityFilter(user));
  const visibleIds = new Set(visibleYouths.map((item) => item.id));
  const recentInteractions = sortByDateDesc(
    data.interactions.filter((item) => visibleIds.has(item.youthId)),
    "date"
  ).slice(0, 6);
  const alerts = data.alerts.filter(
    (item) => visibleIds.has(item.youthId) && item.status === "pendiente"
  );
  const now = new Date();
  const attendanceSessions = data.attendanceSessions;
  const sessionStats = attendanceSessions.map((session) => {
    const records = session.attendance.filter((item) => visibleIds.has(item.youthId));
    const present = records.filter((item) => item.present).length;
    const total = records.length;
    return {
      id: session.id,
      title: session.title,
      date: session.date,
      serviceType: session.serviceType,
      present,
      total,
      percent: total ? Math.round((present / total) * 100) : 0
    };
  });
  const weekly = sessionStats.filter((item) => sameWeek(item.date, now));
  const monthly = sessionStats.filter((item) => sameMonth(item.date, now));

  return {
    summary: {
      totalYouths: visibleYouths.length,
      activeYouths: visibleYouths.filter((item) => item.status === "activo").length,
      weeklyAttendance:
        weekly.length
          ? Math.round(
              weekly.reduce((acc, item) => acc + item.percent, 0) / weekly.length
            )
          : 0,
      monthlyAttendance:
        monthly.length
          ? Math.round(
              monthly.reduce((acc, item) => acc + item.percent, 0) / monthly.length
            )
          : 0,
      pendingAlerts: alerts.length,
      followUpsThisMonth: data.interactions.filter(
        (item) => visibleIds.has(item.youthId) && sameMonth(item.date, now)
      ).length
    },
    attendanceTrend: sessionStats.slice(-8),
    recentInteractions,
    alerts: alerts.map((alert) => ({
      ...alert,
      youth: visibleYouths.find((item) => item.id === alert.youthId) || null
    }))
  };
};

export const listYouths = async (user, query) => {
  const data = await readDb();
  ensurePermission(user, PERMISSIONS.MEMBERS_VIEW);
  const search = normalizeText(query.search).toLowerCase();
  const status = normalizeText(query.status).toLowerCase();
  const assignedUserId = normalizeText(query.assignedUserId);
  return data.youths
    .filter(youthVisibilityFilter(user))
    .filter((item) => !status || item.status === status)
    .filter((item) => !assignedUserId || item.assignedUserId === assignedUserId)
    .filter((item) => {
      if (!search) return true;
      return [item.fullName, item.phone, item.address]
        .concat([item.documentId, item.email, item.memberRole])
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .map((item) => serializeYouth(data, item))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
};

export const createYouth = async (user, payload) => {
  ensurePermission(user, PERMISSIONS.MEMBERS_CREATE, "No tienes permiso para crear miembros.");
  const data = await readDb();
  const record = {
    id: createId("yth"),
    ...validateYouthPayload(payload),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (!canManageAssignments(user)) {
    record.assignedUserId = user.id;
  }
  data.youths.push(record);
  syncUsersFromMembers(data);
  await writeDb(data);
  return serializeYouth(data, record);
};

export const updateYouth = async (user, youthId, payload) => {
  ensurePermission(user, PERMISSIONS.MEMBERS_UPDATE, "No tienes permiso para editar miembros.");
  const data = await readDb();
  const index = data.youths.findIndex((item) => item.id === youthId);
  const current = ensureYouthAccess(user, data.youths[index]);
  const next = {
    ...current,
    ...validateYouthPayload({ ...current, ...payload }),
    updatedAt: nowIso()
  };
  if (!canManageAssignments(user) && next.id !== user.memberId) {
    next.assignedUserId = user.id;
  }
  data.youths[index] = next;
  syncUsersFromMembers(data);
  await writeDb(data);
  return serializeYouth(data, data.youths[index]);
};

export const deleteYouth = async (user, youthId) => {
  ensurePermission(user, PERMISSIONS.MEMBERS_DELETE, "Solo el administrador puede eliminar miembros.");
  const data = await readDb();
  const youth = data.youths.find((item) => item.id === youthId);
  ensureYouthAccess(user, youth);
  data.youths = data.youths.filter((item) => item.id !== youthId);
  data.attendanceSessions = data.attendanceSessions.map((session) => ({
    ...session,
    attendance: session.attendance.filter((item) => item.youthId !== youthId)
  }));
  data.interactions = data.interactions.filter((item) => item.youthId !== youthId);
  data.alerts = data.alerts.filter((item) => item.youthId !== youthId);
  syncUsersFromMembers(data);
  await writeDb(data);
  return true;
};

export const listAttendance = async (user) => {
  const data = await readDb();
  ensurePermission(user, PERMISSIONS.ATTENDANCE_VIEW);
  const visibleIds = new Set(
    data.youths.filter(youthVisibilityFilter(user)).map((item) => item.id)
  );
  return sortByDateDesc(
    data.attendanceSessions
      .map((session) => ({
        ...session,
        attendance: session.attendance.filter((item) => visibleIds.has(item.youthId))
      }))
      .filter((session) => session.attendance.length),
    "date"
  );
};

export const createAttendanceSession = async (user, payload) => {
  ensurePermission(user, PERMISSIONS.ATTENDANCE_CREATE, "No tienes permiso para registrar asistencia.");
  const data = await readDb();
  const title = normalizeText(payload.title);
  const date = normalizeText(payload.date);
  const serviceType = normalizeText(payload.serviceType || "servicio");
  if (!title || !date) {
    const error = new Error("Debes indicar titulo y fecha.");
    error.status = 400;
    throw error;
  }
  const allowedYouths = data.youths.filter(youthVisibilityFilter(user));
  const allowedIds = new Set(allowedYouths.map((item) => item.id));
  const incoming = Array.isArray(payload.attendance) ? payload.attendance : [];
  const attendance = allowedYouths.map((youth) => {
    const row = incoming.find((item) => item.youthId === youth.id);
    return {
      youthId: youth.id,
      present: Boolean(row?.present)
    };
  });
  if (incoming.some((item) => !allowedIds.has(item.youthId))) {
    const error = new Error("Intentaste registrar asistencia sobre jovenes no asignados.");
    error.status = 403;
    throw error;
  }
  const record = {
    id: createId("att"),
    title,
    date,
    serviceType,
    notes: normalizeText(payload.notes),
    attendance,
    createdAt: nowIso()
  };
  data.attendanceSessions.push(record);
  recalculateAlerts(data);
  await writeDb(data);
  return record;
};

export const getYouthTimeline = async (user, youthId) => {
  const data = await readDb();
  const youth = ensureYouthAccess(user, data.youths.find((item) => item.id === youthId));
  const attendanceHistory = sortByDateDesc(
    data.attendanceSessions
      .map((session) => ({
        id: session.id,
        title: session.title,
        date: session.date,
        serviceType: session.serviceType,
        record: session.attendance.find((item) => item.youthId === youthId) || null
      }))
      .filter((item) => item.record),
    "date"
  );
  const interactions = sortByDateDesc(
    data.interactions.filter((item) => item.youthId === youthId),
    "date"
  );
  const alerts = sortByDateDesc(
    data.alerts.filter((item) => item.youthId === youthId),
    "generatedAt"
  );
  return { youth: serializeYouth(data, youth), attendanceHistory, interactions, alerts };
};

export const listInteractions = async (user) => {
  const data = await readDb();
  ensurePermission(user, PERMISSIONS.INTERACTIONS_VIEW);
  const visibleIds = new Set(
    data.youths.filter(youthVisibilityFilter(user)).map((item) => item.id)
  );
  return sortByDateDesc(
    data.interactions
      .filter((item) => visibleIds.has(item.youthId))
      .map((item) => ({
        ...item,
        youth: data.youths.find((youth) => youth.id === item.youthId)
          ? serializeYouth(data, data.youths.find((youth) => youth.id === item.youthId))
          : null
      })),
    "date"
  );
};

export const createInteraction = async (user, payload) => {
  ensurePermission(user, PERMISSIONS.INTERACTIONS_CREATE, "No tienes permiso para registrar seguimientos.");
  const data = await readDb();
  const youth = ensureYouthAccess(
    user,
    data.youths.find((item) => item.id === payload.youthId)
  );
  const type = normalizeText(payload.type).toLowerCase();
  const date = normalizeText(payload.date);
  if (!["llamada", "visita"].includes(type) || !date) {
    const error = new Error("Tipo o fecha invalidos.");
    error.status = 400;
    throw error;
  }
  const interaction = {
    id: createId("int"),
    youthId: youth.id,
    type,
    date,
    observations: normalizeText(payload.observations),
    pastoralNotes: normalizeText(payload.pastoralNotes),
    createdBy: user.id,
    createdAt: nowIso()
  };
  data.interactions.push(interaction);
  await writeDb(data);
  return interaction;
};

export const listAlerts = async (user) => {
  const data = await readDb();
  ensurePermission(user, PERMISSIONS.ALERTS_VIEW);
  const visibleIds = new Set(
    data.youths.filter(youthVisibilityFilter(user)).map((item) => item.id)
  );
  return sortByDateDesc(
    data.alerts
      .filter((item) => visibleIds.has(item.youthId))
      .map((item) => ({
        ...item,
        youth: data.youths.find((youth) => youth.id === item.youthId)
          ? serializeYouth(data, data.youths.find((youth) => youth.id === item.youthId))
          : null
      })),
    "generatedAt"
  );
};

export const attendAlert = async (user, alertId) => {
  ensurePermission(user, PERMISSIONS.ALERTS_ATTEND, "No tienes permiso para atender alertas.");
  const data = await readDb();
  const index = data.alerts.findIndex((item) => item.id === alertId);
  const alert = data.alerts[index];
  if (!alert) {
    const error = new Error("Alerta no encontrada.");
    error.status = 404;
    throw error;
  }
  ensureYouthAccess(user, data.youths.find((item) => item.id === alert.youthId));
  data.alerts[index] = {
    ...alert,
    status: "atendida",
    attendedAt: nowIso(),
    attendedBy: user.id
  };
  await writeDb(data);
  return data.alerts[index];
};

export const listUsers = async (user) => {
  ensurePermission(user, PERMISSIONS.USERS_VIEW, "Solo el administrador puede ver usuarios.");
  const data = await readDb();
  syncUsersFromMembers(data);
  await writeDb(data);
  return data.users.map((item) => sanitizeUserWithAssignments(data, item));
};

export const createUser = async (user, payload) => {
  ensurePermission(user, PERMISSIONS.USERS_MANAGE, "Solo el administrador puede crear usuarios.");
  const data = await readDb();
  const sanitized = validateUserPayload(payload);
  if (data.users.some((item) => item.email === sanitized.email)) {
    const error = new Error("Ya existe un usuario con ese correo.");
    error.status = 400;
    throw error;
  }
  const created = {
    id: createId("usr"),
    ...sanitized,
    passwordHash: hashPassword(normalizeText(payload.password) || "Cambio123*"),
    createdAt: nowIso()
  };
  data.users.push(created);
  data.youths = data.youths.map((youth) =>
    created.assignedYouthIds.includes(youth.id)
      ? { ...youth, assignedUserId: created.id }
      : youth
  );
  syncUsersFromMembers(data);
  await writeDb(data);
  return sanitizeUserWithAssignments(data, created);
};

export const updateUser = async (user, userId, payload) => {
  ensurePermission(user, PERMISSIONS.USERS_MANAGE, "Solo el administrador puede editar usuarios.");
  const data = await readDb();
  const index = data.users.findIndex((item) => item.id === userId);
  if (index === -1) {
    const error = new Error("Usuario no encontrado.");
    error.status = 404;
    throw error;
  }
  const current = data.users[index];
  const sanitized = validateUserPayload({ ...current, ...payload });
  const updated = {
    ...current,
    ...sanitized,
    passwordHash: payload.password
      ? hashPassword(normalizeText(payload.password))
      : current.passwordHash
  };
  data.users[index] = updated;
  data.youths = data.youths.map((youth) => {
    if (updated.assignedYouthIds.includes(youth.id)) {
      return { ...youth, assignedUserId: updated.id };
    }
    if (youth.assignedUserId === updated.id) {
      return { ...youth, assignedUserId: null };
    }
    return youth;
  });
  syncUsersFromMembers(data);
  await writeDb(data);
  return sanitizeUserWithAssignments(data, data.users[index]);
};

export const deleteUser = async (user, userId) => {
  ensurePermission(user, PERMISSIONS.USERS_MANAGE, "Solo el administrador puede eliminar usuarios.");
  const data = await readDb();
  const target = data.users.find((item) => item.id === userId);
  if (!target) {
    const error = new Error("Usuario no encontrado.");
    error.status = 404;
    throw error;
  }
  if (normalizeSystemRole(target.role) === "ADMIN") {
    const admins = data.users.filter((item) => normalizeSystemRole(item.role) === "ADMIN");
    if (admins.length === 1) {
      const error = new Error("No puedes eliminar el ultimo administrador.");
      error.status = 400;
      throw error;
    }
  }
  data.users = data.users.filter((item) => item.id !== userId);
  data.youths = data.youths.map((youth) =>
    youth.assignedUserId === userId ? { ...youth, assignedUserId: null } : youth
  );
  syncUsersFromMembers(data);
  await writeDb(data);
  return true;
};

export const exportYouthsExcelXml = async (user) => {
  ensurePermission(user, PERMISSIONS.REPORTS_EXPORT, "No tienes permiso para exportar reportes.");
  const youths = await listYouths(user, {});
  const rows = youths
    .map(
      (item) => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(item.fullName)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.documentId || "")}</Data></Cell>
        <Cell><Data ss:Type="Number">${item.age}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.phone)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.birthDate || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.email || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.baptized || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.memberRole || "")}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.status)}</Data></Cell>
      </Row>`
    )
    .join("");
  return `<?xml version="1.0"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
   xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Worksheet ss:Name="Jovenes">
      <Table>
        <Row>
          <Cell><Data ss:Type="String">Nombre completo</Data></Cell>
          <Cell><Data ss:Type="String">Cedula</Data></Cell>
          <Cell><Data ss:Type="String">Edad</Data></Cell>
          <Cell><Data ss:Type="String">Telefono</Data></Cell>
          <Cell><Data ss:Type="String">Fecha de nacimiento</Data></Cell>
          <Cell><Data ss:Type="String">Correo</Data></Cell>
          <Cell><Data ss:Type="String">Bautizados</Data></Cell>
          <Cell><Data ss:Type="String">Rol ministerial</Data></Cell>
          <Cell><Data ss:Type="String">Estado</Data></Cell>
        </Row>
        ${rows}
      </Table>
    </Worksheet>
  </Workbook>`;
};

export const importYouthsFromCsv = async (user, payload) => {
  ensurePermission(user, PERMISSIONS.MEMBERS_IMPORT, "No tienes permiso para importar miembros.");
  const csv = String(payload.csv || "");
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    const error = new Error("El CSV no tiene registros.");
    error.status = 400;
    throw error;
  }
  const data = await readDb();
  const parseCsvLine = (line) => {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        const next = line[index + 1];
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result.map((item) => item.replace(/^"|"$/g, "").trim());
  };
  const normalizeHeader = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const findAssignedUserId = (value) => {
    const email = normalizeText(value).toLowerCase();
    if (!email) return null;
    return data.users.find((item) => item.email === email)?.id || null;
  };
  const records = lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    try {
      return validateYouthPayload({
        fullName: row.nombre_completo || row.full_name || row.nombre,
        documentId: row.cedula || row.documento || row.document_id,
        age: row.edad || row.age,
        phone: row.telefono || row.phone,
        email: row.correo || row.email,
        birthDate:
          row.fecha_de_nacimiento || row.fecha_nacimiento || row.birth_date,
        baptized: row.bautizados || row.bautizado,
        memberRole: row.rol || row.rol_miembro || row.member_role,
        address: row.direccion || row.address,
        joinDate: row.fecha_ingreso || row.join_date,
        status: row.estado || row.status,
        notes: row.notas || row.notes,
        assignedUserId: findAssignedUserId(
          row.correo_mentor_asignado ||
            row.mentor_asignado ||
            row.correo_asistente_asignado ||
            row.asistente_asignado ||
            row.assigned_assistant_email ||
            row.assigned_user_email
        )
      });
    } catch (error) {
      const detailed = new Error(
        `Fila ${rowIndex + 2}: ${error.message}`
      );
      detailed.status = error.status || 400;
      throw detailed;
    }
  });
  const created = records.map((record) => ({
    id: createId("yth"),
    ...record,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }));
  data.youths.push(...created);
  syncUsersFromMembers(data);
  await writeDb(data);
  return created;
};

export const importStructuredMembers = async (payload, options = {}) => {
  const { bypassAdminCheck = false } = options;
  const data = await readDb();
  if (!bypassAdminCheck) {
    ensurePermission(options.user, PERMISSIONS.MEMBERS_IMPORT, "No tienes permiso para importar miembros.");
  }
  const source = Array.isArray(payload.members) ? payload.members : [];
  if (!source.length) {
    const error = new Error("No se encontraron miembros para importar.");
    error.status = 400;
    throw error;
  }
  const created = source.map((member, index) => ({
    id: createId("yth"),
    ...validateYouthPayload(member),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    importOrder: index + 1
  }));
  data.youths = created;
  data.attendanceSessions = [];
  data.interactions = [];
  data.alerts = [];
  syncUsersFromMembers(data);
  await writeDb(data);
  return created.map((member) => serializeYouth(data, member));
};
