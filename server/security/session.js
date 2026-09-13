import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import config from '../config.js';
import db from '../db.js';

const secretKey = new TextEncoder().encode(config.jwtSecret);

/**
 * Full creator session (phone verified or not — the router decides what an
 * unverified session may do). Also returned in the body so non-browser API
 * clients can use Bearer auth; browsers must rely on the httpOnly cookie.
 */
export async function createSessionToken(creator, { ttlSeconds = config.sessionTtlSeconds } = {}) {
  return new SignJWT({ scope: 'creator' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(creator.id))
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretKey);
}

/**
 * Short-lived token handed out when a creator has claimed a username or
 * requested an OTP but has not proved phone ownership yet. It only unlocks
 * the OTP-verification step.
 */
export async function createPendingToken(creatorId, phone) {
  return new SignJWT({ scope: 'pending', phone })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(creatorId))
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + config.pendingTtlSeconds)
    .sign(secretKey);
}

async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload.scope === 'creator' || payload.scope === 'pending' ? payload : null;
  } catch {
    return null;
  }
}

function serializeCookie(name, value, { maxAge, httpOnly = true, sameSite = config.cookieSameSite } = {}) {
  const attrs = [`${name}=${value}`, 'Path=/', `Max-Age=${maxAge}`, `SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`];
  if (httpOnly) attrs.push('HttpOnly');
  if (config.cookieSecure) attrs.push('Secure');
  return attrs.join('; ');
}

export function parseCookies(header) {
  const jar = {};
  if (typeof header !== 'string' || !header) return jar;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) jar[name] = decodeURIComponent(value);
  }
  return jar;
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', serializeCookie(config.sessionCookie, token, { maxAge: config.sessionTtlSeconds }));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie(config.sessionCookie, '', { maxAge: 0 }));
}

export function setPendingCookie(res, token) {
  res.append('Set-Cookie', serializeCookie(config.sessionCookie, token, { maxAge: config.pendingTtlSeconds }));
}

/**
 * Double-submit CSRF token: readable cookie + required header on unsafe
 * methods. SameSite=lax already blocks cross-site form posts; this also
 * blocks same-site (e.g. sibling-subdomain) attackers.
 */
export function ensureCsrfCookie(req, res) {
  const jar = parseCookies(req.headers.cookie);
  const token = jar[config.csrfCookie];
  if (token) return token;
  const fresh = crypto.randomBytes(24).toString('hex');
  res.append('Set-Cookie', serializeCookie(config.csrfCookie, fresh, { maxAge: config.sessionTtlSeconds, httpOnly: false }));
  return fresh;
}

function isAllowedOrigin(origin, req) {
  if (!origin) return false;
  try {
    const { host, protocol } = new URL(origin);
    const appUrl = new URL(config.appUrl);
    if (host === appUrl.host && protocol === appUrl.protocol) return true;
    if (config.allowedOrigins.includes(`${protocol}//${host}`)) return true;
    // A request to its own host is same-origin regardless of deployment URL.
    const requestHost = req?.headers?.host;
    return Boolean(requestHost) && host === requestHost;
  } catch {
    return false;
  }
}

/** Rejects unsafe cross-origin requests (CSRF) and returns the CSRF cookie token. */
export function requireSameOrigin(req, res) {
  const token = ensureCsrfCookie(req, res);
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return token;

  const jar = parseCookies(req.headers.cookie);
  const headerToken = req.headers['x-csrf-token'];
  if (!jar[config.csrfCookie] || !headerToken || headerToken !== jar[config.csrfCookie]) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({ error: 'CSRF check failed. Refresh the page and try again.' });
    return null;
  }

  const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : null);
  if (origin && !isAllowedOrigin(origin, req)) {
    res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    return null;
  }
  return token;
}

/**
 * Loads the session payload onto req.session. Cookies are the browser
 * mechanism; Bearer is allowed for non-browser clients (scripts/CI) and is
 * what keeps the API testable without a cookie jar.
 */
export async function loadSession(req, _res, next) {
  const jar = parseCookies(req.headers.cookie);
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = jar[config.sessionCookie] || bearer || null;
  req.sessionToken = token;
  req.session = token ? await verifyToken(token) : null;
  next();
}

export function authRequired(req, res, next) {
  if (!req.session || req.session.scope !== 'creator') {
    return res.status(401).json({ error: 'Sign in required.' });
  }
  next();
}

/**
 * Loads the creator row for a full session onto req.creator. Everything
 * creator-owned (profile, payouts, withdrawals, dashboard) authorises through
 * this, so object ownership never has to be re-derived from request params.
 */
export function creatorRequired(req, res, next) {
  if (!req.session || req.session.scope !== 'creator') {
    return res.status(401).json({ error: 'Sign in required.' });
  }
  const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(Number(req.session.sub));
  if (!creator || creator.status === 'suspended') {
    return res.status(401).json({ error: 'Session is invalid. Sign in again.' });
  }
  req.creator = creator;
  next();
}
