import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "backend/.env" });
dotenv.config();

export default defineConfig({
  schema: "backend/prisma/schema.prisma",
  migrations: {
    path: "backend/prisma/migrations"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
