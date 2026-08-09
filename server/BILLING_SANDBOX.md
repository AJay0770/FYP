# Billing — Sandbox Mode

> **This integration is TEST MODE ONLY. It has never processed a real transaction,
> and it is not ready to.** Read the [signature warning](#the-signature-scheme-is-unverified)
> before pointing it at anything live.

## What works today

| Piece | Status |
|---|---|
| `GET /api/billing/plans` | Working — static plan catalogue |
| `POST /api/billing/checkout` (ADMIN) | Working — records a pending subscription, returns a sandbox URL |
| `GET /api/billing/subscription` (ADMIN) | Working — current plan, status, project usage |
| `POST /api/billing/webhook/easypaisa` | Working against **our own** HMAC scheme (see warning) |
| Plan limits (402 when over) | Working and tested |

## Plans

| Plan | Price | Project limit |
|---|---|---|
| BASIC | 5,000 PKR/mo | 5 |
| PRO | 15,000 PKR/mo | 20 |
| ENTERPRISE | 40,000 PKR/mo | unlimited |
| *(no subscription)* | — | 2 (free allowance) |

Enforced by `middleware/subscriptionGate.js`, wired into `POST /api/projects`.
Over the limit returns **402 Payment Required**.

## Sandbox credentials

`server/.env` ships with placeholders:

```
EASYPAISA_API_KEY=sandbox-key
EASYPAISA_MERCHANT_ID=sandbox-merchant
```

These are **not** real EasyPaisa sandbox credentials — they're stand-ins so the code
paths run. Real sandbox credentials come from an EasyPaisa merchant account
(https://easypaisa.com.pk → merchant services). Nothing here has been tested against
EasyPaisa's actual sandbox, because that requires a real merchant account.

Never put production merchant credentials in `.env` — it is gitignored, but the
checkout URL and webhook are the only places the key is used, and both should read
from a secrets manager in production.

## The signature scheme is unverified

`routes/webhooks/easypaisa.js` verifies callbacks as:

- **algorithm**: HMAC-SHA256
- **signed content**: the raw request body, byte for byte
- **encoding**: hex
- **header**: `x-easypaisa-signature`

**All four of these are our own reasonable defaults, not EasyPaisa's documented
scheme.** Real gateways vary: some sign a canonical ordered field string rather than
the raw body, some use SHA-1 or RSA, some base64-encode, and header names differ.

Before accepting real money you must confirm the real scheme against EasyPaisa's
official merchant integration documentation and update `computeExpectedSignature`.
If this ships unverified, anyone who can reach the webhook URL can forge a
"payment succeeded" callback and grant themselves a paid plan for free.

What *is* already correct and worth preserving through that change:

- verification happens over `req.rawBody`, not a re-serialised object (re-serialising
  changes key order and whitespace, which changes the digest and breaks verification)
- comparison is constant-time via `crypto.timingSafeEqual`
- a missing `EASYPAISA_API_KEY` fails closed with 503, never "skip verification"
- the payer is resolved from the `orderRefNum` **we** generated at checkout, never
  from an identity field in the callback body

## Testing the webhook locally

The webhook needs a signature computed with the same secret in `.env`:

```bash
SECRET=sandbox-key
ORDER=<providerReference from the subscriptions table>
BODY="{\"orderRefNum\":\"$ORDER\",\"responseCode\":\"0000\"}"
SIG=$(node -e "console.log(require('crypto').createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$SECRET" "$BODY")

curl -X POST http://localhost:3000/api/billing/webhook/easypaisa \
  -H "Content-Type: application/json" \
  -H "x-easypaisa-signature: $SIG" \
  -d "$BODY"
```

`responseCode` of `0000` or `0` activates the subscription; anything else marks it
`EXPIRED`.

Verified rejections: missing signature → 401, forged signature → 401, valid
signature over a **tampered** body → 401.

To receive callbacks from a real sandbox you need a publicly reachable URL — use a
tunnel (ngrok/cloudflared) and set `PUBLIC_API_URL` so the `postBackURL` sent at
checkout points at the tunnel rather than `localhost`.

## Before going live

- [ ] Confirm the real signature scheme and rewrite `computeExpectedSignature`
- [ ] Swap placeholder credentials for real ones, held in a secrets manager
- [ ] Add webhook idempotency (a retried callback must not double-extend a subscription)
- [ ] Add replay protection (timestamp/nonce), so a captured valid callback can't be resent
- [ ] Handle recurring billing and failed renewals — only initial activation exists today
- [ ] Decide what happens to projects that already exist when a plan is downgraded
