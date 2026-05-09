import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { env } from "./config/env.js";
import { sendJson, sendText, notFound, getRequestBody, getQuery, setNoContent } from "./utils/http.js";
import { signToken, verifyToken } from "./utils/jwt.js";
import {
  attendAlert,
  bootstrapSystem,
  createAttendanceSession,
  createInteraction,
  createUser,
  createYouth,
  deleteUser,
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
  listYouths,
  login,
  sanitizeUser,
  updateUser,
  updateYouth
} from "./services/crmService.js";
import { getStorageInfo, probeStorage, readDb } from "./repositories/database.js";

const getUserFromRequest = async (req) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const decoded = verifyToken(token, env.jwtSecret);
  const data = await readDb();
  const user = data.users.find((item) => item.id === decoded.sub);
  return user ? sanitizeUser(user) : null;
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
    setNoContent(res);
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
      const body = await getRequestBody(req);
      const user = await login(body);
      const token = signToken({ sub: user.id, role: user.role }, env.jwtSecret);
      sendJson(res, 200, { token, user });
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
      if (url.pathname === "/api/dashboard" && req.method === "GET") {
        sendJson(res, 200, await getDashboard(user));
        return;
      }
      if (url.pathname === "/api/youths" && req.method === "GET") {
        sendJson(res, 200, await listYouths(user, getQuery(req)));
        return;
      }
      if (url.pathname === "/api/youths" && req.method === "POST") {
        sendJson(res, 201, await createYouth(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/youths\/[^/]+$/) && req.method === "PUT") {
        const youthId = url.pathname.split("/").pop();
        sendJson(res, 200, await updateYouth(user, youthId, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/youths\/[^/]+$/) && req.method === "DELETE") {
        const youthId = url.pathname.split("/").pop();
        await deleteYouth(user, youthId);
        setNoContent(res);
        return;
      }
      if (url.pathname.match(/^\/api\/youths\/[^/]+\/timeline$/) && req.method === "GET") {
        const youthId = url.pathname.split("/")[3];
        sendJson(res, 200, await getYouthTimeline(user, youthId));
        return;
      }
      if (url.pathname === "/api/attendance" && req.method === "GET") {
        sendJson(res, 200, await listAttendance(user));
        return;
      }
      if (url.pathname === "/api/attendance" && req.method === "POST") {
        sendJson(
          res,
          201,
          await createAttendanceSession(user, await getRequestBody(req))
        );
        return;
      }
      if (url.pathname === "/api/interactions" && req.method === "GET") {
        sendJson(res, 200, await listInteractions(user));
        return;
      }
      if (url.pathname === "/api/interactions" && req.method === "POST") {
        sendJson(res, 201, await createInteraction(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname === "/api/alerts" && req.method === "GET") {
        sendJson(res, 200, await listAlerts(user));
        return;
      }
      if (url.pathname.match(/^\/api\/alerts\/[^/]+\/attend$/) && req.method === "PATCH") {
        const alertId = url.pathname.split("/")[3];
        sendJson(res, 200, await attendAlert(user, alertId));
        return;
      }
      if (url.pathname === "/api/users" && req.method === "GET") {
        sendJson(res, 200, await listUsers(user));
        return;
      }
      if (url.pathname === "/api/users" && req.method === "POST") {
        sendJson(res, 201, await createUser(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/users\/[^/]+$/) && req.method === "PUT") {
        const userId = url.pathname.split("/").pop();
        sendJson(res, 200, await updateUser(user, userId, await getRequestBody(req)));
        return;
      }
      if (url.pathname.match(/^\/api\/users\/[^/]+$/) && req.method === "DELETE") {
        const userId = url.pathname.split("/").pop();
        await deleteUser(user, userId);
        setNoContent(res);
        return;
      }
      if (url.pathname === "/api/export/youths" && req.method === "GET") {
        const xml = await exportYouthsExcelXml(user);
        sendText(res, 200, xml, {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": "attachment; filename=jovenes.xls"
        });
        return;
      }
      if (url.pathname === "/api/import/youths" && req.method === "POST") {
        sendJson(res, 201, await importYouthsFromCsv(user, await getRequestBody(req)));
        return;
      }
      if (url.pathname === "/api/import/members" && req.method === "POST") {
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
