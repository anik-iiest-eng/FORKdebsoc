import "dotenv/config";

const jwtSecret = process.env.JWT_SECRET?.trim();

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET is required and must be at least 32 characters long");
}

export { jwtSecret };
