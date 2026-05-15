import { parse } from "node:url";

export const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  });
  res.end(JSON.stringify(payload));
};

export const sendText = (res, statusCode, payload, headers = {}) => {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    ...headers
  });
  res.end(payload);
};

export const sendBuffer = (res, statusCode, payload, headers = {}) => {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    ...headers
  });
  res.end(payload);
};

export const notFound = (res) =>
  sendJson(res, 404, { message: "Recurso no encontrado." });

export const getRequestBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("JSON_INVALIDO");
  }
};

export const getQuery = (req) => parse(req.url, true).query;

export const setNoContent = (res) => {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  });
  res.end();
};
