import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcrypt';
import { body } from 'express-validator';
import nodemailer from 'nodemailer';
import prisma from '../config/db.js';
import { createToken } from '../utils/token.js';
import { validate } from '../middlewares/validate.middleware.js';
import { generateOtp, hashOtp, verifyOtpHash } from '../utils/otp.js';

const router = express.Router();

const smtpPort = Number(process.env.SMTP_PORT || 465);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: smtpPort,
  secure: process.env.SMTP_SECURE === 'false' ? false : smtpPort === 465,
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendOtpEmail = async (recipient, otp) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be configured');
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: recipient,
    subject: 'DebSoc Account Verification',
    text: `Your DebSoc verification code is ${otp}. It expires in 5 minutes.`
  });
};

const dispatchOtpEmail = (recipient, otp, userId, otpCreatedAt) => {
  void sendOtpEmail(recipient, otp)
    .then(() => prisma.otpVerification.deleteMany({
      where: { userId, createdAt: { lt: otpCreatedAt } }
    }))
    .catch((error) => {
      console.error(`OTP email dispatch failed for ${recipient}:`, error);
    });
};

const OTP_TTL_MS = 5 * 60 * 1000;

const cleanupExpiredPendingUsers = async () => {
  try {
    await prisma.user.deleteMany({
      where: {
        isVerified: false,
        otps: {
          some: { expiresAt: { lt: new Date() } },
          none: { expiresAt: { gte: new Date() } }
        }
      }
    });
  } catch (error) {
    console.error('Pending user cleanup failed:', error);
  }
};

const pendingUserCleanupTimer = setInterval(cleanupExpiredPendingUsers, 60 * 1000);
pendingUserCleanupTimer.unref?.();
void cleanupExpiredPendingUsers();

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

    const { user, otpRecord } = await prisma.$transaction(async (tx) => {
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

      const newOtpRecord = await tx.otpVerification.create({
        data: { userId: record.id, otpHash, expiresAt }
      });

      return { user: record, otpRecord: newOtpRecord };
    });

    dispatchOtpEmail(normalizedEmail, otp, user.id, otpRecord.createdAt);

    return res.status(200).json({ message: 'OTP sent to your email.' });
  } catch (error) {
    console.error('Register error:', error);
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Username or email is already in use.' });
    }
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
      await prisma.user.delete({ where: { id: user.id } });
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