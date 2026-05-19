import { env } from "../config/env.js";

const buckets = new Map();

export const checkRateLimit = (key, limit = env.rateLimitMax) => {
  const now = Date.now();
  const current = buckets.get(key) || { count: 0, resetAt: now + env.rateLimitWindowMs };
  if (current.resetAt <= now) {
    current.count = 0;
    current.resetAt = now + env.rateLimitWindowMs;
  }
  current.count += 1;
  buckets.set(key, current);
  if (current.count <= limit) return true;
  const error = new Error("Demasiados intentos. Intenta nuevamente mas tarde.");
  error.status = 429;
  throw error;
};

