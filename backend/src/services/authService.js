import { env } from "../config/env.js";
import { readDb, writeDb } from "../repositories/database.js";
import { signTokenMinutes, verifyToken } from "../utils/jwt.js";
import {
  comparePassword,
  createSecureToken,
  hashPassword,
  hashToken
} from "../utils/security.js";
import { createId, normalizeText, nowIso } from "../utils/helpers.js";
import { sendEmail } from "./emailService.js";
import { getPermissions, normalizeRole } from "./rbac.js";

const minutesFromNow = (minutes) =>
  new Date(Date.now() + minutes * 60 * 1000).toISOString();

const daysFromNow = (days) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const isExpired = (iso) => !iso || new Date(iso).getTime() <= Date.now();

export const sanitizeAuthUser = (user) => {
  const { passwordHash, password_hash, ...safeUser } = user || {};
  const role = normalizeRole(safeUser.role);
  return {
    ...safeUser,
    role,
    permissions: getPermissions(role)
  };
};

export const audit = async (action, actorId, metadata = {}) => {
  const data = await readDb();
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.auditLogs.unshift({
    id: createId("aud"),
    action,
    actorId: actorId || null,
    metadata,
    createdAt: nowIso()
  });
  data.auditLogs = data.auditLogs.slice(0, 500);
  await writeDb(data);
};

const issueSession = async (data, user, metadata = {}) => {
  data.userSessions = Array.isArray(data.userSessions) ? data.userSessions : [];
  const sessionId = createId("ses");
  const refreshToken = createSecureToken(48);
  const accessToken = signTokenMinutes(
    { sub: user.id, role: normalizeRole(user.role), sid: sessionId },
    env.jwtSecret,
    env.jwtAccessMinutes
  );
  data.userSessions.push({
    id: sessionId,
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: daysFromNow(env.refreshTokenDays),
    revokedAt: null,
    createdAt: nowIso(),
    metadata
  });
  return { accessToken, refreshToken };
};

export const loginUser = async ({ email, password }, metadata = {}) => {
  const data = await readDb();
  const normalizedEmail = normalizeText(email).toLowerCase();
  const user = data.users.find((item) => String(item.email || "").toLowerCase() === normalizedEmail);
  if (!user || !comparePassword(String(password || ""), user.passwordHash)) {
    await audit("auth.login_failed", null, { email: normalizedEmail, ...metadata });
    const error = new Error("Credenciales invalidas.");
    error.status = 401;
    throw error;
  }
  if (user.active === false) {
    const error = new Error("Usuario inactivo. Solicita reactivacion al administrador.");
    error.status = 403;
    throw error;
  }
  user.role = normalizeRole(user.role);
  user.lastLogin = nowIso();
  if (!String(user.passwordHash || "").startsWith("scrypt$")) {
    user.passwordHash = hashPassword(String(password || ""));
  }
  const tokens = await issueSession(data, user, metadata);
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.auditLogs.unshift({
    id: createId("aud"),
    action: "auth.login",
    actorId: user.id,
    metadata,
    createdAt: nowIso()
  });
  await writeDb(data);
  return { ...tokens, token: tokens.accessToken, user: sanitizeAuthUser(user) };
};

export const validateAccessToken = async (token) => {
  const decoded = verifyToken(token, env.jwtSecret);
  const data = await readDb();
  const user = data.users.find((item) => item.id === decoded.sub);
  if (!user || user.active === false) return null;
  if (decoded.sid) {
    const session = (data.userSessions || []).find((item) => item.id === decoded.sid);
    if (!session || session.revokedAt || isExpired(session.expiresAt)) return null;
  }
  return sanitizeAuthUser(user);
};

export const refreshSession = async ({ refreshToken }, metadata = {}) => {
  const data = await readDb();
  const tokenHash = hashToken(refreshToken);
  const session = (data.userSessions || []).find((item) => item.tokenHash === tokenHash);
  if (!session || session.revokedAt || isExpired(session.expiresAt)) {
    const error = new Error("Sesion invalida o vencida.");
    error.status = 401;
    throw error;
  }
  const user = data.users.find((item) => item.id === session.userId && item.active !== false);
  if (!user) {
    const error = new Error("Usuario no encontrado o inactivo.");
    error.status = 401;
    throw error;
  }
  session.revokedAt = nowIso();
  const tokens = await issueSession(data, user, metadata);
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.auditLogs.unshift({
    id: createId("aud"),
    action: "auth.refresh",
    actorId: user.id,
    metadata,
    createdAt: nowIso()
  });
  await writeDb(data);
  return { ...tokens, token: tokens.accessToken, user: sanitizeAuthUser(user) };
};

