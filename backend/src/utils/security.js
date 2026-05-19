import crypto from "node:crypto";

const SCRYPT_PREFIX = "scrypt";
const SCRYPT_KEY_LENGTH = 64;

export const hashLegacyPassword = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex");

export const hashPassword = (value) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(String(value || ""), salt, SCRYPT_KEY_LENGTH)
    .toString("hex");
  return `${SCRYPT_PREFIX}$${salt}$${hash}`;
};

export const hashToken = (value) =>
  crypto.createHash("sha256").update(String(value || "")).digest("hex");

export const createSecureToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("base64url");

export const comparePassword = (plain, hashed) => {
  const stored = String(hashed || "");
  if (stored.startsWith(`${SCRYPT_PREFIX}$`)) {
    const [, salt, hash] = stored.split("$");
    if (!salt || !hash) return false;
    const candidate = crypto
      .scryptSync(String(plain || ""), salt, SCRYPT_KEY_LENGTH)
      .toString("hex");
    if (candidate.length !== hash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
  }
  return hashLegacyPassword(plain) === stored;
};
