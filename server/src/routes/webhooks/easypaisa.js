const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const prisma = require('../../utils/prisma');

/**
 * EasyPaisa payment callback.
 *
 * ============================ READ BEFORE GOING LIVE ============================
 * The signature scheme below (HMAC-SHA256 over the raw request body, hex-encoded,
 * supplied in `x-easypaisa-signature`) is a REASONABLE DEFAULT, NOT a transcription
 * of EasyPaisa's real specification. Their production scheme may differ in:
 *   - the algorithm (some gateways use SHA-1, or RSA rather than HMAC)
 *   - what is signed (a canonical ordered field string rather than the raw body)
 *   - the encoding (base64 vs hex)
 *   - the header name
 *
 * Confirm all four against EasyPaisa's official merchant integration docs and
 * adjust `computeExpectedSignature` before accepting real money. Shipping this
 * unverified would mean anyone who can reach this URL could forge a "payment
 * succeeded" callback and grant themselves a paid plan.
 * ================================================================================
 */

const SIGNATURE_HEADER = 'x-easypaisa-signature';
const SUCCESS_CODES = ['0000', '0']; // provider's "paid" response codes

function computeExpectedSignature(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function signaturesMatch(provided, expected) {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

// POST /api/billing/webhook/easypaisa
router.post('/easypaisa', async (req, res) => {
  try {
    const secret = process.env.EASYPAISA_API_KEY;

    // Fail closed. An unconfigured secret must never mean "skip verification".
    if (!secret) {
      console.error('EASYPAISA_API_KEY not set; rejecting webhook.');
      return res.status(503).json({ error: 'Payment provider not configured' });
    }

    const provided = req.headers[SIGNATURE_HEADER];
    if (!provided || typeof provided !== 'string') {
      return res.status(401).json({ error: 'Missing signature header' });
    }

    if (!req.rawBody || req.rawBody.length === 0) {
      return res.status(400).json({ error: 'Empty request body' });
    }

    const expected = computeExpectedSignature(req.rawBody, secret);
    if (!signaturesMatch(provided, expected)) {
      console.warn('Rejected EasyPaisa webhook: signature mismatch.');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { orderRefNum, responseCode } = req.body || {};

    if (!orderRefNum) {
      return res.status(400).json({ error: 'orderRefNum is required' });
    }

    // Correlate on the reference WE generated at checkout. The payer identity is
    // never taken from the callback body — a signed-but-attacker-chosen payload
    // must not be able to name which account gets upgraded.
    const subscription = await prisma.subscription.findFirst({
      where: { providerReference: orderRefNum },
    });

    if (!subscription) {
      console.warn(`EasyPaisa webhook for unknown orderRef: ${orderRefNum}`);
      return res.status(404).json({ error: 'Unknown order reference' });
    }

    const paid = SUCCESS_CODES.includes(String(responseCode));

    if (!paid) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'EXPIRED' },
      });
      return res.json({ received: true, activated: false, responseCode });
    }

    const now = new Date();
    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        startDate: now,
        nextBillingDate: addMonths(now, 1),
      },
    });

    console.log(`Subscription ${updated.id} activated on plan ${updated.plan}.`);
    res.json({ received: true, activated: true, plan: updated.plan });
  } catch (err) {
    console.error('EasyPaisa webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
