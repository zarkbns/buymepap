/**
 * Serialization boundaries. Anything private (phone numbers, full bank
 * account numbers, KYC references, provider payloads) must not appear in any
 * of these shapes — the API can only leak what these functions expose.
 */

export function publicCreator(creator) {
  return {
    username: creator.username,
    displayName: creator.display_name,
    bio: creator.bio,
    avatarEmoji: creator.avatar_emoji,
    cupPriceKobo: creator.cup_price_kobo,
    goalKobo: creator.goal_kobo,
    currency: creator.currency,
    canAcceptPayments: Boolean(creator.payments_active) && creator.status === 'active',
  };
}

/** Dashboard/profile view: what the creator sees about their own page. */
export function selfCreator(creator) {
  return {
    id: creator.id,
    username: creator.username,
    displayName: creator.display_name,
    bio: creator.bio,
    avatarEmoji: creator.avatar_emoji,
    cupPriceKobo: creator.cup_price_kobo,
    goalKobo: creator.goal_kobo,
    currency: creator.currency,
    status: creator.status,
    phone: creator.phone_e164,
    phoneVerified: Boolean(creator.phone_verified_at),
    kycStatus: creator.kyc_status,
    kycRejectReason: creator.kyc_reject_reason,
    payoutStatus: creator.payout_status,
    bankName: creator.bank_name,
    bankAccountLast4: creator.bank_account_last4,
    payoutAccountName: creator.payout_account_name,
    paymentsActive: Boolean(creator.payments_active),
    reservedUntil: creator.username_reserved_until,
    createdAt: creator.created_at,
  };
}

export function publicPayment(payment) {
  return {
    id: payment.id,
    name: payment.is_anonymous ? null : payment.supporter_name,
    message: payment.message || '',
    cups: payment.cups,
    amountKobo: payment.amount_kobo,
    currency: payment.currency,
    paidAt: payment.credited_at ?? payment.paid_at,
  };
}

export function dashboardPayment(payment) {
  return {
    id: payment.id,
    name: payment.supporter_name,
    isAnonymous: Boolean(payment.is_anonymous),
    message: payment.message || '',
    cups: payment.cups,
    amountKobo: payment.amount_kobo,
    feeKobo: payment.fee_kobo,
    netKobo: payment.net_kobo,
    currency: payment.currency,
    status: payment.status,
    reference: payment.reference,
    creditedAt: payment.credited_at,
    createdAt: payment.created_at,
  };
}

export function selfWithdrawal(withdrawal) {
  return {
    id: withdrawal.id,
    reference: withdrawal.reference,
    amountKobo: withdrawal.amount_kobo,
    feeKobo: withdrawal.fee_kobo,
    currency: withdrawal.currency,
    status: withdrawal.status,
    bankName: withdrawal.bank_name,
    accountLast4: withdrawal.account_last4,
    accountName: withdrawal.account_name,
    attempts: withdrawal.attempts,
    failureReason: withdrawal.failure_reason,
    requestedAt: withdrawal.requested_at,
    settledAt: withdrawal.settled_at,
  };
}
