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

const canHaveSystemAccount = (memberRole) =>
  Boolean(systemRoleFromMemberRole(memberRole));

const logActivity = (data, user, action, entityType, entityId, metadata = {}) => {
  data.activityLogs = Array.isArray(data.activityLogs) ? data.activityLogs : [];
  data.activityLogs.unshift({
    id: createId("log"),
    userId: user?.id || null,
    action,
    entityType,
    entityId: entityId || null,
    metadata,
    createdAt: nowIso()
  });
  data.activityLogs = data.activityLogs.slice(0, 1000);
};

const syncUsersFromMembers = (data) => {
  data.users = Array.isArray(data.users) ? data.users : [];
  data.youths = Array.isArray(data.youths) ? data.youths : [];

  data.users = data.users.map((user) => ({
    assignedYouthIds: [],
    active: true,
    mustChangePassword: false,
    createdAt: nowIso(),
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
    const role = systemRoleFromMemberRole(youth.memberRole);
    let account = usersByMemberId.get(youth.id) || usersByEmail.get(email);
    if (!email || !canHaveSystemAccount(youth.memberRole)) {
      if (account?.memberId === youth.id) {
        account.memberRole = youth.memberRole;
        account.active = false;
        account.assignedYouthIds = [];
        account.updatedAt = nowIso();
      }
      continue;
    }

    if (!account) {
      account = {
        id: createId("usr"),
        passwordHash: defaultSyncedPasswordHash(),
        mustChangePassword: true,
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
    account.mustChangePassword = account.mustChangePassword !== false;
    account.updatedAt = nowIso();

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

  data.mentorAssignments = data.youths
    .filter((youth) => youth.assignedUserId)
    .map((youth) => ({
      id: `asg_${youth.assignedUserId}_${youth.id}`,
      mentorUserId: youth.assignedUserId,
      youthId: youth.id,
      createdAt: youth.assignedAt || youth.updatedAt || nowIso()
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

const ensureAssignableMentor = (data, mentorUserId) => {
  if (!mentorUserId) return null;
  const mentor = data.users.find((item) => item.id === mentorUserId);
  if (!canBeAssignedAsMentor(mentor)) {
    const error = new Error("El usuario seleccionado no puede recibir miembros asignados.");
    error.status = 400;
    throw error;
  }
  return mentor;
};

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const formatPercent = (value) => `${Math.round(Number(value || 0))}%`;

const parseReportFilters = (query = {}) => ({
  from: normalizeText(query.from || query.startDate),
  to: normalizeText(query.to || query.endDate),
  mentorId: normalizeText(query.mentorId || query.mentor),
  leaderId: normalizeText(query.leaderId || query.leader),
  status: normalizeText(query.status),
  minAge: query.minAge === undefined || query.minAge === "" ? null : Number(query.minAge),
  maxAge: query.maxAge === undefined || query.maxAge === "" ? null : Number(query.maxAge),
  gender: normalizeText(query.gender),
  baptized: normalizeText(query.baptized),
  attendance: normalizeText(query.attendance),
  active: normalizeText(query.active)
});

const dateInRange = (date, filters) => {
  if (!date) return true;
  if (filters.from && date < filters.from) return false;
  if (filters.to && date > filters.to) return false;
  return true;
};

const countBy = (items, getter) =>
  items.reduce((acc, item) => {
    const key = getter(item) || "Sin dato";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const ageRange = (age) => {
  const value = Number(age);
  if (!Number.isFinite(value)) return "Sin dato";
  if (value <= 12) return "0-12";
  if (value <= 17) return "13-17";
  if (value <= 25) return "18-25";
  if (value <= 35) return "26-35";
  return "36+";
};

const filterYouthsForReport = (data, user, filters) =>
  data.youths
    .filter(youthVisibilityFilter(user))
    .filter((youth) => !filters.status || youth.status === filters.status)
    .filter((youth) => !filters.active || youth.status === (filters.active === "true" ? "activo" : "inactivo"))
    .filter((youth) => !filters.mentorId || youth.assignedUserId === filters.mentorId)
    .filter((youth) => !filters.leaderId || youth.assignedUserId === filters.leaderId)
    .filter((youth) => !filters.baptized || youth.baptized === filters.baptized)
    .filter((youth) => !filters.gender || normalizeText(youth.gender).toLowerCase() === filters.gender.toLowerCase())
    .filter((youth) => filters.minAge === null || Number(youth.age) >= filters.minAge)
    .filter((youth) => filters.maxAge === null || Number(youth.age) <= filters.maxAge)
    .filter((youth) => dateInRange(youth.joinDate || youth.createdAt?.slice(0, 10), filters));

const buildReportPayload = (data, user, type = "general", query = {}) => {
  const filters = parseReportFilters(query);
  const members = filterYouthsForReport(data, user, filters);
  const memberIds = new Set(members.map((item) => item.id));
  const visits = (data.visits || []).filter((item) => memberIds.has(item.youthId) && dateInRange(item.date, filters));
  const calls = (data.calls || []).filter((item) => memberIds.has(item.youthId) && dateInRange(item.date, filters));
  const meetings = (data.meetings || []).filter((item) => memberIds.has(item.youthId) && dateInRange(item.date, filters));
  const interactions = data.interactions.filter((item) => memberIds.has(item.youthId) && dateInRange(item.date, filters));
  const alerts = data.alerts.filter((item) => memberIds.has(item.youthId));
  const attendanceSessions = data.attendanceSessions.filter((session) => dateInRange(session.date, filters));
  const attendanceRecords = attendanceSessions.flatMap((session) =>
    session.attendance
      .filter((record) => memberIds.has(record.youthId))
      .map((record) => ({ ...record, sessionDate: session.date, sessionTitle: session.title }))
  );
  const followedIds = new Set(
    [...visits, ...calls, ...meetings, ...interactions].map((item) => item.youthId)
  );
  const present = attendanceRecords.filter((item) => item.present).length;
  const attendancePercent = attendanceRecords.length
    ? Math.round((present / attendanceRecords.length) * 100)
    : 0;
  const mentorshipTotal = visits.length + calls.length + meetings.length + interactions.length;
  const activeAssigned = members.filter((item) => item.assignedUserId).length;
  const effectiveness = activeAssigned
    ? Math.round((followedIds.size / activeAssigned) * 100)
    : 0;
  const monthlyGrowth = countBy(members, (member) => (member.joinDate || member.createdAt || "").slice(0, 7));
  const weeklyAttendance = countBy(attendanceRecords, (record) => record.sessionDate);

  return {
    id: createId("rpt"),
    type,
    filters,
    generatedAt: nowIso(),
    generatedBy: sanitizeUser(user),
    summary: {
      totalMembers: members.length,
      activeMembers: members.filter((item) => item.status === "activo").length,
      inactiveMembers: members.filter((item) => item.status === "inactivo").length,
      newMembers: members.filter((item) => dateInRange(item.joinDate || item.createdAt?.slice(0, 10), filters)).length,
      baptizedMembers: members.filter((item) => item.baptized === "SI").length,
      leaders: members.filter((item) => item.memberRole === "Lider").length,
      mentors: members.filter((item) => item.memberRole === "Mentor").length,
      pastors: members.filter((item) => item.memberRole === "Pastor").length,
      visits: visits.length,
      calls: calls.length,
      meetings: meetings.length,
      interactions: interactions.length,
      pendingFollowUps: members.filter((item) => item.status === "activo" && !followedIds.has(item.id)).length,
      membersWithoutFollowUp: members.filter((item) => !followedIds.has(item.id)).length,
      activeAlerts: alerts.filter((item) => item.status === "pendiente").length,
      attendancePercent,
      mentorshipEffectiveness: effectiveness
    },
    distributions: {
      ages: countBy(members, (member) => ageRange(member.age)),
      gender: countBy(members, (member) => member.gender || "Sin dato"),
      spiritualStatus: countBy(members, (member) => member.baptized === "SI" ? "Bautizado" : "No bautizado"),
      roles: countBy(members, (member) => member.memberRole || "Miembro"),
      status: countBy(members, (member) => member.status || "activo"),
      monthlyGrowth,
      weeklyAttendance
    },
    tables: {
      members: members.map((item) => serializeYouth(data, item)),
      followUps: [
        ...visits.map((item) => ({ ...item, kind: "Visita" })),
        ...calls.map((item) => ({ ...item, kind: "Llamada" })),
        ...meetings.map((item) => ({ ...item, kind: "Reunion" })),
        ...interactions.map((item) => ({ ...item, kind: item.type || "Seguimiento" }))
      ].sort((a, b) => String(b.date).localeCompare(String(a.date))),
      attendance: attendanceRecords,
      alerts
    }
  };
};

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
    active:
      payload.active === undefined
        ? true
        : payload.active === true || payload.active === "true" || payload.active === "on",
    mustChangePassword:
      payload.mustChangePassword === undefined
        ? true
        : payload.mustChangePassword === true ||
          payload.mustChangePassword === "true" ||
          payload.mustChangePassword === "on",
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
  const { passwordHash, temporaryPassword, ...safeUser } = user;
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
    mustChangePassword: false,
    lastLogin: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  data.meta = {
    ...data.meta,
    churchName,
    updatedAt: nowIso()
  };
  data.users = [admin];
  logActivity(data, admin, "setup.bootstrap", "user", admin.id, { email });
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
  user.lastLogin = nowIso();
  user.updatedAt = nowIso();
  logActivity(data, user, "auth.login", "user", user.id, { email: user.email });
  await writeDb(data);
  return sanitizeUser(user);
};

export const getDashboard = async (user) => {
  const data = await readDb();
  ensurePermission(user, PERMISSIONS.DASHBOARD_VIEW);
  const visibleYouths = data.youths.filter(youthVisibilityFilter(user));
  const visibleIds = new Set(visibleYouths.map((item) => item.id));
  const recentInteractions = sortByDateDesc(
    [
      ...data.interactions,
      ...(data.visits || []).map((item) => ({ ...item, type: "visita" })),
      ...(data.calls || []).map((item) => ({ ...item, type: "llamada" })),
      ...(data.meetings || []).map((item) => ({ ...item, type: "reunion" }))
    ].filter((item) => visibleIds.has(item.youthId)),
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
      followUpsThisMonth: [
        ...data.interactions,
        ...(data.visits || []),
        ...(data.calls || []),
        ...(data.meetings || [])
      ].filter((item) => visibleIds.has(item.youthId) && sameMonth(item.date, now)).length,
      assignedMembers: data.youths.filter((item) => item.assignedUserId === user.id).length,
      activeMentors: data.users.filter((item) => canBeAssignedAsMentor(item)).length
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
  } else {
    ensureAssignableMentor(data, record.assignedUserId);
  }
  if (record.assignedUserId) record.assignedAt = nowIso();
  data.youths.push(record);
  syncUsersFromMembers(data);
  logActivity(data, user, "member.create", "member", record.id, {
    memberRole: record.memberRole,
    assignedUserId: record.assignedUserId
  });
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
  } else {
    ensureAssignableMentor(data, next.assignedUserId);
  }
  if (next.assignedUserId !== current.assignedUserId) {
    next.assignedAt = next.assignedUserId ? nowIso() : null;
  }
  data.youths[index] = next;
  syncUsersFromMembers(data);
  logActivity(data, user, "member.update", "member", next.id, {
    previousRole: current.memberRole,
    nextRole: next.memberRole,
    previousAssignedUserId: current.assignedUserId || null,
    nextAssignedUserId: next.assignedUserId || null
  });
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
  data.visits = (data.visits || []).filter((item) => item.youthId !== youthId);
  data.calls = (data.calls || []).filter((item) => item.youthId !== youthId);
  data.meetings = (data.meetings || []).filter((item) => item.youthId !== youthId);
  data.pastoralNotes = (data.pastoralNotes || []).filter((item) => item.youthId !== youthId);
  syncUsersFromMembers(data);
  logActivity(data, user, "member.delete", "member", youthId, { fullName: youth.fullName });
  await writeDb(data);
  return true;
};

export const assignYouthMentor = async (user, youthId, payload) => {
  ensurePermission(user, PERMISSIONS.MEMBERS_ASSIGN, "No tienes permiso para reasignar miembros.");
  const data = await readDb();
  const index = data.youths.findIndex((item) => item.id === youthId);
  const youth = ensureYouthAccess(user, data.youths[index]);
  const mentorUserId = normalizeText(payload.mentorUserId || payload.assignedUserId) || null;
  ensureAssignableMentor(data, mentorUserId);
  data.youths[index] = {
    ...youth,
    assignedUserId: mentorUserId,
    assignedAt: mentorUserId ? nowIso() : null,
    updatedAt: nowIso()
  };
  syncUsersFromMembers(data);
  logActivity(data, user, "assignment.update", "member", youthId, {
    previousAssignedUserId: youth.assignedUserId || null,
    nextAssignedUserId: mentorUserId
  });
  await writeDb(data);
  return serializeYouth(data, data.youths[index]);
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
  const visits = sortByDateDesc((data.visits || []).filter((item) => item.youthId === youthId), "date");
  const calls = sortByDateDesc((data.calls || []).filter((item) => item.youthId === youthId), "date");
  const meetings = sortByDateDesc((data.meetings || []).filter((item) => item.youthId === youthId), "date");
  const pastoralNotes = sortByDateDesc(
    (data.pastoralNotes || [])
      .filter((item) => item.youthId === youthId)
      .filter((item) => !item.private || canAccessAllMembers(user) || item.authorUserId === user.id),
    "createdAt"
  );
  const alerts = sortByDateDesc(
    data.alerts.filter((item) => item.youthId === youthId),
    "generatedAt"
  );
  return {
    youth: serializeYouth(data, youth),
    attendanceHistory,
    interactions,
    visits,
    calls,
    meetings,
    pastoralNotes,
    alerts
  };
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
  logActivity(data, user, "mentorship.interaction_create", "interaction", interaction.id, {
    youthId: youth.id,
    type
  });
  await writeDb(data);
  return interaction;
};

const withYouth = (data, item) => ({
  ...item,
  youth: data.youths.find((youth) => youth.id === item.youthId)
    ? serializeYouth(data, data.youths.find((youth) => youth.id === item.youthId))
    : null,
  mentor: data.users.find((mentor) => mentor.id === item.mentorUserId)
    ? sanitizeUser(data.users.find((mentor) => mentor.id === item.mentorUserId))
    : null
});

const listMentorshipRecords = async (user, collectionName) => {
  const data = await readDb();
  ensurePermission(user, PERMISSIONS.INTERACTIONS_VIEW);
  const visibleIds = new Set(
    data.youths.filter(youthVisibilityFilter(user)).map((item) => item.id)
  );
  return sortByDateDesc(
    (data[collectionName] || [])
      .filter((item) => visibleIds.has(item.youthId))
      .filter((item) => canAccessAllMembers(user) || item.mentorUserId === user.id)
      .map((item) => withYouth(data, item)),
    "date"
  );
};

const createMentorshipRecord = async (user, collectionName, action, payload, fields) => {
  ensurePermission(user, PERMISSIONS.INTERACTIONS_CREATE, "No tienes permiso para registrar mentorias.");
  const data = await readDb();
  const youth = ensureYouthAccess(
    user,
    data.youths.find((item) => item.id === payload.youthId)
  );
  const date = normalizeText(payload.date);
  if (!date) {
    const error = new Error("Debes indicar fecha.");
    error.status = 400;
    throw error;
  }
  data[collectionName] = Array.isArray(data[collectionName]) ? data[collectionName] : [];
  const record = {
    id: createId(action.slice(0, 3)),
    youthId: youth.id,
    mentorUserId: user.id,
    date,
    ...fields(payload),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  data[collectionName].push(record);
  logActivity(data, user, `mentorship.${action}_create`, action, record.id, {
    youthId: youth.id
  });
  await writeDb(data);
  return withYouth(data, record);
};

export const listVisits = (user) => listMentorshipRecords(user, "visits");

export const createVisit = (user, payload) =>
  createMentorshipRecord(user, "visits", "visit", payload, (body) => ({
    location: normalizeText(body.location),
    observations: normalizeText(body.observations),
    result: normalizeText(body.result)
  }));

export const listCalls = (user) => listMentorshipRecords(user, "calls");

export const createCall = (user, payload) =>
  createMentorshipRecord(user, "calls", "call", payload, (body) => ({
    durationMinutes: Math.max(0, Number(body.durationMinutes || body.duration || 0)),
    observations: normalizeText(body.observations)
  }));

export const listMeetings = (user) => listMentorshipRecords(user, "meetings");

export const createMeeting = (user, payload) =>
  createMentorshipRecord(user, "meetings", "meeting", payload, (body) => ({
    type: normalizeText(body.type || "mentoria"),
    notes: normalizeText(body.notes)
  }));

export const listPastoralNotes = async (user) => {
  const data = await readDb();
  ensurePermission(user, PERMISSIONS.INTERACTIONS_VIEW);
  const visibleIds = new Set(
    data.youths.filter(youthVisibilityFilter(user)).map((item) => item.id)
  );
  return sortByDateDesc(
    (data.pastoralNotes || [])
      .filter((item) => visibleIds.has(item.youthId))
      .filter(
        (item) =>
          !item.private ||
          canAccessAllMembers(user) ||
          item.authorUserId === user.id
      )
      .map((item) => ({
        ...item,
        youth: data.youths.find((youth) => youth.id === item.youthId)
          ? serializeYouth(data, data.youths.find((youth) => youth.id === item.youthId))
          : null,
        author: data.users.find((author) => author.id === item.authorUserId)
          ? sanitizeUser(data.users.find((author) => author.id === item.authorUserId))
          : null
      })),
    "createdAt"
  );
};

export const createPastoralNote = async (user, payload) => {
  ensurePermission(user, PERMISSIONS.INTERACTIONS_CREATE, "No tienes permiso para registrar notas pastorales.");
  const data = await readDb();
  const youth = ensureYouthAccess(
    user,
    data.youths.find((item) => item.id === payload.youthId)
  );
  const note = normalizeText(payload.note || payload.notes);
  if (!note) {
    const error = new Error("La nota pastoral no puede estar vacia.");
    error.status = 400;
    throw error;
  }
  data.pastoralNotes = Array.isArray(data.pastoralNotes) ? data.pastoralNotes : [];
  const record = {
    id: createId("nte"),
    youthId: youth.id,
    authorUserId: user.id,
    note,
    private: payload.private !== false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  data.pastoralNotes.push(record);
  logActivity(data, user, "mentorship.pastoral_note_create", "pastoral_note", record.id, {
    youthId: youth.id,
    private: record.private
  });
  await writeDb(data);
  return record;
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
    mustChangePassword: true,
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
  syncUsersFromMembers(data);
  logActivity(data, user, "user.create", "user", created.id, {
    email: created.email,
    role: created.role
  });
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
      : current.passwordHash,
    mustChangePassword: payload.password ? true : sanitized.mustChangePassword,
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
  syncUsersFromMembers(data);
  logActivity(data, user, "user.update", "user", updated.id, {
    previousRole: current.role,
    nextRole: updated.role,
    active: updated.active
  });
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
  logActivity(data, user, "user.delete", "user", userId, { email: target.email });
  await writeDb(data);
  return true;
};

export const listActivityLogs = async (user) => {
  ensurePermission(user, PERMISSIONS.USERS_VIEW, "Solo el administrador puede ver auditoria.");
  const data = await readDb();
  return (data.activityLogs || []).slice(0, 300).map((log) => ({
    ...log,
    user: log.userId
      ? sanitizeUser(data.users.find((item) => item.id === log.userId) || {})
      : null
  }));
};

const persistReport = async (data, user, report) => {
  data.reports = Array.isArray(data.reports) ? data.reports : [];
  const record = {
    id: report.id,
    generatedBy: user.id,
    type: report.type,
    filters: report.filters,
    summary: report.summary,
    createdAt: report.generatedAt
  };
  data.reports.unshift(record);
  data.reports = data.reports.slice(0, 500);
  logActivity(data, user, "report.generate", "report", record.id, {
    type: record.type,
    filters: record.filters
  });
  await writeDb(data);
  return record;
};

const logReportDownload = async (data, user, reportId, format) => {
  data.reportDownloads = Array.isArray(data.reportDownloads) ? data.reportDownloads : [];
  const record = {
    id: createId("rpd"),
    reportId,
    format,
    downloadedBy: user.id,
    createdAt: nowIso()
  };
  data.reportDownloads.unshift(record);
  data.reportDownloads = data.reportDownloads.slice(0, 1000);
  logActivity(data, user, "report.download", "report", reportId, { format });
  await writeDb(data);
  return record;
};

export const listReports = async (user) => {
  ensurePermission(user, PERMISSIONS.REPORTS_VIEW, "No tienes permiso para ver informes.");
  const data = await readDb();
  return (data.reports || []).slice(0, 100).map((report) => ({
    ...report,
    generatedByUser: report.generatedBy
      ? sanitizeUser(data.users.find((item) => item.id === report.generatedBy) || {})
      : null
  }));
};

export const generateReport = async (user, payload = {}) => {
  ensurePermission(user, PERMISSIONS.REPORTS_GENERATE, "No tienes permiso para generar informes.");
  const data = await readDb();
  const report = buildReportPayload(data, user, payload.type || "general", payload.filters || payload);
  await persistReport(data, user, report);
  return report;
};

const worksheetXml = (name, rows) => `
  <Worksheet ss:Name="${escapeXml(name)}">
    <Table>
      ${rows
        .map(
          (row) => `
        <Row>${row
          .map((cell) => `<Cell><Data ss:Type="${typeof cell === "number" ? "Number" : "String"}">${escapeXml(cell)}</Data></Cell>`)
          .join("")}</Row>`
        )
        .join("")}
    </Table>
  </Worksheet>`;

const reportToExcelXml = (report) => {
  const statsRows = [
    ["Indicador", "Valor"],
    ["Total miembros", report.summary.totalMembers],
    ["Activos", report.summary.activeMembers],
    ["Inactivos", report.summary.inactiveMembers],
    ["Nuevos", report.summary.newMembers],
    ["Bautizados", report.summary.baptizedMembers],
    ["Lideres", report.summary.leaders],
    ["Mentores", report.summary.mentors],
    ["Alertas activas", report.summary.activeAlerts],
    ["Asistencia", formatPercent(report.summary.attendancePercent)],
    ["Efectividad mentorias", formatPercent(report.summary.mentorshipEffectiveness)]
  ];
  const memberRows = [
    ["Nombre", "Documento", "Telefono", "Correo", "Rol", "Estado", "Bautizado", "Edad", "Mentor"],
    ...report.tables.members.map((item) => [
      item.fullName,
      item.documentId || "",
      item.phone || "",
      item.email || "",
      item.memberRole || "Miembro",
      item.status || "",
      item.baptized || "",
      Number(item.age || 0),
      item.assignedMentor?.fullName || ""
    ])
  ];
  const followRows = [
    ["Tipo", "Fecha", "Miembro", "Responsable", "Detalle"],
    ...report.tables.followUps.map((item) => [
      item.kind,
      item.date || "",
      report.tables.members.find((member) => member.id === item.youthId)?.fullName || item.youthId,
      report.generatedBy.fullName,
      item.observations || item.notes || item.result || item.pastoralNotes || ""
    ])
  ];
  const attendanceRows = [
    ["Fecha", "Sesion", "Miembro", "Presente"],
    ...report.tables.attendance.map((item) => [
      item.sessionDate,
      item.sessionTitle,
      report.tables.members.find((member) => member.id === item.youthId)?.fullName || item.youthId,
      item.present ? "SI" : "NO"
    ])
  ];
  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>CRM Generacion de Gloria</Author>
    <Title>Informe institucional</Title>
    <Created>${report.generatedAt}</Created>
  </DocumentProperties>
  ${worksheetXml("Estadisticas", statsRows)}
  ${worksheetXml("Miembros", memberRows)}
  ${worksheetXml("Seguimientos", followRows)}
  ${worksheetXml("Asistencia", attendanceRows)}
</Workbook>`;
};

const reportToExcelJs = async (report) => {
  try {
    const excelModule = await import("exceljs");
    const Workbook = excelModule.default?.Workbook || excelModule.Workbook;
    if (!Workbook) return null;
    const workbook = new Workbook();
    workbook.creator = "CRM Generacion de Gloria";
    workbook.created = new Date(report.generatedAt);
    workbook.properties.date1904 = false;

    const addSheet = (name, rows) => {
      const sheet = workbook.addWorksheet(name);
      sheet.addRows(rows);
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF84974A" }
      };
      sheet.columns.forEach((column) => {
        const max = Math.max(
          12,
          ...column.values.map((value) => String(value || "").length + 2)
        );
        column.width = Math.min(max, 42);
      });
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: rows[0].length }
      };
      return sheet;
    };

    addSheet("Estadisticas", [
      ["Generacion de Gloria CRM", ""],
      ["Fecha generacion", report.generatedAt],
      ["Indicador", "Valor"],
      ["Total miembros", report.summary.totalMembers],
      ["Activos", report.summary.activeMembers],
      ["Inactivos", report.summary.inactiveMembers],
      ["Bautizados", report.summary.baptizedMembers],
      ["Alertas activas", report.summary.activeAlerts],
      ["Asistencia", formatPercent(report.summary.attendancePercent)],
      ["Efectividad mentorias", formatPercent(report.summary.mentorshipEffectiveness)]
    ]);
    addSheet("Miembros", [
      ["Nombre", "Documento", "Telefono", "Correo", "Rol", "Estado", "Bautizado", "Edad", "Mentor"],
      ...report.tables.members.map((item) => [
        item.fullName,
        item.documentId || "",
        item.phone || "",
        item.email || "",
        item.memberRole || "Miembro",
        item.status || "",
        item.baptized || "",
        Number(item.age || 0),
        item.assignedMentor?.fullName || ""
      ])
    ]);
    addSheet("Seguimientos", [
      ["Tipo", "Fecha", "Miembro", "Detalle"],
      ...report.tables.followUps.map((item) => [
        item.kind,
        item.date || "",
        report.tables.members.find((member) => member.id === item.youthId)?.fullName || item.youthId,
        item.observations || item.notes || item.result || item.pastoralNotes || ""
      ])
    ]);
    addSheet("Asistencia", [
      ["Fecha", "Sesion", "Miembro", "Presente"],
      ...report.tables.attendance.map((item) => [
        item.sessionDate,
        item.sessionTitle,
        report.tables.members.find((member) => member.id === item.youthId)?.fullName || item.youthId,
        item.present ? "SI" : "NO"
      ])
    ]);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  } catch {
    return null;
  }
};

const pdfEscape = (value) =>
  String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const buildSimplePdf = (report) => {
  const lines = [
    "Generacion de Gloria CRM",
    "Informe institucional ejecutivo",
    `Fecha de generacion: ${new Date(report.generatedAt).toLocaleString("es-CO")}`,
    `Generado por: ${report.generatedBy.fullName}`,
    "",
    "Resumen ejecutivo",
    `Total de miembros: ${report.summary.totalMembers}`,
    `Miembros activos: ${report.summary.activeMembers}`,
    `Miembros inactivos: ${report.summary.inactiveMembers}`,
    `Nuevos miembros: ${report.summary.newMembers}`,
    `Bautizados: ${report.summary.baptizedMembers}`,
    `Lideres: ${report.summary.leaders}`,
    `Mentores: ${report.summary.mentors}`,
    `Visitas: ${report.summary.visits}`,
    `Llamadas: ${report.summary.calls}`,
    `Reuniones: ${report.summary.meetings}`,
    `Alertas activas: ${report.summary.activeAlerts}`,
    `Asistencia: ${formatPercent(report.summary.attendancePercent)}`,
    `Efectividad de mentorias: ${formatPercent(report.summary.mentorshipEffectiveness)}`,
    "",
    "Nota institucional: reporte generado desde datos activos del CRM, con filtros aplicados y trazabilidad de descarga.",
    "Formato: margenes institucionales tipo APA, encabezado jerarquico y resumen estadistico."
  ];
  const content = [
    "BT",
    "/F1 16 Tf",
    "72 760 Td",
    ...lines.flatMap((line, index) => [
      index === 1 ? "/F1 14 Tf" : index === 5 ? "/F1 13 Tf" : "/F1 11 Tf",
      `(${pdfEscape(line)}) Tj`,
      "0 -24 Td"
    ]),
    "ET"
  ].join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "binary");
};

export const exportReportExcel = async (user, query = {}) => {
  ensurePermission(user, PERMISSIONS.REPORTS_EXPORT, "No tienes permiso para exportar informes.");
  const data = await readDb();
  const report = buildReportPayload(data, user, query.type || "general", query);
  await persistReport(data, user, report);
  await logReportDownload(data, user, report.id, "excel");
  const xlsx = await reportToExcelJs(report);
  if (xlsx) {
    return {
      filename: `informe-generacion-de-gloria-${report.generatedAt.slice(0, 10)}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: xlsx
    };
  }
  return {
    filename: `informe-generacion-de-gloria-${report.generatedAt.slice(0, 10)}.xls`,
    contentType: "application/vnd.ms-excel; charset=utf-8",
    content: reportToExcelXml(report)
  };
};

export const exportReportPdf = async (user, query = {}) => {
  ensurePermission(user, PERMISSIONS.REPORTS_EXPORT, "No tienes permiso para exportar informes.");
  const data = await readDb();
  const report = buildReportPayload(data, user, query.type || "general", query);
  await persistReport(data, user, report);
  await logReportDownload(data, user, report.id, "pdf");
  return {
    filename: `informe-generacion-de-gloria-${report.generatedAt.slice(0, 10)}.pdf`,
    content: buildSimplePdf(report)
  };
};

export const resetUserPassword = async (user, userId) => {
  ensurePermission(user, PERMISSIONS.USERS_MANAGE, "Solo el administrador puede resetear contrasenas.");
  const data = await readDb();
  const index = data.users.findIndex((item) => item.id === userId);
  if (index === -1) {
    const error = new Error("Usuario no encontrado.");
    error.status = 404;
    throw error;
  }
  const temporaryPassword = `Gdg-${Math.random().toString(36).slice(2, 8)}${Math.floor(10 + Math.random() * 89)}*`;
  data.users[index] = {
    ...data.users[index],
    passwordHash: hashPassword(temporaryPassword),
    mustChangePassword: true,
    updatedAt: nowIso()
  };
  logActivity(data, user, "user.password_reset", "user", userId, {});
  await writeDb(data);
  return { user: sanitizeUserWithAssignments(data, data.users[index]), temporaryPassword };
};

export const changeOwnPassword = async (user, payload) => {
  const data = await readDb();
  const index = data.users.findIndex((item) => item.id === user.id);
  if (index === -1) {
    const error = new Error("Usuario no encontrado.");
    error.status = 404;
    throw error;
  }
  const currentPassword = String(payload.currentPassword || "");
  const nextPassword = String(payload.newPassword || "");
  if (!comparePassword(currentPassword, data.users[index].passwordHash)) {
    const error = new Error("La contrasena actual no es correcta.");
    error.status = 400;
    throw error;
  }
  if (nextPassword.length < 8) {
    const error = new Error("La nueva contrasena debe tener al menos 8 caracteres.");
    error.status = 400;
    throw error;
  }
  data.users[index] = {
    ...data.users[index],
    passwordHash: hashPassword(nextPassword),
    mustChangePassword: false,
    updatedAt: nowIso()
  };
  logActivity(data, user, "auth.password_change", "user", user.id, {});
  await writeDb(data);
  return sanitizeUser(data.users[index]);
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
