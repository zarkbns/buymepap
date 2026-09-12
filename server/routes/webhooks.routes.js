import { Router } from 'express';
import express from 'express';
import config from '../config.js';
import { verifyWebhookSignature } from '../payments/paystack.js';
import { fulfillSupport } from '../supports.js';

const router = Router();

// Needs the raw body for HMAC signature verification — mounted before express.json().
router.post('/paystack', express.raw({ type: () => true, limit: '100kb' }), (req, res) => {
  if (!config.paystackSecretKey) {
    return res.status(503).json({ error: 'Webhooks are inactive without a Paystack secret key.' });
  }
  const signature = req.headers['x-paystack-signature'];
  if (!verifyWebhookSignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid webhook payload.' });
  }

  if (event?.event === 'charge.success' && event.data?.reference) {
    fulfillSupport(event.data.reference);
  }
  res.json({ received: true });
});

export default router;
