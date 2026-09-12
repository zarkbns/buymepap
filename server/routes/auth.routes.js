import { Router } from 'express';
import db from '../db.js';
import { validateEmail, validatePassword, validateUsername, validateDisplayName } from '../validators.js';
import { hashPassword, checkPassword, createSessionToken } from '../auth.js';
import { publicCreator } from '../serialize.js';

const router = Router();

router.post('/signup', async (req, res) => {
  const { email, password, username, displayName } = req.body ?? {};
  const error =
    validateEmail(email) ||
    validatePassword(password) ||
    validateUsername(username) ||
    validateDisplayName(displayName);
  if (error) return res.status(400).json({ error });

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db
    .prepare('SELECT email, username FROM creators WHERE email = ? OR username = ?')
    .get(normalizedEmail, username);
  if (existing) {
    const clash =
      existing.email === normalizedEmail
        ? 'An account with this email already exists.'
        : 'That username is taken.';
    return res.status(409).json({ error: clash });
  }

  const passwordHash = await hashPassword(password);
  const result = db
    .prepare('INSERT INTO creators (email, password_hash, username, display_name) VALUES (?, ?, ?, ?)')
    .run(normalizedEmail, passwordHash, username, displayName.trim());
  const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(Number(result.lastInsertRowid));
  const token = await createSessionToken(creator);
  res.status(201).json({ token, creator: publicCreator(creator) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const creator = db.prepare('SELECT * FROM creators WHERE email = ?').get(email.trim().toLowerCase());
  const ok = creator && (await checkPassword(password, creator.password_hash));
  if (!ok) return res.status(401).json({ error: 'Wrong email or password.' });
  const token = await createSessionToken(creator);
  res.json({ token, creator: publicCreator(creator) });
});

export default router;
