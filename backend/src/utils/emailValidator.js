// src/utils/emailValidator.js
import { z } from 'zod';

export const registerSchema = z.object({
  displayName: z.string().min(2),
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(8),
  bio: z.string().optional()
});