export const logoutSession = async ({ accessToken, refreshToken }, actorId = null) => {
  const data = await readDb();
  const decoded = accessToken ? verifyToken(accessToken, env.jwtSecret) : null;
  const refreshHash = refreshToken ? hashToken(refreshToken) : null;
  data.userSessions = (data.userSessions || []).map((session) => {
    if (
      (decoded?.sid && session.id === decoded.sid) ||
      (refreshHash && session.tokenHash === refreshHash)
    ) {
      return { ...session, revokedAt: session.revokedAt || nowIso() };
    }
    return session;
  });
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.auditLogs.unshift({
    id: createId("aud"),
    action: "auth.logout",
    actorId: actorId || decoded?.sub || null,
    metadata: {},
    createdAt: nowIso()
  });
  await writeDb(data);
};

export const requestPasswordReset = async ({ email }) => {
  const data = await readDb();
  const normalizedEmail = normalizeText(email).toLowerCase();
  const user = data.users.find((item) => String(item.email || "").toLowerCase() === normalizedEmail);
  if (!user) return { ok: true };
  const token = createSecureToken(36);
  data.passwordResets = Array.isArray(data.passwordResets) ? data.passwordResets : [];
  data.passwordResets.push({
    id: createId("rst"),
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: minutesFromNow(env.passwordResetMinutes),
    usedAt: null,
    createdAt: nowIso()
  });
  await writeDb(data);
  await sendEmail({
    to: user.email,
    subject: "Recuperacion de contrasena - Generacion de Gloria",
    text: `${env.appBaseUrl}/?resetToken=${token}`,
    metadata: { type: "password_reset", userId: user.id }
  });
  return { ok: true };
};

export const resetPassword = async ({ token, password }) => {
  if (String(password || "").length < 8) {
    const error = new Error("La contrasena debe tener al menos 8 caracteres.");
    error.status = 400;
    throw error;
  }
  const data = await readDb();
  const reset = (data.passwordResets || []).find((item) => item.tokenHash === hashToken(token));
  if (!reset || reset.usedAt || isExpired(reset.expiresAt)) {
    const error = new Error("Token de recuperacion invalido o vencido.");
    error.status = 400;
    throw error;
  }
  const user = data.users.find((item) => item.id === reset.userId);
  if (!user) {
    const error = new Error("Usuario no encontrado.");
    error.status = 404;
    throw error;
  }
  user.passwordHash = hashPassword(password);
  user.mustChangePassword = false;
  reset.usedAt = nowIso();
  data.userSessions = (data.userSessions || []).map((session) =>
    session.userId === user.id ? { ...session, revokedAt: session.revokedAt || nowIso() } : session
  );
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.auditLogs.unshift({
    id: createId("aud"),
    action: "auth.password_reset",
    actorId: user.id,
    metadata: {},
    createdAt: nowIso()
  });
  await writeDb(data);
  return { ok: true };
};

export const changePassword = async (user, { currentPassword, newPassword }) => {
  if (String(newPassword || "").length < 8) {
    const error = new Error("La nueva contrasena debe tener al menos 8 caracteres.");
    error.status = 400;
    throw error;
  }
  const data = await readDb();
  const current = data.users.find((item) => item.id === user.id);
  if (!current || !comparePassword(String(currentPassword || ""), current.passwordHash)) {
    const error = new Error("La contrasena actual no es correcta.");
    error.status = 400;
    throw error;
  }
  current.passwordHash = hashPassword(newPassword);
  current.mustChangePassword = false;
  current.updatedAt = nowIso();
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.auditLogs.unshift({
    id: createId("aud"),
    action: "auth.password_change",
    actorId: current.id,
    metadata: {},
    createdAt: nowIso()
  });
  await writeDb(data);
  return { ok: true };
};

export const createAccessRequest = async (payload) => {
  const data = await readDb();
  const email = normalizeText(payload.email).toLowerCase();
  const requestedRole = normalizeRole(payload.requestedRole || "MENTOR");
  const token = createSecureToken(36);
  const request = {
    id: createId("req"),
    fullName: normalizeText(payload.fullName),
    email,
    requestedRole,
    status: "PENDING_EMAIL",
    tokenHash: hashToken(token),
    expiresAt: minutesFromNow(env.emailVerificationMinutes),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  if (!request.fullName || !request.email) {
    const error = new Error("Nombre y correo son obligatorios.");
    error.status = 400;
    throw error;
  }
  data.accessRequests = Array.isArray(data.accessRequests) ? data.accessRequests : [];
  data.accessRequests.push(request);
  await writeDb(data);
  await sendEmail({
    to: email,
    subject: "Confirmacion de acceso - Generacion de Gloria",
    text: `${env.appBaseUrl}/?verifyAccessToken=${token}`,
    metadata: { type: "access_request", requestId: request.id }
  });
  return { ok: true };
};

export const verifyAccessRequest = async ({ token }) => {
  const data = await readDb();
  const request = (data.accessRequests || []).find((item) => item.tokenHash === hashToken(token));
  if (!request || isExpired(request.expiresAt)) {
    const error = new Error("Token de verificacion invalido o vencido.");
    error.status = 400;
    throw error;
  }
  request.status = "PENDING_ADMIN";
  request.updatedAt = nowIso();
  await writeDb(data);
  return { ok: true };
};

export const listAuditLogs = async () => {
  const data = await readDb();
  return (data.auditLogs || []).slice(0, 200);
};

