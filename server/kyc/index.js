import config from '../config.js';
import { SumsubKycProvider } from './sumsub.js';
import { MockKycProvider } from './mock.js';

/**
 * Identity-verification boundary. The browser only ever receives a short-lived
 * SDK token minted here; the client secret, webhook secret and API responses
 * stay on the server. Interface:
 *
 *   name: string
 *   createApplicant(creator)            -> { applicantRef }   (stored as kyc_ref)
 *   createSessionToken(creator)         -> { token, userId, sdkUrl } | { mock: true }
 *   fetchDecision(creator)              -> { status: 'pending'|'approved'|'rejected', reason? }
 *   verifyWebhook(rawBody, headers)     -> { ok, event | null }
 *       event: { key, type, applicantRef, decision: 'approved'|'rejected'|'pending', reason? }
 */

export function createKycProvider(cfg = config) {
  if (cfg.kycProvider === 'sumsub') return new SumsubKycProvider(cfg.sumsub);
  return new MockKycProvider();
}
