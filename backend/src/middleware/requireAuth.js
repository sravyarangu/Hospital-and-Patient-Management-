import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getMongoDatabase } from '../config/mongodb.js';

const SESSION_COOKIE = 'medicare_session';
const allowedRoles = new Set(['patient', 'doctor', 'admin']);

export default async function requireAuth(req, res, next) {
  const cookies = (req.headers.cookie || '').split(';');
  const sessionCookie = cookies.find((cookie) => cookie.trim().startsWith(`${SESSION_COOKIE}=`));
  const token = sessionCookie?.trim().slice(SESSION_COOKIE.length + 1);

  if (!token) {
    res.status(401).json({ error: true, message: 'Authentication is required.' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecretKey);
    if (typeof payload !== 'object' || typeof payload.sub !== 'string' || !ObjectId.isValid(payload.sub)) {
      res.status(401).json({ error: true, message: 'Your session is invalid or expired.' });
      return;
    }

    const user = await getMongoDatabase().collection('users').findOne(
      { _id: new ObjectId(payload.sub) },
      { projection: { name: 1, email: 1, role: 1, isActive: 1 } },
    );

    if (!user || user.isActive === false || !allowedRoles.has(user.role)) {
      res.status(401).json({ error: true, message: 'Your session is no longer valid.' });
      return;
    }

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };
    next();
  } catch (error) {
    if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      res.status(401).json({ error: true, message: 'Your session is invalid or expired.' });
      return;
    }
    next(error);
  }
}
