import jwt from "jsonwebtoken";
import { jwtSecret } from "../config/env.js";

export const createToken = (user) => jwt.sign(
  { id: user.id, email: user.email, username: user.username, role: user.role },
  jwtSecret,
  { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
);