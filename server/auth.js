import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import config from './config.js';
import db from './db.js';

const secret = new TextEncoder().encode(config.jwtSecret);

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function createSessionToken(creator) {
  return new SignJWT({ username: creator.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(creator.id))
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  try {
    const { payload } = await jwtVerify(token, secret);
    const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(Number(payload.sub));
    if (!creator) return res.status(401).json({ error: 'Session is invalid. Sign in again.' });
    req.creator = creator;
    next();
  } catch {
    return res.status(401).json({ error: 'Session is invalid. Sign in again.' });
  }
}
