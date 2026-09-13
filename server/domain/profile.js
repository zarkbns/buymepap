import { db, transaction } from '../db.js';
import { validateDisplayName, validateBio, validateAvatarEmoji, validateNairaAmount, validateUsername } from '../validators.js';
import { changeUsername, getCreatorById } from './onboarding.js';

/**
 * Profile editing. Display money (cup price, goal) arrives in naira — the UI
 * unit — and is stored in kobo. Owner-controlled fields only; username goes
 * through the collision-safe path.
 */
export function updateProfile(creator, body) {
  const fields = [];
  const params = [];

  if (body.displayName !== undefined) {
    const error = validateDisplayName(body.displayName);
    if (error) return { error };
    fields.push('display_name = ?');
    params.push(body.displayName.trim());
  }
  if (body.bio !== undefined) {
    const error = validateBio(body.bio);
    if (error) return { error };
    fields.push('bio = ?');
    params.push(body.bio.trim());
  }
  if (body.avatarEmoji !== undefined) {
    const error = validateAvatarEmoji(body.avatarEmoji);
    if (error) return { error };
    fields.push('avatar_emoji = ?');
    params.push(body.avatarEmoji);
  }
  if (body.cupPrice !== undefined) {
    const error = validateNairaAmount(body.cupPrice, { min: 1, max: 100_000 });
    if (error) return { error };
    fields.push('cup_price_kobo = ?');
    params.push(body.cupPrice * 100);
  }
  if (body.goal !== undefined) {
    const error = validateNairaAmount(body.goal, { min: 0, max: 10_000_000 });
    if (error) return { error };
    fields.push('goal_kobo = ?');
    params.push(body.goal * 100);
  }
  if (fields.length === 0 && body.username === undefined) return { error: 'Nothing to update.' };

  return transaction(() => {
    if (fields.length > 0) {
      db.prepare(`UPDATE creators SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params, creator.id);
    }
    let usernameTaken = false;
    if (body.username !== undefined) {
      const result = changeUsername(getCreatorById(creator.id), body.username);
      if (result.error) usernameTaken = true;
    }
    return { creator: getCreatorById(creator.id), usernameTaken };
  });
}
