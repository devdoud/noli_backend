---
name: kkiapay
description: Integrate KKiaPay payments (mobile money & card, Benin/West Africa). Use when integrating kkiapay / un paiement, verifying a transaction server-side, handling a kkiapay webhook, or going from sandbox to production.
version: 1.0.0
license: MIT
author: Perempty <ckindji@gmail.com>
homepage: https://github.com/Perempty/kkiapay-skill
tags: [payments, kkiapay, mobile-money, card, benin, west-africa, fintech, webhook, nodejs, php, python]
---

A KKiaPay integration is always **two steps**: the **widget** opens the payment on the client and returns a `transactionId`; the **verify** confirms that payment server-side before any value is delivered.

## Cardinal rule: verify is the source of truth

The client can lie. The widget's `success` event and a webhook payload are **signals**, not proof. Never credit, ship, or unlock anything before calling `verify(transactionId)` server-side and confirming both:

- `status === "SUCCESS"`, **and**
- the returned `amount` matches the amount expected for that order.

## verify response shape

```json
{
  "status": "SUCCESS",            // SUCCESS | FAILED
  "type": "DEBIT",
  "amount": 40,
  "fees": 1,
  "source": "MOBILE_MONEY",       // MOBILE_MONEY | WALLET | CARD
  "transactionId": "0845058258857440",
  "partnerId": "",                 // your order id if you passed one to the widget
  "client": { "fullname": "John Doe", "phone": "22997000000", "email": "john.doe@gmail.com" }
}
```

Use `partnerId`: pass your order id to the widget, read it back from the verify response to reconcile payment with order.

## Quickstart (minimal happy path)

Client — load the SDK and open the widget with your **public** key:

```html
<script src="https://cdn.kkiapay.me/k.js"></script>
<button onclick="pay()">Pay 1000</button>
<script>
  function pay() {
    openKkiapayWidget({ amount: 1000, key: "PUBLIC_KEY", sandbox: true });
  }
  addSuccessListener(res => {
    // res.transactionId → hand off to your server; never trust this event alone
    fetch("/confirm", { method: "POST", body: JSON.stringify({ id: res.transactionId, amount: 1000 }) });
  });
</script>
```

Server (Node) — the only place a payment becomes real:

```javascript
import { kkiapay } from "@kkiapay-org/nodejs-sdk";
const k = kkiapay({ privatekey: P, publickey: PUB, secretkey: S, sandbox: true });

app.post("/confirm", async (req, res) => {
  const { id, amount } = req.body;
  const tx = await k.verify(id);
  if (tx.status !== "SUCCESS" || tx.amount !== amount) return res.sendStatus(402);
  // deliver value here, exactly once (idempotent)
  res.sendStatus(200);
});
```

Test with sandbox phone `97000000` (success). Full per-framework and per-language code below.

## Keys & environment

Three keys from the dashboard (Developers → API keys), in two distinct sets: **sandbox** (test) and **live** (production).

| Key | Where | Exposure |
| --- | --- | --- |
| Public | Client (widget) | Public — fine in the browser |
| Private | Server | **Secret** — never client-side |
| Secret | Server | **Secret** — never client-side |

In test mode, set `sandbox: true` everywhere (widget **and** server SDK). Sandbox test numbers and cards: [`references/sandbox.md`](references/sandbox.md).

## Integration steps

1. **Keys** — get the sandbox keys. Put the private and secret keys in server environment variables, never in the client bundle. Done when the keys load server-side without appearing anywhere in client code.

2. **Client widget** — open the payment and subscribe to `success` / `failed`. Pick the integration for your framework in [`references/client.md`](references/client.md). Gotcha: the vanilla SDK expects the attribute `key`, the `kkiapay-react` hook expects `api_key`. Done when a click opens the widget and the `success` handler receives an object containing `transactionId`.

3. **Server verification** — expose a route that receives the `transactionId` from the `success` handler, calls `verify(transactionId)`, applies the **cardinal rule**, then delivers value. Per-language code (Node/PHP/Python) in [`references/server.md`](references/server.md). Done when value is delivered only on `status === "SUCCESS"` **and** matching amount, with a failed or amount-tampered transaction rejected.

4. **Webhook (optional, recommended)** — safety net if the client closes before step 3. Configure the URL and secret hash on the dashboard, validate the `x-kkiapay-secret` header, respond `2xx`, then **re-verify via `verify()`** before fulfilling. Details and payloads in [`references/webhooks.md`](references/webhooks.md). Done when a signed notification triggers a server verify and an idempotent delivery.

5. **Go to production** — replace the sandbox keys with the live keys (client **and** server) and remove `sandbox: true` everywhere. Done when no test key and no `sandbox: true` remains, confirmed by searching the code.

## Mobile SDKs

Flutter (`kkiapay-flutter`), React Native (`@kkiapay-org/react-native-sdk`), Android, and iOS/Swift exist too. Same model: client widget → `transactionId` → **server verify**. Check the official SDK docs for the exact call signature; step 3 (server verification) is unchanged.

## Out of scope

- **PCI / card-data handling** — KKiaPay hosts the card form; this skill does not cover storing or transmitting raw card data yourself.
- **Mobile SDK call signatures** — mobile SDKs are named above but their exact APIs live in the official SDK docs, not here.
- **Account & key provisioning** — creating a merchant account, activating it, and obtaining keys are dashboard actions, not code.
- **Payouts/settlement accounting** — reconciling your KKiaPay balance to your books is a business process, not part of the integration.
- **API version** — written against KKiaPay **v1**. Verify package versions (npm/composer/pip) and endpoints before shipping if v2+ is out.
