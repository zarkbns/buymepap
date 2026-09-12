import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { publicCreator, dashboardSupport } from '../serialize.js';
import {
  validateDisplayName,
  validateBio,
  validateAvatarEmoji,
  validateCupPrice,
  validateGoal,
} from '../validators.js';
import { listPaidSupports } from '../supports.js';

const router = Router();

router.get('/me', authRequired, (req, res) => {
  res.json({ creator: publicCreator(req.creator) });
});

router.patch('/me', authRequired, (req, res) => {
  const { displayName, bio, avatarEmoji, cupPrice, goal } = req.body ?? {};
  const fields = [];
  const params = [];

  if (displayName !== undefined) {
    const error = validateDisplayName(displayName);
    if (error) return res.status(400).json({ error });
    fields.push('display_name = ?');
    params.push(displayName.trim());
  }
  if (bio !== undefined) {
    const error = validateBio(bio);
    if (error) return res.status(400).json({ error });
    fields.push('bio = ?');
    params.push(bio.trim());
  }
  if (avatarEmoji !== undefined) {
    const error = validateAvatarEmoji(avatarEmoji);
    if (error) return res.status(400).json({ error });
    fields.push('avatar_emoji = ?');
    params.push(avatarEmoji);
  }
  if (cupPrice !== undefined) {
    const error = validateCupPrice(cupPrice);
    if (error) return res.status(400).json({ error });
    fields.push('cup_price = ?');
    params.push(cupPrice);
  }
  if (goal !== undefined) {
    const error = validateGoal(goal);
    if (error) return res.status(400).json({ error });
    fields.push('goal = ?');
    params.push(goal);
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  params.push(req.creator.id);
  db.prepare(`UPDATE creators SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  const creator = db.prepare('SELECT * FROM creators WHERE id = ?').get(req.creator.id);
  req.creator = creator;
  res.json({ creator: publicCreator(creator) });
});

router.get('/me/dashboard', authRequired, (req, res) => {
  const id = req.creator.id;
  const all = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS earned_kobo, COUNT(*) AS support_count
       FROM supports WHERE creator_id = ? AND status = 'success'`
    )
    .get(id);
  const month = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS earned_kobo, COUNT(*) AS support_count
       FROM supports WHERE creator_id = ? AND status = 'success' AND paid_at >= datetime('now', '-30 days')`
    )
    .get(id);
  const cups = db
    .prepare(`SELECT COALESCE(SUM(cups), 0) AS cups FROM supports WHERE creator_id = ? AND status = 'success'`)
    .get(id);
  const recent = listPaidSupports(id, 10).map(dashboardSupport);

  res.json({
    creator: publicCreator(req.creator),
    stats: {
      earnedKobo: all.earned_kobo,
      supportCount: all.support_count,
      cups: cups.cups,
      monthEarnedKobo: month.earned_kobo,
      monthSupportCount: month.support_count,
    },
    recent,
  });
});

export default router;
