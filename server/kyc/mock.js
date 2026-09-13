import crypto from 'node:crypto';

/**
 * Mock identity verification for development and tests. Decisions are applied
 * through the same domain transition the live webhook uses (via the mock
 * route), so the KYC state machine is exercised identically.
 */
export class MockKycProvider {
  get name() {
    return 'mock';
  }

  async createApplicant(creator) {
    return { applicantRef: `mockapp_${creator.id}_${crypto.randomBytes(4).toString('hex')}`, applicantId: null };
  }

  async createSessionToken(creator) {
    return { mock: true, userId: creator.kyc_ref };
  }

  async fetchDecision() {
    // In mock mode decisions only arrive via the mock decision endpoint; the
    // server-side refresh path reports the stored state without changing it.
    return { status: 'pending' };
  }

  verifyWebhook() {
    return { ok: false, event: null };
  }
}
