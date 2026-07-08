import { readDb, writeDb } from "../repositories/database.js";
import {
  createId,
  normalizeText,
  nowIso,
  sameMonth,
  sameWeek,
  sortByDateDesc
} from "../utils/helpers.js";
import { hashPassword } from "../utils/security.js";
import { appendAuditEntry } from "./authService.js";
import { getPermissions, normalizeRole, requirePermission } from "./rbac.js";

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const ACCESS_MEMBER_ROLE_TO_USER_ROLE = {
  mentor: "MENTOR",
  lider: "LIDER",
  pastor: "PASTOR",
  secretaria: "SECRETARIA"
};

const platformRoleFromMemberRole = (memberRole) =>
  ACCESS_MEMBER_ROLE_TO_USER_ROLE[normalizeKey(memberRole)] || null;

const validateManagedPassword = (password, confirmPassword = password) => {
  const value = String(password || "");
  const confirmation = String(confirmPassword || "");
  if (value.length < 8) {
    const error = new Error("La contrasena debe tener al menos 8 caracteres.");
    error.status = 400;
    throw error;
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    const error = new Error("La contrasena debe incluir mayuscula, minuscula, numero y simbolo.");
    error.status = 400;
    throw error;
  }
  if (value !== confirmation) {
    const error = new Error("La confirmacion de contrasena no coincide.");
    error.status = 400;
    throw error;
  }
  return value;
};

const youthVisibilityFilter = (user) => (youth) =>
  ["ADMIN", "PASTOR", "SECRETARIA"].includes(normalizeRole(user.role)) ||
  youth.assignedUserId === user.id;

const ensureYouthAccess = (user, youth) => {
  if (!youth) {
    const error = new Error("Joven no encontrado.");
    error.status = 404;
    throw error;
  }
  if (["ADMIN", "PASTOR", "SECRETARIA"].includes(normalizeRole(user.role)) || youth.assignedUserId === user.id) {
    return youth;
  }
  const error = new Error("No tienes acceso a este joven.");
  error.status = 403;
  throw error;
};

const syncUserAssignments = (data) => {
  const assignedByUser = new Map(data.users.map((user) => [user.id, []]));
  const validUserIds = new Set(data.users.map((user) => user.id));

  data.youths = data.youths.map((youth) => {
    if (!youth.assignedUserId) return youth;
    if (!validUserIds.has(youth.assignedUserId)) {
      return { ...youth, assignedUserId: null };
    }
    assignedByUser.get(youth.assignedUserId).push(youth.id);
    return youth;
  });

  data.users = data.users.map((user) => ({
    ...user,
    assignedYouthIds: assignedByUser.get(user.id) || []
  }));
};

const revokeUserSessions = (data, userId) => {
  data.userSessions = (data.userSessions || []).map((session) =>
    session.userId === userId ? { ...session, revokedAt: session.revokedAt || nowIso() } : session
  );
};

const findUserForYouth = (data, youth) => {
  const email = normalizeText(youth.email).toLowerCase();
  const byEmail = email
    ? data.users.find((user) => String(user.email || "").toLowerCase() === email)
    : null;
  return (
    data.users.find((user) => user.linkedYouthId === youth.id) ||
    (byEmail && (byEmail.managedFromYouth || normalizeRole(byEmail.role) !== "ADMIN") ? byEmail : null)
  );
};

