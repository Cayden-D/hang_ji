import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getUsdCnySnapshot } from '../services/exchange-rates.js';

const router = Router();
router.use(authenticate);

router.get('/usd-cny', async (_req, res) => {
  res.json({ rates: await getUsdCnySnapshot(), source: 'Frankfurter' });
});

export default router;

