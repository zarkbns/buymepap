export function publicCreator(creator) {
  return {
    id: creator.id,
    username: creator.username,
    displayName: creator.display_name,
    bio: creator.bio,
    avatarEmoji: creator.avatar_emoji,
    cupPrice: creator.cup_price,
    currency: creator.currency,
    goal: creator.goal,
    createdAt: creator.created_at,
  };
}

export function publicSupport(support) {
  return {
    id: support.id,
    name: support.is_anonymous ? null : support.supporter_name,
    message: support.message || '',
    cups: support.cups,
    amount: support.amount,
    currency: support.currency,
    paidAt: support.paid_at,
    creatorUsername: support.creator_username,
  };
}

export function dashboardSupport(support) {
  return {
    id: support.id,
    name: support.supporter_name,
    isAnonymous: Boolean(support.is_anonymous),
    message: support.message || '',
    cups: support.cups,
    amount: support.amount,
    currency: support.currency,
    paidAt: support.paid_at,
  };
}
