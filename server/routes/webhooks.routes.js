import { Router } from 'express';
import express from 'express';
import db from '../db.js';
import config from '../config.js';
import { createPaymentProvider, ProviderError } from '../payments/index.js';
import { createKycProvider } from '../kyc/index.js';
import { applyProviderConfirmation } from '../domain/payments.js';
import { recordEvent, markEventProcessed } from '../domain/events.js';
import { markWithdrawalPaid, markWithdrawalReversed, reverseReservedFunds, getWithdrawalByReference } from '../domain/withdrawals.js';
import { setKycState } from '../domain/onboarding.js';

const router = Router();
const provider = createPaymentProvider();
const kyc = createKycProvider();

// Raw body is required for signature verification — mounted before express.json().
const raw = express.raw({ type: () => true, limit: '128kb' });

function eventLog(provider, parsed, rawBody) {
  const first = recordEvent({
    provider,
    eventKey: parsed?.key ?? null,
    eventType: parsed?.type ?? '',
    reference: parsed?.reference ?? null,
    rawBody,
  });
  if (first.inserted) return { eventId: first.row.id, retry: false };
  if (first.row && first.row.status === 'failed') {
    // A previous processing attempt failed: allow this delivery to reprocess.
    db.prepare(`UPDATE provider_events SET status = 'received', error = NULL WHERE id = ?`).run(first.row.id);
    return { eventId: first.row.id, retry: true };
  }
  return { eventId: first.row?.id ?? null, retry: false, duplicate: true };
}

/**
 * Flutterwave payment + transfer events. Signature first, then durable
 * dedupe, then the same domain transition the status endpoint uses — so a
 * webhook, a browser redirect and a manual reconciliation all converge on one
 * once-only fulfillment path.
 */
router.post('/flutterwave', raw, (req, res) => {
  if (provider.name !== 'flutterwave') {
    return res.status(503).json({ error: 'Payment webhooks are inactive in mock mode.' });
  }
  const verified = provider.verifyWebhook(req.body, req.headers);
  if (!verified.ok) return res.status(401).json({ error: 'Invalid webhook signature.' });
  if (!verified.event) return res.json({ received: true });

  const log = eventLog('flutterwave', verified.event, req.body);
  if (log.duplicate) return res.json({ received: true, duplicate: true });

  try {
    const event = verified.event;
    if (event.type === 'charge.completed' && event.reference) {
      const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(event.reference);
      if (!payment) {
        markEventProcessed(log.eventId, 'unknown payment reference');
        return res.json({ received: true, ignored: true });
      }
      applyProviderConfirmation(event.reference, {
        status: event.status,
        amountKobo: event.amountKobo,
        currency: event.currency,
        providerRef: event.providerRef,
        via: 'webhook',
      });
    } else if (event.type === 'transfer.completed' && event.reference) {
      const withdrawal = findWithdrawalByProviderReference(event.reference);
      if (withdrawal) {
        if (event.status === 'paid') markWithdrawalPaid(withdrawal.id, event.providerRef);
        else if (event.status === 'reversed') markWithdrawalReversed(withdrawal.id, event.providerRef);
        else reverseReservedFunds(withdrawal.id, 'failed');
      } else {
        markEventProcessed(log.eventId, 'unknown withdrawal reference');
        return res.json({ received: true, ignored: true });
      }
    }
    markEventProcessed(log.eventId);
    res.json({ received: true });
  } catch (err) {
    markEventProcessed(log.eventId, err?.message ?? 'processing error');
    console.error('[buymepap] webhook processing failed:', err instanceof ProviderError ? err.message : err?.name);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

function findWithdrawalByProviderReference(reference) {
  const exact = getWithdrawalByReference(reference);
  if (exact) return exact;
  // Retry attempts append -a<attempt>; map them back to the base withdrawal.
  const base = reference.replace(/-a\d+$/, '');
  return getWithdrawalByReference(base);
}

/** Sumsub review decisions drive creator KYC state. Signature + dedupe, then the domain transition. */
router.post('/sumsub', raw, (req, res) => {
  if (kyc.name !== 'sumsub') {
    return res.status(503).json({ error: 'KYC webhooks are inactive in mock mode.' });
  }
  const verified = kyc.verifyWebhook(req.body, req.headers);
  if (!verified.ok) return res.status(401).json({ error: 'Invalid webhook signature.' });
  if (!verified.event) return res.json({ received: true });

  const log = eventLog('sumsub', verified.event, req.body);
  if (log.duplicate) return res.json({ received: true, duplicate: true });

  try {
    const creator = db.prepare('SELECT id FROM creators WHERE kyc_ref = ?').get(verified.event.applicantRef);
    if (!creator) {
      markEventProcessed(log.eventId, 'unknown applicant');
      return res.json({ received: true, ignored: true });
    }
    setKycState(creator.id, { status: verified.event.decision, reason: verified.event.reason ?? null });
    markEventProcessed(log.eventId);
    res.json({ received: true });
  } catch (err) {
    markEventProcessed(log.eventId, err?.message ?? 'processing error');
    console.error('[buymepap] kyc webhook failed:', err?.name);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

export default router;
