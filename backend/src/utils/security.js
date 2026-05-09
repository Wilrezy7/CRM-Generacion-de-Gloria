import crypto from "node:crypto";

export const hashPassword = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

export const comparePassword = (plain, hashed) =>
  hashPassword(plain) === hashed;