const syncPlatformUsersFromYouths = (data, { actorId = null, audit = true } = {}) => {
  data.users = Array.isArray(data.users) ? data.users : [];
  data.youths = Array.isArray(data.youths) ? data.youths : [];
  const now = nowIso();
  const currentYouthIds = new Set(data.youths.map((youth) => youth.id));
  let changed = false;

  const auditIfNeeded = (action, targetUser, metadata = {}) => {
    if (!audit) return;
    appendAuditEntry(data, action, actorId, {
      targetUserId: targetUser?.id || null,
      ...metadata
    });
  };

  for (const youth of data.youths) {
    const platformRole = platformRoleFromMemberRole(youth.memberRole);
    const email = normalizeText(youth.email).toLowerCase();
    const existing = findUserForYouth(data, youth);
    const shouldHaveAccess = Boolean(platformRole && email);
    const emailOwner = email
      ? data.users.find((user) => String(user.email || "").toLowerCase() === email)
      : null;

    if (shouldHaveAccess) {
      if (!existing) {
        if (emailOwner) {
          auditIfNeeded("users.member_sync_email_conflict", emailOwner, {
            youthId: youth.id,
            email,
            role: platformRole
          });
          continue;
        }
        const created = {
          id: createId("usr"),
          fullName: youth.fullName,
          email,
          passwordHash: "",
          role: platformRole,
          assignedYouthIds: [],
          active: youth.status !== "inactivo",
          accessBlocked: false,
          linkedYouthId: youth.id,
          managedFromYouth: true,
          lastLogin: null,
          failedLoginCount: 0,
          lockedUntil: null,
          createdAt: now,
          updatedAt: now
        };
        data.users.push(created);
        auditIfNeeded("users.auto_created_from_member", created, {
          youthId: youth.id,
          role: platformRole,
          passwordAssigned: false
        });
        changed = true;
        continue;
      }

      const previousRole = normalizeRole(existing.role);
      const previousActive = existing.active !== false;
      const nextActive = youth.status !== "inactivo";
      const updates = {
        fullName: youth.fullName,
        email,
        role: platformRole,
        active: nextActive,
        linkedYouthId: youth.id,
        managedFromYouth: true,
        updatedAt: now
      };
      const needsUpdate = Object.entries(updates).some(([key, value]) => existing[key] !== value);
      if (needsUpdate) {
        Object.assign(existing, updates);
        auditIfNeeded("users.synced_from_member", existing, { youthId: youth.id });
        changed = true;
      }
      if (previousRole !== platformRole) {
        auditIfNeeded("users.role_changed", existing, {
          youthId: youth.id,
          from: previousRole,
          to: platformRole
        });
      }
      if (previousActive !== nextActive) {
        auditIfNeeded(nextActive ? "users.activated" : "users.deactivated", existing, {
          youthId: youth.id,
          source: "member_sync"
        });
        if (!nextActive) revokeUserSessions(data, existing.id);
      }
      continue;
    }

    if (existing?.managedFromYouth && existing.active !== false) {
      existing.active = false;
      existing.linkedYouthId = youth.id;
      existing.updatedAt = now;
      revokeUserSessions(data, existing.id);
      auditIfNeeded("users.deactivated", existing, {
        youthId: youth.id,
        source: platformRole ? "missing_member_email" : "member_role_removed"
      });
      changed = true;
    }
  }

  for (const user of data.users) {
    if (user.managedFromYouth && user.linkedYouthId && !currentYouthIds.has(user.linkedYouthId) && user.active !== false) {
      user.active = false;
      user.updatedAt = now;
      revokeUserSessions(data, user.id);
      auditIfNeeded("users.deactivated", user, {
        youthId: user.linkedYouthId,
        source: "member_removed"
      });
      changed = true;
    }
  }

  return changed;
};

const sanitizeUserWithAssignments = (data, user) => ({
  ...sanitizeUser(user),
  assignedYouthIds: data.youths
    .filter((youth) => youth.assignedUserId === user.id)
    .map((youth) => youth.id)
});

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
  const roleMap = {
    miembro: "Miembro",
    lider: "Lider",
    "co_lider": "Lider",
    colider: "Lider",
    mentor: "Mentor",
    diacono: "Diacono",
    pastor: "Pastor",
    secretaria: "Secretaria",
    admin: "Admin",
    administrador: "Admin"
  };
  const normalizedRoleKey = memberRole
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const normalizedRole = roleMap[normalizedRoleKey];
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

const validateVisitorPayload = (payload) => {
  const fullName = normalizeText(payload.fullName || payload.name);
  const address = normalizeText(payload.address);
  const phone = normalizeText(payload.phone);
  const status = normalizeText(payload.status || "nuevo").toLowerCase();
  if (!fullName || !address || !phone) {
    const error = new Error("Nombre y apellido, direccion y telefono son obligatorios.");
    error.status = 400;
    throw error;
  }
  if (!["nuevo", "en_seguimiento", "convertido"].includes(status)) {
    const error = new Error("Estado de visitante no valido.");
    error.status = 400;
    throw error;
  }
  return {
    fullName,
    address,
    phone,
    status,
    notes: normalizeText(payload.notes)
  };
};

