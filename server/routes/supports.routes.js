import { Router } from 'express';
import { getSupportByReference, fulfillSupport, markSupportFailed } from '../supports.js';
import { verifyTransaction, isMock } from '../payments/paystack.js';
import { publicSupport } from '../serialize.js';

const router = Router();

router.get('/:reference/verify', async (req, res) => {
  const { reference } = req.params;
  if (typeof reference !== 'string' || reference.length > 64) {
    return res.status(400).json({ error: 'Invalid reference.' });
  }
  let support = getSupportByReference(reference);
  if (!support) return res.status(404).json({ error: 'Support not found.' });

  if (support.status === 'pending' && !isMock()) {
    try {
      const result = await verifyTransaction(reference);
      if (result?.status === 'success') {
        support = fulfillSupport(reference) ?? support;
      } else if (result?.status === 'failed') {
        markSupportFailed(reference);
        support = getSupportByReference(reference);
      }
    } catch (err) {
      console.error('[buymepap] verify failed:', err.message);
    }
  }

  res.json({
    status: support.status,
    support: support.status === 'success' ? publicSupport(support) : null,
    creatorUsername: support.creator_username,
  });
});

export default router;
