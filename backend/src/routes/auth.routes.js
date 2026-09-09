import express from 'express';
import bcrypt from 'bcrypt';
import { body } from 'express-validator';
import NodemailerHelper from 'nodemailer-otp';
import prisma from '../config/db.js';
import { createToken } from '../utils/token.js';
import { validate } from '../middlewares/validate.middleware.js';
import { generateOtp, hashOtp, verifyOtpHash } from '../utils/otp.js';

const router = express.Router();
const helper = new NodemailerHelper(process.env.EMAIL_USER, process.env.EMAIL_PASS);

const OTP_TTL_MS = 5 * 60 * 1000;

const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/'
};

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 8, max: 128 })
], validate, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ error: 'Please verify your email before logging in.' });
    }

    const token = createToken(user);
    res.cookie('debsoc_token', token, authCookieOptions);
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/register', [
  body('displayName').isString().trim().isLength({ min: 2, max: 100 }),
  body('username').isString().trim().matches(/^[a-zA-Z0-9_.-]{3,32}$/),
  body('email').isEmail().normalizeEmail(),
  body('password').isString().isLength({ min: 8, max: 128 })
], validate, async (req, res) => {
  const { displayName, username, email, password } = req.body;

  try {
    if (!displayName || !username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const trimmedUsername = String(username).trim();
    const trimmedDisplayName = String(displayName).trim();

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { username: trimmedUsername }] }
    });

    if (existingUser) {
      if (existingUser.isVerified) {
        return res.status(400).json({ error: 'User already exists.' });
      }
      // Same email AND username as a pending, unverified signup -> treat this
      // as a resend instead of blocking the user who never got their email.
      if (existingUser.email !== normalizedEmail || existingUser.username !== trimmedUsername) {
        return res.status(400).json({ error: 'Username or email is already pending verification.' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = generateOtp(6);
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const user = await prisma.$transaction(async (tx) => {
      const record = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: { displayName: trimmedDisplayName, passwordHash }
          })
        : await tx.user.create({
            data: {
              displayName: trimmedDisplayName,
              username: trimmedUsername,
              email: normalizedEmail,
              passwordHash,
              isVerified: false
            }
          });

      // Drop any previous pending OTPs for this user before issuing a new one.
      await tx.otpVerification.deleteMany({ where: { userId: record.id } });
      await tx.otpVerification.create({
        data: { userId: record.id, otpHash, expiresAt }
      });

      return record;
    });

    // Send the email in the background — the SMTP round trip should not
    // block the HTTP response the client is waiting on. The OTP row is
    // already persisted, so a "resend" (re-POST /register) recovers cleanly
    // if the send fails or is slow.
    helper
      .sendEmail(
        normalizedEmail,
        'DebSoc Account Verification',
        'Your verification code is',
        otp
      )
      .catch((err) => {
        console.error(`OTP email dispatch failed for user ${user.id}:`, err);
      });

    return res.status(200).json({ message: 'OTP sent to your email.' });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Failed to dispatch verification email.' });
  }
});

router.post('/verify-otp', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isString().matches(/^\d{6}$/)
], validate, async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  try {
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      return res.status(400).json({ error: 'No OTP request found for this email. Please request a new one.' });
    }

    if (user.isVerified) {
      return res.status(400).json({ error: 'Account already verified. Please log in.' });
    }

    const otpRecord = await prisma.otpVerification.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) {
      return res.status(400).json({ error: 'No OTP request found for this email. Please request a new one.' });
    }

    if (Date.now() > otpRecord.expiresAt.getTime()) {
      await prisma.otpVerification.deleteMany({ where: { userId: user.id } });
      return res.status(400).json({ error: 'OTP has expired. Please register again.' });
    }

    if (!verifyOtpHash(String(otp || '').trim(), otpRecord.otpHash)) {
      return res.status(400).json({ error: 'Incorrect OTP code.' });
    }

    const verifiedUser = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { isVerified: true }
      });
      await tx.otpVerification.deleteMany({ where: { userId: user.id } });
      return updated;
    });

    const token = createToken(verifiedUser);
    res.cookie('debsoc_token', token, authCookieOptions);
    return res.status(200).json({
      message: 'Account successfully verified!',
      token,
      user: {
        id: verifiedUser.id,
        email: verifiedUser.email,
        username: verifiedUser.username,
        displayName: verifiedUser.displayName,
        role: verifiedUser.role
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({ error: 'Could not complete registration in database.' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('debsoc_token', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  return res.json({ message: 'Logged out successfully.' });
});

export default router;