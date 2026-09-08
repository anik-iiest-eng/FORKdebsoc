import bcrypt from "bcrypt";
import prisma from "../config/db.js";
import { createToken } from "../utils/token.js";

export const register = async (req, res) => {
  try {
    const { displayName, username, email, password } = req.body;

    // Existing user check
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] }
    });
    if (existing) return res.status(400).json({ error: "User already exists." });

    // 3. Hash password (identical to Pedro's approach)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await prisma.user.create({
      data: { displayName, username, email, passwordHash }
    });

    res.status(201).json({ message: "Registered successfully", userId: newUser.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    // Sign JWT token
    const token = createToken(user);

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};