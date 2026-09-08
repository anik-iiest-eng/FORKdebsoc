import express from 'express';
import bcrypt from 'bcryptjs';
import { body } from 'express-validator';
import NodemailerHelper from 'nodemailer-otp';
import prisma from '../config/db.js';
import { createToken } from '../utils/token.js';
import { validate } from '../middlewares/validate.middleware.js';


const router = express.Router();
const helper = new NodemailerHelper(process.env.EMAIL_USER, process.env.EMAIL_PASS);

const pendingVerifications = new Map();
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
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { username: String(username).trim() }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists.' });
    }

    const otp = helper.generateOtp(6);
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const passwordHash = await bcrypt.hash(password, 10);

    pendingVerifications.set(normalizedEmail, {
      otp: String(otp),
      expiresAt,
      userData: {
        displayName: String(displayName).trim(),
        username: String(username).trim(),
        email: normalizedEmail,
        passwordHash
      }
    });

    await helper.sendEmail(
      normalizedEmail,
      'DebSoc Account Verification',
      `Your verification code is: ${otp}`,
      otp
    );

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
  const pending = pendingVerifications.get(normalizedEmail);

  if (!pending) {
    return res.status(400).json({ error: 'No OTP request found for this email. Please request a new one.' });
  }

  if (Date.now() > pending.expiresAt) {
    pendingVerifications.delete(normalizedEmail);
    return res.status(400).json({ error: 'OTP has expired. Please register again.' });
  }

  if (pending.otp !== String(otp || '').trim()) {
    return res.status(400).json({ error: 'Incorrect OTP code.' });
  }

  try {
    const createdUser = await prisma.user.create({
      data: {
        displayName: pending.userData.displayName,
        username: pending.userData.username,
        email: pending.userData.email,
        passwordHash: pending.userData.passwordHash,
        isVerified: true
      }
    });

    pendingVerifications.delete(normalizedEmail);

    const token = createToken(createdUser);
    res.cookie('debsoc_token', token, authCookieOptions);
    return res.status(200).json({
      message: 'Account successfully verified!',
      token,
      user: {
        id: createdUser.id,
        email: createdUser.email,
        username: createdUser.username,
        displayName: createdUser.displayName,
        role: createdUser.role
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