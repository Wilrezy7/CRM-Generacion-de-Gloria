import { env } from "../config/env.js";
import { readDb } from "../repositories/database.js";
import { verifyToken } from "../utils/jwt.js";
import { sanitizeUser } from "../services/crmService.js";

export const getAuthenticatedUser = async (authorization = "") => {
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const decoded = verifyToken(token, env.jwtSecret);
  const data = await readDb();
  const user = data.users.find((item) => item.id === decoded.sub);
  if (!user || user.active === false) return null;
  return sanitizeUser(user);
};
