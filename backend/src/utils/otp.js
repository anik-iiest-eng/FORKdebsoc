import crypto from "crypto";

/**
 * Generates a numeric OTP of the given length using a CSPRNG
 * (Math.random() from nodemailer-otp is not cryptographically secure).
 */
export const generateOtp = (length = 6) => {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return crypto.randomInt(min, max + 1).toString();
};

// One-way hash for the OTP so nothing plaintext ever touches the DB.
export const hashOtp = (otp) =>
  crypto.createHash("sha256").update(String(otp).trim()).digest("hex");

// Constant-time comparison to avoid leaking timing info on OTP guesses.
export const verifyOtpHash = (suppliedOtp, storedHash) => {
  const suppliedHash = hashOtp(suppliedOtp);
  const a = Buffer.from(suppliedHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};