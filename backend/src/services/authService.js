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
import { getPermissions, normalizeRole } from "./rbac.js";

const daysFromNow = (days) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const isExpired = (iso) => !iso || new Date(iso).getTime() <= Date.now();
const minutesFromNow = (minutes) =>
  new Date(Date.now() + minutes * 60 * 1000).toISOString();

export const appendAuditEntry = (data, action, actorId, metadata = {}) => {
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.auditLogs.unshift({
    id: createId("aud"),
    action,
    actorId: actorId || null,
    metadata,
    createdAt: nowIso()
  });
  data.auditLogs = data.auditLogs.slice(0, 500);
};

export const sanitizeAuthUser = (user) => {
  const { passwordHash, password_hash, ...safeUser } = user || {};
  const role = normalizeRole(safeUser.role);
  const hasPassword = Boolean(passwordHash || password_hash);
  return {
    ...safeUser,
    role,
    hasPassword,
    passwordAssigned: hasPassword,
    accessBlocked: safeUser.accessBlocked === true,
    permissions: getPermissions(role)
  };
};

export const audit = async (action, actorId, metadata = {}) => {
  const data = await readDb();
  appendAuditEntry(data, action, actorId, metadata);
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
  const genericError = () => {
    const error = new Error("Credenciales invalidas.");
    error.status = 401;
    return error;
  };

  if (!user) {
    appendAuditEntry(data, "auth.login_failed", null, { email: normalizedEmail, ...metadata });
    await writeDb(data);
    throw genericError();
  }

  if (user.lockedUntil && !isExpired(user.lockedUntil)) {
    appendAuditEntry(data, "auth.login_blocked_temporary", user.id, {
      email: normalizedEmail,
      lockedUntil: user.lockedUntil,
      ...metadata
    });
    await writeDb(data);
    const error = new Error("Acceso bloqueado temporalmente por intentos fallidos.");
    error.status = 423;
    throw error;
  }

  if (!user.passwordHash || !comparePassword(String(password || ""), user.passwordHash)) {
    user.failedLoginCount = Number(user.failedLoginCount || 0) + 1;
    if (user.failedLoginCount >= env.authMaxFailedAttempts) {
      user.lockedUntil = minutesFromNow(env.authLockMinutes);
      appendAuditEntry(data, "auth.login_locked_temporary", user.id, {
        email: normalizedEmail,
        lockedUntil: user.lockedUntil,
        ...metadata
      });
    } else {
      appendAuditEntry(data, "auth.login_failed", user.id, { email: normalizedEmail, ...metadata });
    }
    await writeDb(data);
    if (!user.passwordHash) {
      const error = new Error("Cuenta pendiente de asignacion de contrasena por el administrador.");
      error.status = 403;
      throw error;
    }
    throw genericError();
  }

  if (user.active === false) {
    appendAuditEntry(data, "auth.login_denied_inactive", user.id, { email: normalizedEmail, ...metadata });
    await writeDb(data);
    const error = new Error("Usuario inactivo. Solicita reactivacion al administrador.");
    error.status = 403;
    throw error;
  }
  if (user.accessBlocked === true) {
    appendAuditEntry(data, "auth.login_denied_blocked", user.id, { email: normalizedEmail, ...metadata });
    await writeDb(data);
    const error = new Error("Acceso bloqueado por el administrador.");
    error.status = 403;
    throw error;
  }

  user.role = normalizeRole(user.role);
  user.lastLogin = nowIso();
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  if (!String(user.passwordHash || "").startsWith("scrypt$")) {
    user.passwordHash = hashPassword(String(password || ""));
  }
  const tokens = await issueSession(data, user, metadata);
  appendAuditEntry(data, "auth.login", user.id, metadata);
  await writeDb(data);
  return { ...tokens, token: tokens.accessToken, user: sanitizeAuthUser(user) };
};

export const validateAccessToken = async (token) => {
  const decoded = verifyToken(token, env.jwtSecret);
  const data = await readDb();
  const user = data.users.find((item) => item.id === decoded.sub);
  if (!user || user.active === false || user.accessBlocked === true) return null;
  if (user.lockedUntil && !isExpired(user.lockedUntil)) return null;
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
  const user = data.users.find(
    (item) =>
      item.id === session.userId &&
      item.active !== false &&
      item.accessBlocked !== true &&
      !(item.lockedUntil && !isExpired(item.lockedUntil))
  );
  if (!user) {
    const error = new Error("Usuario no encontrado o inactivo.");
    error.status = 401;
    throw error;
  }
  session.revokedAt = nowIso();
  const tokens = await issueSession(data, user, metadata);
  appendAuditEntry(data, "auth.refresh", user.id, metadata);
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
  appendAuditEntry(data, "auth.logout", actorId || decoded?.sub || null, {});
  await writeDb(data);
};

export const listAuditLogs = async () => {
  const data = await readDb();
  return (data.auditLogs || []).slice(0, 200);
};
