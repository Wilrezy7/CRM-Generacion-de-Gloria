import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const parseEnvFile = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {}
};

parseEnvFile(path.join(projectRoot, ".env"));
parseEnvFile(path.join(projectRoot, ".env.local"));

const toBool = (value) => String(value || "").toLowerCase() === "true";
const normalizeUrl = (value) => String(value || "").replace(/\/+$/, "");
const normalizeSupabaseUrl = (value) =>
  normalizeUrl(value).replace(/\/rest\/v1$/i, "");

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const supabasePublishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "");
const supabaseSecretKey = String(
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);
const allowInsecurePublishableWrite = toBool(
  process.env.SUPABASE_ALLOW_INSECURE_PUBLISHABLE_WRITE
);
const supabaseEnforceRemote = toBool(
  process.env.SUPABASE_ENFORCE_REMOTE || (supabaseUrl ? "true" : "false")
);
const isProduction = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || "generacion-de-gloria-secret";
const parseList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const storageDriver =
  supabaseUrl && (supabaseSecretKey || (allowInsecurePublishableWrite && supabasePublishableKey))
    ? "supabase"
    : "file";

export const env = {
  port: Number(process.env.PORT || 4000),
  isProduction,
  jwtSecret,
  jwtAccessMinutes: Number(process.env.JWT_ACCESS_MINUTES || 60),
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  authMaxFailedAttempts: Number(process.env.AUTH_MAX_FAILED_ATTEMPTS || 5),
  authLockMinutes: Number(process.env.AUTH_LOCK_MINUTES || 15),
  appBaseUrl: normalizeUrl(process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 4000}`),
  corsOrigins: parseList(process.env.CORS_ORIGIN),
  emailDeliveryMode: process.env.EMAIL_DELIVERY_MODE || "log",
  emailWebhookUrl: process.env.EMAIL_WEBHOOK_URL || "",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 40),
  dataFile: path.resolve(process.env.DATA_FILE || path.resolve(__dirname, "../data/database.json")),
  frontendRoot: path.resolve(__dirname, "../../../frontend"),
  supabaseUrl,
  supabasePublishableKey,
  supabaseSecretKey,
  supabaseTable: process.env.SUPABASE_TABLE || "crm_state",
  supabaseRecordId: process.env.SUPABASE_RECORD_ID || "generacion-de-gloria",
  allowInsecurePublishableWrite,
  supabaseEnforceRemote,
  storageDriver
};

if (isProduction) {
  const errors = [];
  if (!jwtSecret || jwtSecret === "generacion-de-gloria-secret" || jwtSecret.length < 32) {
    errors.push("JWT_SECRET debe ser largo, aleatorio y no usar el valor demo.");
  }
  if (!supabaseUrl || !supabaseSecretKey) {
    errors.push("SUPABASE_URL y SUPABASE_SECRET_KEY son obligatorios en produccion.");
  }
  if (!supabaseEnforceRemote) {
    errors.push("SUPABASE_ENFORCE_REMOTE=true es obligatorio en produccion.");
  }
  if (allowInsecurePublishableWrite) {
    errors.push("SUPABASE_ALLOW_INSECURE_PUBLISHABLE_WRITE=false es obligatorio en produccion.");
  }
  if (errors.length) {
    throw new Error(`Configuracion insegura de produccion: ${errors.join(" ")}`);
  }
}
