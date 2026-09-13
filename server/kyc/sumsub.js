import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import { ProviderError } from '../payments/index.js';

/**
 * Sumsub adapter. Server-side only: the client secret signs both REST requests
 * and the short-lived WebSDK token, and the webhook secret authenticates
 * review decisions. None of these ever reach the browser.
 */
const TOKEN_TTL_SECONDS = 1800;
const WEBSDK_SCRIPT = 'sumsub.websdk.2.0.0.js';

/**
 * SUMSUB_SDK_URL may be either the CDN directory (default) or the exact script
 * URL, so a provider-side path change is an env edit, not a code change.
 */
export function websdkScriptUrl(sdkUrl) {
  const base = sdkUrl.replace(/\/+$/, '');
  return base.endsWith('.js') ? base : `${base}/${WEBSDK_SCRIPT}`;
}

export class SumsubKycProvider {
  #cfg;

  constructor(cfg) {
    this.#cfg = cfg;
  }

  get name() {
    return 'sumsub';
  }

  #sigHeaders(method, path, body) {
    const ts = Math.floor(Date.now() / 1000);
    const digest = crypto.createHmac('sha256', this.#cfg.clientSecret).update(`${ts}:${method}:${path}:${body}`).digest('hex');
    return {
      'X-App-Access-Ts': String(ts),
      'X-App-Access-Sig': digest,
    };
  }

  async #request(method, path, body) {
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    let res;
    try {
      res = await fetch(`${this.#cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.#cfg.clientId}`,
          'Content-Type': 'application/json',
          ...(body === undefined ? {} : this.#sigHeaders(method, path, bodyText)),
        },
        body: body === undefined ? undefined : bodyText,
        signal: AbortSignal.timeout(this.#cfg.timeoutMs ?? 20000),
      });
    } catch (err) {
      throw new ProviderError(`identity provider unreachable: ${err?.cause?.code ?? err?.name ?? 'network error'}`, {
        kind: 'network',
      });
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ProviderError(`identity provider rejected ${method} ${path}: ${payload.description ?? `HTTP ${res.status}`}`, {
        status: res.status,
      });
    }
    return payload;
  }

  async createApplicant(creator) {
    const applicantRef = `pap_${creator.id}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = await this.#request('POST', '/api/v1/applicants', {
      externalUserId: applicantRef,
      levelName: this.#cfg.levelId || undefined,
    });
    const applicantId = payload?.id;
    if (typeof applicantId !== 'string') throw new ProviderError('identity provider returned no applicant id');
    return { applicantRef, applicantId };
  }

  async createSessionToken(creator) {
    if (!creator.kyc_ref) throw new ProviderError('creator has no applicant yet');
    const token = await new SignJWT({
      userId: creator.kyc_ref,
      // Sumsub checks the embedding page's origin against this claim, so it
      // must be where the widget actually runs — the app, never the CDN.
      applicationUrl: this.#cfg.appUrl,
      features: ['kyc'],
      ttl: TOKEN_TTL_SECONDS,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS)
      .setIssuer(this.#cfg.clientId)
      .setSubject(creator.kyc_ref)
      .sign(new TextEncoder().encode(this.#cfg.clientSecret));
    return { token, userId: creator.kyc_ref, scriptUrl: websdkScriptUrl(this.#cfg.sdkUrl) };
  }

  async fetchDecision(creator) {
    const payload = await this.#request('GET', `/api/v1/applicants/-;externalUserId=${encodeURIComponent(creator.kyc_ref)}/one`);
    const answer = payload?.review?.reviewResult?.reviewAnswer;
    if (answer === 'GREEN') return { status: 'approved' };
    if (answer === 'RED') {
      const label = payload?.review?.reviewResult?.reviewRejectType ?? 'rejected';
      return { status: 'rejected', reason: String(label) };
    }
    return { status: 'pending' };
  }

  verifyWebhook(rawBody, headers) {
    const digest = headers?.['x-payload-digest'];
    if (typeof digest !== 'string' || !digest) return { ok: false, event: null };
    const expectedHex = crypto.createHmac('sha256', this.#cfg.webhookSecret).update(rawBody).digest('hex');
    if (!safeEqual(expectedHex, digest) && !safeEqual(Buffer.from(expectedHex, 'hex').toString('base64'), digest)) {
      return { ok: false, event: null };
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: false, event: null };
    }

    const type = payload?.type ?? '';
    if (type !== 'applicantReviewed' && type !== 'applicantPending') {
      return { ok: true, event: null };
    }
    const answer = payload?.reviewResult?.reviewAnswer;
    const decision =
      type === 'applicantPending' ? 'pending' : answer === 'GREEN' ? 'approved' : answer === 'RED' ? 'rejected' : 'pending';
    return {
      ok: true,
      event: {
        key: String(payload?.id ?? crypto.createHash('sha256').update(rawBody).digest('hex')),
        type,
        applicantRef: payload?.externalUserId ?? null,
        decision,
        reason: decision === 'rejected' ? String(payload?.reviewResult?.reviewRejectType ?? 'rejected') : undefined,
      },
    };
  }
}

function safeEqual(expected, provided) {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}