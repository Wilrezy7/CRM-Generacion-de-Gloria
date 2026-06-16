import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { env } from "./config/env.js";
import { sendJson, sendText, notFound, getRequestBody, getQuery, setNoContent } from "./utils/http.js";
import {
  attendAlert,
  bootstrapSystem,
  createAttendanceSession,
  createInteraction,
  createUser,
  createVisitor,
  createYouth,
  deleteUser,
  deleteVisitor,
  deleteYouth,
  exportYouthsExcelXml,
  getDashboard,
  getSetupStatus,
  getYouthTimeline,
  importYouthsFromCsv,
  importStructuredMembers,
  listAlerts,
  listAttendance,
  listInteractions,
  listUsers,
  listVisitors,
  listYouths,
  convertVisitorToYouth,
  updateUser,
  updateVisitor,
  updateYouth
} from "./services/crmService.js";
import { getStorageInfo, probeStorage } from "./repositories/database.js";
import {
  changePassword,
  createAccessRequest,
  listAuditLogs,
  loginUser,
  logoutSession,
  refreshSession,
  requestPasswordReset,
  resetPassword,
  validateAccessToken,
  verifyAccessRequest
} from "./services/authService.js";
import { requirePermission } from "./services/rbac.js";
import { checkRateLimit } from "./utils/rateLimit.js";

const getUserFromRequest = async (req) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  return validateAccessToken(token);
};

const serveStatic = async (req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    notFound(res);
    return;
  }
  const relativePath = decodedPath.replace(/^[/\\]+/, "");
  const filePath = path.resolve(env.frontendRoot, relativePath);
  const frontendRoot = path.resolve(env.frontendRoot);
  if (!filePath.startsWith(`${frontendRoot}${path.sep}`) && filePath !== frontendRoot) {
    notFound(res);
    return;
  }
  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    try {
      const fallback = await fs.readFile(path.join(env.frontendRoot, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fallback);
    } catch {
      notFound(res);
    }
  }
};