const validateUserPayload = (payload) => {
  const fullName = normalizeText(payload.fullName);
  const email = normalizeText(payload.email).toLowerCase();
  const role = normalizeText(payload.role).toUpperCase();
  const normalizedRole = normalizeRole(role);
  if (!fullName || !email) {
    const error = new Error("Datos de usuario invalidos.");
    error.status = 400;
    throw error;
  }
  if (!email.includes("@")) {
    const error = new Error("Correo de usuario invalido.");
    error.status = 400;
    throw error;
  }
  return {
    fullName,
    email,
    role: normalizedRole,
    active: payload.active !== false,
    accessBlocked: payload.accessBlocked === true,
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
  const role = normalizeRole(safeUser.role);
  const hasPassword = Boolean(passwordHash);
  return {
    ...safeUser,
    role,
    hasPassword,
    passwordAssigned: hasPassword,
    credentialStatus: hasPassword ? "ASIGNADA" : "PENDIENTE",
    accessBlocked: safeUser.accessBlocked === true,
    permissions: getPermissions(role)
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
  const adminPassword = validateManagedPassword(password);

  const admin = {
    id: createId("usr"),
    fullName,
    email,
    passwordHash: hashPassword(adminPassword),
    role: "ADMIN",
    assignedYouthIds: [],
    active: true,
    accessBlocked: false,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: nowIso()
  };

  data.meta = {
    ...data.meta,
    churchName,
    updatedAt: nowIso()
  };
  data.users = [admin];
  appendAuditEntry(data, "users.created", admin.id, {
    targetUserId: admin.id,
    role: "ADMIN",
    source: "bootstrap"
  });
  await writeDb(data);
  return sanitizeUser(admin);
};

export const getDashboard = async (user) => {
  const data = await readDb();
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
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
};

export const createYouth = async (user, payload) => {
  const data = await readDb();
  const record = {
    id: createId("yth"),
    ...validateYouthPayload(payload),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (normalizeRole(user.role) === "MENTOR") {
    record.assignedUserId = user.id;
  }
  data.youths.push(record);
  syncPlatformUsersFromYouths(data, { actorId: user.id });
  syncUserAssignments(data);
  await writeDb(data);
  return record;
};

export const updateYouth = async (user, youthId, payload) => {
  const data = await readDb();
  const index = data.youths.findIndex((item) => item.id === youthId);
  const current = ensureYouthAccess(user, data.youths[index]);
  const next = {
    ...current,
    ...validateYouthPayload({ ...current, ...payload }),
    updatedAt: nowIso()
  };
  if (normalizeRole(user.role) === "MENTOR") {
    next.assignedUserId = user.id;
  }
  data.youths[index] = next;
  syncPlatformUsersFromYouths(data, { actorId: user.id });
  syncUserAssignments(data);
  await writeDb(data);
  return next;
};

export const deleteYouth = async (user, youthId) => {
  if (normalizeRole(user.role) !== "ADMIN") {
    const error = new Error("Solo el administrador puede eliminar jovenes.");
    error.status = 403;
    throw error;
  }
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
  syncPlatformUsersFromYouths(data, { actorId: user.id });
  syncUserAssignments(data);
  await writeDb(data);
  return true;
};

export const listVisitors = async (user, query = {}) => {
  const data = await readDb();
  const search = normalizeText(query.search).toLowerCase();
  const status = normalizeText(query.status).toLowerCase();
  return (data.visitors || [])
    .filter((item) => !status || item.status === status)
    .filter((item) => {
      if (!search) return true;
      return [item.fullName, item.address, item.phone]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
};

export const createVisitor = async (user, payload) => {
  const data = await readDb();
  const sanitized = validateVisitorPayload(payload);
  if (sanitized.status === "convertido") {
    const error = new Error("Para convertir un visitante usa la accion Convertir a miembro.");
    error.status = 400;
    throw error;
  }
  const visitor = {
    id: createId("vis"),
    ...sanitized,
    createdBy: user.id,
    convertedYouthId: null,
    convertedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  data.visitors = Array.isArray(data.visitors) ? data.visitors : [];
  data.visitors.push(visitor);
  await writeDb(data);
  return visitor;
};

export const updateVisitor = async (user, visitorId, payload) => {
  const data = await readDb();
  const visitors = Array.isArray(data.visitors) ? data.visitors : [];
  const index = visitors.findIndex((item) => item.id === visitorId);
  if (index === -1) {
    const error = new Error("Visitante no encontrado.");
    error.status = 404;
    throw error;
  }
  const current = visitors[index];
  const sanitized = validateVisitorPayload({ ...current, ...payload });
  if (current.status !== "convertido" && sanitized.status === "convertido") {
    const error = new Error("Para convertir un visitante usa la accion Convertir a miembro.");
    error.status = 400;
    throw error;
  }
  const updated = {
    ...current,
    ...sanitized,
    updatedAt: nowIso()
  };
  visitors[index] = updated;
  data.visitors = visitors;
  await writeDb(data);
  return updated;
};

export const deleteVisitor = async (user, visitorId) => {
  const data = await readDb();
  const visitors = Array.isArray(data.visitors) ? data.visitors : [];
  const visitor = visitors.find((item) => item.id === visitorId);
  if (!visitor) {
    const error = new Error("Visitante no encontrado.");
    error.status = 404;
    throw error;
  }
  data.visitors = visitors.filter((item) => item.id !== visitorId);
  await writeDb(data);
  return true;
};

export const convertVisitorToYouth = async (user, visitorId) => {
  const data = await readDb();
  const visitors = Array.isArray(data.visitors) ? data.visitors : [];
  const index = visitors.findIndex((item) => item.id === visitorId);
  if (index === -1) {
    const error = new Error("Visitante no encontrado.");
    error.status = 404;
    throw error;
  }
  const visitor = visitors[index];
  if (visitor.status === "convertido" && visitor.convertedYouthId) {
    const error = new Error("Este visitante ya fue convertido en miembro.");
    error.status = 400;
    throw error;
  }
  const youth = {
    id: createId("yth"),
    fullName: visitor.fullName,
    documentId: `VIS-${visitor.id}`,
    age: 0,
    phone: visitor.phone,
    email: "",
    birthDate: "2000-01-01",
    baptized: "NO",
    memberRole: "Miembro",
    address: visitor.address,
    joinDate: new Date().toISOString().slice(0, 10),
    status: "activo",
    assignedUserId: null,
    notes: normalizeText(visitor.notes || "Convertido desde Consolidacion."),
    sourceVisitorId: visitor.id,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  data.youths.push(youth);
  visitors[index] = {
    ...visitor,
    status: "convertido",
    convertedYouthId: youth.id,
    convertedAt: nowIso(),
    updatedAt: nowIso()
  };
  data.visitors = visitors;
  syncPlatformUsersFromYouths(data, { actorId: user.id });
  syncUserAssignments(data);
  await writeDb(data);
  return { visitor: visitors[index], youth };
};

export const listAttendance = async (user) => {
  const data = await readDb();
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
  return { youth, attendanceHistory, interactions, alerts };
};

export const listInteractions = async (user) => {
  const data = await readDb();
  const visibleIds = new Set(
    data.youths.filter(youthVisibilityFilter(user)).map((item) => item.id)
  );
  return sortByDateDesc(
    data.interactions
      .filter((item) => visibleIds.has(item.youthId))
      .map((item) => ({
        ...item,
        youth: data.youths.find((youth) => youth.id === item.youthId) || null
      })),
    "date"
  );
};

export const createInteraction = async (user, payload) => {
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
  const visibleIds = new Set(
    data.youths.filter(youthVisibilityFilter(user)).map((item) => item.id)
  );
  return sortByDateDesc(
    data.alerts
      .filter((item) => visibleIds.has(item.youthId))
      .map((item) => ({
        ...item,
        youth: data.youths.find((youth) => youth.id === item.youthId) || null
      })),
    "generatedAt"
  );
};

export const attendAlert = async (user, alertId) => {
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
  if (normalizeRole(user.role) !== "ADMIN") {
    const error = new Error("Solo el administrador puede ver usuarios.");
    error.status = 403;
    throw error;
  }
  const data = await readDb();
  const changed = syncPlatformUsersFromYouths(data, { actorId: user.id, audit: false });
  syncUserAssignments(data);
  if (changed) {
    await writeDb(data);
  }
  return data.users.map((item) => sanitizeUserWithAssignments(data, item));
};

export const createUser = async (user, payload) => {
  if (normalizeRole(user.role) !== "ADMIN") {
    const error = new Error("Solo el administrador puede crear usuarios.");
    error.status = 403;
    throw error;
  }
  const data = await readDb();
  const sanitized = validateUserPayload(payload);
  if (data.users.some((item) => item.email === sanitized.email)) {
    const error = new Error("Ya existe un usuario con ese correo.");
    error.status = 400;
    throw error;
  }
  const password = normalizeText(payload.password);
  const created = {
    id: createId("usr"),
    ...sanitized,
    passwordHash: password
      ? hashPassword(validateManagedPassword(password, payload.confirmPassword ?? password))
      : "",
    linkedYouthId: payload.linkedYouthId || null,
    managedFromYouth: payload.managedFromYouth === true,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLogin: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  data.users.push(created);
  data.youths = data.youths.map((youth) =>
    created.assignedYouthIds.includes(youth.id)
      ? { ...youth, assignedUserId: created.id }
      : youth
  );
  syncUserAssignments(data);
  appendAuditEntry(data, "users.created", user.id, {
    targetUserId: created.id,
    role: created.role,
    passwordAssigned: Boolean(created.passwordHash)
  });
  if (created.passwordHash) {
    appendAuditEntry(data, "users.password_assigned", user.id, {
      targetUserId: created.id
    });
  }
  await writeDb(data);
  return sanitizeUserWithAssignments(data, created);
};

export const updateUser = async (user, userId, payload) => {
  if (normalizeRole(user.role) !== "ADMIN") {
    const error = new Error("Solo el administrador puede editar usuarios.");
    error.status = 403;
    throw error;
  }
  const data = await readDb();
  const index = data.users.findIndex((item) => item.id === userId);
  if (index === -1) {
    const error = new Error("Usuario no encontrado.");
    error.status = 404;
    throw error;
  }
  const current = data.users[index];
  const sanitized = validateUserPayload({ ...current, ...payload });
  if (
    sanitized.email !== current.email &&
    data.users.some((item) => item.id !== current.id && item.email === sanitized.email)
  ) {
    const error = new Error("Ya existe un usuario con ese correo.");
    error.status = 400;
    throw error;
  }
  const passwordProvided = Object.prototype.hasOwnProperty.call(payload, "password") && normalizeText(payload.password);
  const previous = {
    role: normalizeRole(current.role),
    active: current.active !== false,
    accessBlocked: current.accessBlocked === true,
    hasPassword: Boolean(current.passwordHash)
  };
  const passwordHash = passwordProvided
    ? hashPassword(validateManagedPassword(payload.password, payload.confirmPassword ?? payload.password))
    : current.passwordHash || "";
  const updated = {
    ...current,
    ...sanitized,
    passwordHash,
    updatedAt: nowIso()
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
  if (passwordProvided) {
    updated.failedLoginCount = 0;
    updated.lockedUntil = null;
    revokeUserSessions(data, updated.id);
    appendAuditEntry(data, "users.password_changed", user.id, {
      targetUserId: updated.id
    });
  }
  if (previous.role !== normalizeRole(updated.role)) {
    appendAuditEntry(data, "users.role_changed", user.id, {
      targetUserId: updated.id,
      from: previous.role,
      to: normalizeRole(updated.role)
    });
  }
  if (previous.active !== (updated.active !== false)) {
    if (updated.active === false) revokeUserSessions(data, updated.id);
    appendAuditEntry(data, updated.active === false ? "users.deactivated" : "users.activated", user.id, {
      targetUserId: updated.id
    });
  }
  if (previous.accessBlocked !== (updated.accessBlocked === true)) {
    if (updated.accessBlocked === true) revokeUserSessions(data, updated.id);
    appendAuditEntry(data, updated.accessBlocked === true ? "users.blocked" : "users.unblocked", user.id, {
      targetUserId: updated.id
    });
  }
  if (!previous.hasPassword && Boolean(updated.passwordHash) && !passwordProvided) {
    appendAuditEntry(data, "users.password_assigned", user.id, {
      targetUserId: updated.id
    });
  }
  syncUserAssignments(data);
  await writeDb(data);
  return sanitizeUserWithAssignments(data, data.users[index]);
};

export const deleteUser = async (user, userId) => {
  if (normalizeRole(user.role) !== "ADMIN") {
    const error = new Error("Solo el administrador puede eliminar usuarios.");
    error.status = 403;
    throw error;
  }
  const data = await readDb();
  const target = data.users.find((item) => item.id === userId);
  if (!target) {
    const error = new Error("Usuario no encontrado.");
    error.status = 404;
    throw error;
  }
  if (target.role === "ADMIN") {
    const admins = data.users.filter((item) => item.role === "ADMIN");
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
  revokeUserSessions(data, userId);
  syncUserAssignments(data);
  appendAuditEntry(data, "users.deleted", user.id, {
    targetUserId: userId,
    role: target.role
  });
  await writeDb(data);
  return true;
};

export const exportYouthsExcelXml = async (user) => {
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
  if (normalizeRole(user.role) !== "ADMIN") {
    const error = new Error("Solo el administrador puede importar base de jovenes.");
    error.status = 403;
    throw error;
  }
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
  syncPlatformUsersFromYouths(data, { actorId: user.id });
  syncUserAssignments(data);
  await writeDb(data);
  return created;
};

export const importStructuredMembers = async (payload, options = {}) => {
  const { bypassAdminCheck = false } = options;
  const data = await readDb();
  if (!bypassAdminCheck && options.user?.role !== "ADMIN") {
    const error = new Error("Solo el administrador puede importar miembros.");
    error.status = 403;
    throw error;
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
  syncPlatformUsersFromYouths(data, { actorId: options.user?.id || null });
  syncUserAssignments(data);
  await writeDb(data);
  return created;
};
