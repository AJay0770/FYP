const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { PLAN_LIMITS } = require('../middleware/subscriptionGate');

const PLANS = {
  BASIC: { price: 5000, currency: 'PKR', projects: PLAN_LIMITS.BASIC },
  PRO: { price: 15000, currency: 'PKR', projects: PLAN_LIMITS.PRO },
  ENTERPRISE: { price: 40000, currency: 'PKR', projects: 'unlimited' },
};

const PROVIDERS = ['EASYPAISA'];

// Sandbox only. See BILLING_SANDBOX.md.
const EASYPAISA_SANDBOX_CHECKOUT = 'https://sandbox.easypaisa.com.pk/easypay/Index.jsf';

// GET /api/billing/plans — public plan catalogue for the pricing page.
router.get('/plans', (req, res) => {
  res.json(
    Object.entries(PLANS).map(([name, details]) => ({
      plan: name,
      price: details.price,
      currency: details.currency,
      projectLimit: details.projects,
    }))
  );
});

// POST /api/billing/checkout (ADMIN only)
router.post('/checkout', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    const { plan, provider } = req.body;

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: `plan must be one of: ${Object.keys(PLANS).join(', ')}` });
    }
    if (!provider || !PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `provider must be one of: ${PROVIDERS.join(', ')}` });
    }

    const merchantId = process.env.EASYPAISA_MERCHANT_ID;
    const apiKey = process.env.EASYPAISA_API_KEY;
    if (!merchantId || !apiKey) {
      return res.status(503).json({ error: 'Payment provider is not configured' });
    }

    const orderRef = `BS360-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const details = PLANS[plan];

    // Persist the pending intent so the webhook can correlate the callback back
    // to this admin and plan. Without this the webhook has no trustworthy way to
    // know who paid — it must never take the payer identity from the callback body.
    await prisma.subscription.upsert({
      where: { companyAdminId: req.user.userId },
      create: {
        companyAdminId: req.user.userId,
        plan,
        status: 'EXPIRED', // not active until the webhook confirms payment
        provider,
        providerReference: orderRef,
        nextBillingDate: new Date(),
      },
      update: {
        plan,
        provider,
        providerReference: orderRef,
      },
    });

    const checkoutUrl =
      `${EASYPAISA_SANDBOX_CHECKOUT}` +
      `?storeId=${encodeURIComponent(merchantId)}` +
      `&orderRefNum=${encodeURIComponent(orderRef)}` +
      `&amount=${details.price}` +
      `&postBackURL=${encodeURIComponent(
        `${process.env.PUBLIC_API_URL || 'http://localhost:3000'}/api/billing/webhook/easypaisa`
      )}`;

    res.status(201).json({
      checkoutUrl,
      orderRef,
      plan,
      amount: details.price,
      currency: details.currency,
      sandbox: true,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/billing/subscription — current subscription for the logged-in admin.
router.get('/subscription', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { companyAdminId: req.user.userId },
    });

    if (!subscription) {
      return res.json({ subscription: null, plan: 'NONE', status: 'NONE' });
    }

    const projectCount = await prisma.project.count({ where: { createdById: req.user.userId } });
    const limit = PLAN_LIMITS[subscription.plan];

    res.json({
      subscription,
      projectCount,
      projectLimit: limit === Infinity ? 'unlimited' : limit,
    });
  } catch (err) {
    console.error('Get subscription error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