const withHandler = async (res, action) => {
  try {
    await action();
  } catch (error) {
    if (error.message === "JSON_INVALIDO") {
      sendJson(res, 400, { message: "El cuerpo de la solicitud no es JSON valido." });
      return;
    }
    if (error.message === "TOKEN_INVALIDO" || error.message === "TOKEN_EXPIRADO") {
      sendJson(res, 401, { message: "Sesion invalida o vencida." });
      return;
    }
    sendJson(res, error.status || 500, {
      message: error.message || "Ocurrio un error inesperado."
    });
  }
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    setNoContent(res, req);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/health" && req.method === "GET") {
    await withHandler(res, async () => {
      const storage = await probeStorage();
      let setup = null;
      if (storage.ready) {
        setup = await getSetupStatus();
      }
      sendJson(res, 200, {
        ok: storage.ready,
        app: "Generacion de Gloria CRM",
        storage,
        setup
      });
    });
    return;
  }

  if (url.pathname === "/api/setup/status" && req.method === "GET") {
    await withHandler(res, async () => {
      sendJson(res, 200, await getSetupStatus());
    });
    return;
  }

  if (url.pathname === "/api/setup/bootstrap" && req.method === "POST") {
    await withHandler(res, async () => {
      sendJson(res, 201, await bootstrapSystem(await getRequestBody(req)));
    });
    return;
  }

  if (url.pathname === "/api/setup/import-members" && req.method === "POST") {
    await withHandler(res, async () => {
      const setup = await getSetupStatus();
      if (!setup.setupRequired) {
        const error = new Error(
          "La importacion inicial sin autenticacion solo esta disponible antes de crear el primer administrador."
        );
        error.status = 403;
        throw error;
      }
      sendJson(
        res,
        201,
        await importStructuredMembers(await getRequestBody(req), {
          bypassAdminCheck: true
        })
      );
    });
    return;
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    await withHandler(res, async () => {
      checkRateLimit(`login:${req.socket.remoteAddress}`);
      const body = await getRequestBody(req);
      sendJson(
        res,
        200,
        await loginUser(body, {
          ip: req.socket.remoteAddress,
          userAgent: req.headers["user-agent"] || ""
        })
      );
    });
    return;
  }

  if (url.pathname === "/api/auth/refresh" && req.method === "POST") {
    await withHandler(res, async () => {
      sendJson(
        res,
        200,
        await refreshSession(await getRequestBody(req), {
          ip: req.socket.remoteAddress,
          userAgent: req.headers["user-agent"] || ""
        })
      );
    });
    return;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    await withHandler(res, async () => {
      const auth = req.headers.authorization || "";
      await logoutSession({
        accessToken: auth.startsWith("Bearer ") ? auth.slice(7) : "",
        ...(await getRequestBody(req))
      });
      setNoContent(res, req);
    });
    return;
  }

  if (url.pathname === "/api/auth/forgot-password" && req.method === "POST") {
    await withHandler(res, async () => {
      checkRateLimit(`forgot:${req.socket.remoteAddress}`);
      sendJson(res, 200, await requestPasswordReset(await getRequestBody(req)));
    });
    return;
  }

  if (url.pathname === "/api/auth/reset-password" && req.method === "POST") {
    await withHandler(res, async () => {
      sendJson(res, 200, await resetPassword(await getRequestBody(req)));
    });
    return;
  }

  if (url.pathname === "/api/access-requests" && req.method === "POST") {
    await withHandler(res, async () => {
      checkRateLimit(`access-request:${req.socket.remoteAddress}`);
      sendJson(res, 201, await createAccessRequest(await getRequestBody(req)));
    });
    return;
  }

  if (url.pathname === "/api/access-requests/verify" && req.method === "POST") {
    await withHandler(res, async () => {
      sendJson(res, 200, await verifyAccessRequest(await getRequestBody(req)));
    });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await withHandler(res, async () => {
      const user = await getUserFromRequest(req);
      if (!user) {
        sendJson(res, 401, { message: "Debes iniciar sesion." });
        return;
      }

      if (url.pathname === "/api/me" && req.method === "GET") {
        sendJson(res, 200, { user, system: { storage: getStorageInfo() } });
        return;
      }
      if (url.pathname === "/api/auth/change-password" && req.method === "POST") {
        sendJson(res, 200, await changePassword(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname === "/api/dashboard" && req.method === "GET") {
        requirePermission(user, "dashboard:read");
        sendJson(res, 200, await getDashboard(user));
        return;
      }
      if (url.pathname === "/api/youths" && req.method === "GET") {
        requirePermission(user, "youths:read");
        sendJson(res, 200, await listYouths(user, getQuery(req)));
        return;
      }
      if (url.pathname === "/api/youths" && req.method === "POST") {
        requirePermission(user, "youths:write");
        sendJson(res, 201, await createYouth(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/youths\/[^/]+$/) && req.method === "PUT") {
        requirePermission(user, "youths:write");
        const youthId = url.pathname.split("/").pop();
        sendJson(res, 200, await updateYouth(user, youthId, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/youths\/[^/]+$/) && req.method === "DELETE") {
        requirePermission(user, "youths:write");
        const youthId = url.pathname.split("/").pop();
        await deleteYouth(user, youthId);
        setNoContent(res, req);
        return;
      }
      if (url.pathname.match(/^\/api\/youths\/[^/]+\/timeline$/) && req.method === "GET") {
        requirePermission(user, "youths:read");
        const youthId = url.pathname.split("/")[3];
        sendJson(res, 200, await getYouthTimeline(user, youthId));
        return;
      }
      if (url.pathname === "/api/attendance" && req.method === "GET") {
        requirePermission(user, "attendance:read");
        sendJson(res, 200, await listAttendance(user));
        return;
      }
      if (url.pathname === "/api/attendance" && req.method === "POST") {
        requirePermission(user, "attendance:write");
        sendJson(
          res,
          201,
          await createAttendanceSession(user, await getRequestBody(req))
        );
        return;
      }
      if (url.pathname === "/api/interactions" && req.method === "GET") {
        requirePermission(user, "interactions:read");
        sendJson(res, 200, await listInteractions(user));
        return;
      }
      if (url.pathname === "/api/interactions" && req.method === "POST") {
        requirePermission(user, "interactions:write");
        sendJson(res, 201, await createInteraction(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname === "/api/alerts" && req.method === "GET") {
        requirePermission(user, "alerts:read");
        sendJson(res, 200, await listAlerts(user));
        return;
      }
      if (url.pathname.match(/^\/api\/alerts\/[^/]+\/attend$/) && req.method === "PATCH") {
        requirePermission(user, "alerts:read");
        const alertId = url.pathname.split("/")[3];
        sendJson(res, 200, await attendAlert(user, alertId));
        return;
      }
      if (url.pathname === "/api/visitors" && req.method === "GET") {
        requirePermission(user, "consolidation:read");
        sendJson(res, 200, await listVisitors(user, getQuery(req)));
        return;
      }
      if (url.pathname === "/api/visitors" && req.method === "POST") {
        requirePermission(user, "consolidation:write");
        sendJson(res, 201, await createVisitor(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/visitors\/[^/]+$/) && req.method === "PUT") {
        requirePermission(user, "consolidation:write");
        const visitorId = url.pathname.split("/").pop();
        sendJson(res, 200, await updateVisitor(user, visitorId, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/visitors\/[^/]+$/) && req.method === "DELETE") {
        requirePermission(user, "consolidation:write");
        const visitorId = url.pathname.split("/").pop();
        await deleteVisitor(user, visitorId);
        setNoContent(res, req);
        return;
      }
      if (url.pathname.match(/^\/api\/visitors\/[^/]+\/convert$/) && req.method === "POST") {
        requirePermission(user, "consolidation:write");
        const visitorId = url.pathname.split("/")[3];
        sendJson(res, 201, await convertVisitorToYouth(user, visitorId));
        return;
      }
      if (url.pathname === "/api/users" && req.method === "GET") {
        requirePermission(user, "users:write");
        sendJson(res, 200, await listUsers(user));
        return;
      }
      if (url.pathname === "/api/users" && req.method === "POST") {
        requirePermission(user, "users:write");
        sendJson(res, 201, await createUser(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/users\/[^/]+$/) && req.method === "PUT") {
        requirePermission(user, "users:write");
        const userId = url.pathname.split("/").pop();
        sendJson(res, 200, await updateUser(user, userId, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/users\/[^/]+$/) && req.method === "DELETE") {
        requirePermission(user, "users:write");
        const userId = url.pathname.split("/").pop();
        await deleteUser(user, userId);
        setNoContent(res, req);
        return;
      }
      if (url.pathname === "/api/audit-logs" && req.method === "GET") {
        requirePermission(user, "users:write");
        sendJson(res, 200, await listAuditLogs());
        return;
      }
      if (url.pathname === "/api/export/youths" && req.method === "GET") {
        requirePermission(user, "reports:read");
        const xml = await exportYouthsExcelXml(user);
        sendText(res, 200, xml, {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": "attachment; filename=jovenes.xls"
        });
        return;
      }
      if (url.pathname === "/api/import/youths" && req.method === "POST") {
        requirePermission(user, "youths:write");
        sendJson(res, 201, await importYouthsFromCsv(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname === "/api/import/members" && req.method === "POST") {
        requirePermission(user, "youths:write");
        sendJson(
          res,
          201,
          await importStructuredMembers(await getRequestBody(req), { user })
        );
        return;
      }

      notFound(res);
    });
    return;
  }

  await serveStatic(req, res);
});

server.listen(env.port, () => {
  console.log(`CRM server running on port ${env.port}`);
});
