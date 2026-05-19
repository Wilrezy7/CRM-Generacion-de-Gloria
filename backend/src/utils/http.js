import { parse } from "node:url";
import { env } from "../config/env.js";

const corsHeaders = (req) => {
  const origin = req?.headers?.origin || "";
  const allowed =
    env.corsOrigins.length === 0 || env.corsOrigins.includes(origin)
      ? origin || env.corsOrigins[0] || "*"
      : env.corsOrigins[0] || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin"
  };
};

export const sendJson = (res, statusCode, payload, req = null) => {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(req)
  });
  res.end(JSON.stringify(payload));
};

export const sendText = (res, statusCode, payload, headers = {}, req = null) => {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...corsHeaders(req),
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

export const setNoContent = (res, req = null) => {
  res.writeHead(204, {
    ...corsHeaders(req)
  });
  res.end();
};
