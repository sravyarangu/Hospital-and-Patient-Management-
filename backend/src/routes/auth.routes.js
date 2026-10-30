import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { getMongoDatabase } from '../config/mongodb.js';
import { env } from '../config/env.js';
import requireAuth from '../middleware/requireAuth.js';

const router = Router();
const SESSION_COOKIE = 'medicare_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, message: 'Too many login attempts. Please try again in 15 minutes.' },
});

function setSessionCookie(res, userId) {
  const token = jwt.sign({}, env.jwtSecretKey, {
    subject: userId,
    expiresIn: '8h',
  });

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

router.post('/register', async (req, res, next) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (name.length < 2 || name.length > 100) {
    res.status(400).json({ error: true, message: 'Enter a name between 2 and 100 characters.' });
    return;
  }
  if (email.length > 254 || !emailPattern.test(email)) {
    res.status(400).json({ error: true, message: 'Enter a valid email address.' });
    return;
  }
  if (password.length < 10 || password.length > 128) {
    res.status(400).json({ error: true, message: 'Password must be between 10 and 128 characters.' });
    return;
  }

  const db = getMongoDatabase();
  const users = db.collection('users');

  try {
    await users.createIndex({ email: 1 }, { unique: true });
    await db.collection('patients').createIndex({ userId: 1 }, { unique: true });

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    const newUser = {
      name,
      email,
      role: 'patient',
      isActive: true,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    const result = await users.insertOne(newUser);

    try {
      await db.collection('patients').insertOne({
        userId: result.insertedId,
        name,
        email,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      await users.deleteOne({ _id: result.insertedId });
      throw error;
    }

    res.status(201).json({
      message: 'Your patient account has been created. Please log in.',
      user: publicUser({ ...newUser, _id: result.insertedId }),
    });
  } catch (error) {
    if (error?.code === 11000) {
      res.status(409).json({ error: true, message: 'An account with this email already exists.' });
      return;
    }
    next(error);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!emailPattern.test(email) || !password) {
    res.status(400).json({ error: true, message: 'Enter your email address and password.' });
    return;
  }

  try {
    const user = await getMongoDatabase().collection('users').findOne({ email });
    const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!passwordMatches) {
      res.status(401).json({ error: true, message: 'Email or password is incorrect.' });
      return;
    }
    if (!['patient', 'doctor', 'admin'].includes(user.role)) {
      res.status(403).json({ error: true, message: 'This account does not have a supported portal role.' });
      return;
    }

    setSessionCookie(res, user._id.toString());
    res.status(200).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.status(200).json({ message: 'You have been signed out.' });
});

router.get('/me', requireAuth, (req, res) => {
  res.status(200).json({ user: req.user });
});

export default router;
