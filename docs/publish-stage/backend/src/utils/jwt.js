import crypto from "node:crypto";

const b64url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const decodeB64Url = (value) =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8"
  );

export const signToken = (payload, secret, expiresInHours = 10) => {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + expiresInHours * 60 * 60;
  const fullPayload = { ...payload, exp };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(fullPayload)
  )}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${unsigned}.${signature}`;
};

export const verifyToken = (token, secret) => {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) {
    throw new Error("TOKEN_INVALIDO");
  }
  const unsigned = `${header}.${payload}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  if (expected !== signature) {
    throw new Error("TOKEN_INVALIDO");
  }
  const decoded = JSON.parse(decodeB64Url(payload));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("TOKEN_EXPIRADO");
  }
  return decoded;
};
