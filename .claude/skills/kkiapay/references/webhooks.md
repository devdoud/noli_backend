# KKiaPay webhooks

The webhook notifies your backend of a transaction's status, even if the client closes the tab before the verification step. It is a safety net, not a replacement for `verify()`.

## Configuration (dashboard)

Webhook tab, API keys submenu (Developers menu) → "Add a webhook":

1. **URL** to notify — a dedicated page on your server configured to receive events.
2. **Events** you want — you are only notified of those.
3. **Secret hash** — used to verify the origin of requests.

Test from the dashboard to confirm KKiaPay reaches the URL.

## Receiving

- Identify the event type and respond with an **HTTP 2xx** code. Any other code (including 3xx) is read as a failed receipt.
- On failure, KKiaPay retries **5 times** (500 ms interval, incrementable).

## Signature verification

Every request carries an `x-kkiapay-secret` header holding your secret hash. Reject any request whose header does not match.

```
curl -H "x-kkiapay-secret: XXX" -H "Content-Type: application/json" http://example.com/webhook
```

```javascript
app.post('/webhook', (req, res) => {
  if (req.headers['x-kkiapay-secret'] !== process.env.KKIAPAY_WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.sendStatus(200);                       // acknowledge quickly
  // Then, outside the request cycle: re-verify via verify(transactionId)
  // before fulfilling — the header alone is not enough if the secret leaks.
});
```

## Payloads

**Success:**

```json
{
  "transactionId": "3iH6wjHJ3",
  "isPaymentSucces": true,
  "account": "22996000000",        // null for card and wave
  "method": "MOBILE_MONEY",        // MOBILE_MONEY | WALLET | CARD
  "amount": 1000,
  "fees": 19,
  "partnerId": "...",
  "performedAt": "2024-03-20T08:55:22.883Z",
  "stateData": {},
  "event": "transaction.success"
}
```

**Failure:** same shape with `"isPaymentSucces": false`, `"event": "transaction.failed"`, plus `failureCode` and `failureMessage`.

> Note: the field really is spelled `isPaymentSucces` (single `s`) in the payload.
