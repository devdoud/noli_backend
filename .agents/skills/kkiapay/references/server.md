# KKiaPay server verification

The server SDK takes **all three** keys (public, private, secret). `sandbox: true` in test mode. Two operations: `verify` (transaction status) and `refund`.

Apply the SKILL's cardinal rule: deliver value only if `status === "SUCCESS"` **and** `amount === expected amount`.

## Node.js

```bash
npm i @kkiapay-org/nodejs-sdk
```

```javascript
import { kkiapay } from "@kkiapay-org/nodejs-sdk";

const k = kkiapay({
  privatekey: process.env.KKIAPAY_PRIVATE,
  publickey:  process.env.KKIAPAY_PUBLIC,
  secretkey:  process.env.KKIAPAY_SECRET,
  sandbox: true,               // remove in production
});

// Route called with the transactionId from the client success handler
async function confirmPayment(transactionId, expectedAmount) {
  const tx = await k.verify(transactionId);
  if (tx.status !== "SUCCESS" || tx.amount !== expectedAmount) {
    throw new Error("Payment not confirmed");
  }
  return tx;                    // OK → deliver value (idempotent)
}

// Refund (mobile money only, successful transaction; excludes fees)
await k.refund(transactionId);
```

## PHP

```bash
composer require kkiapay/kkiapay-php:dev-master
```

```php
$kkiapay = new \Kkiapay\Kkiapay(
    $public_key, $private_key, $secret,
    $sandbox = true            // remove in production
);

$tx = $kkiapay->verifyTransaction($transaction_id);
if ($tx['status'] !== 'SUCCESS' || $tx['amount'] != $expected_amount) {
    throw new Exception('Payment not confirmed');
}
// OK → deliver

$kkiapay->refundTransaction($transaction_id);
```

## Python

```bash
pip install kkiapay
```

```python
from kkiapay import Kkiapay

k = Kkiapay('public_key', 'private_key', 'secret', sandbox=True)  # remove sandbox in prod

tx = k.verify_transaction(transaction_id)
if tx.status != 'SUCCESS' or tx.amount != expected_amount:
    raise Exception('Payment not confirmed')
# OK → deliver
```

## Notes

- `refund`: mobile money only, on a successful transaction. Transaction fees are **not** refunded.
- Verification must be **idempotent**: the same transaction may be confirmed both by the widget return and by the webhook. Mark the order as paid exactly once.
