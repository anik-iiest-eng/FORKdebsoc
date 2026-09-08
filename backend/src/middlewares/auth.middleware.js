import jwt from "jsonwebtoken";
import { jwtSecret } from "../config/env.js";

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  const cookieToken = req.cookies?.debsoc_token;
  const token = cookieToken || bearerToken;

  if (!token) {
    return res.status(401).json({ error: "Access Denied: No token provided" });
  }

  try {
    const verified = jwt.verify(token, jwtSecret);
    req.user = verified; // { id, role }
    next();
  } catch (err) {
    res.status(403).json({ error: "Invalid or expired token" });
  }
};