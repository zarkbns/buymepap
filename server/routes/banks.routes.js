import { Router } from 'express';
import { createPaymentProvider } from '../payments/index.js';
import { ProviderError } from '../payments/index.js';

const router = Router();
const provider = createPaymentProvider();

const MOCK_BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '058', name: 'GTBank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '033', name: 'United Bank for Africa' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '214', name: 'FCMB' },
  { code: '050', name: 'Providus Bank' },
  { code: '101', name: 'Moniepoint MFB' },
  { code: '090267', name: 'Kuda MFB' },
  { code: '070', name: 'Fidelity Bank' },
];

/** Public, cacheable bank list used by payout-account setup. */
router.get('/', async (_req, res) => {
  if (provider.name === 'mock') {
    return res.json({ banks: MOCK_BANKS });
  }
  try {
    res.json({ banks: await provider.listBanks() });
  } catch (err) {
    console.error('[buymepap] bank list failed:', err instanceof ProviderError ? err.message : err?.name);
    res.status(502).json({ error: 'Bank list is unavailable right now.' });
  }
});

export default router;
