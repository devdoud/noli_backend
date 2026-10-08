# KKiaPay client widget

Load the SDK before `</body>`:

```html
<script src="https://cdn.kkiapay.me/k.js"></script>
```

`key` = public key. `sandbox="true"` in test mode. After payment, send the received `transactionId` to your server verification route (SKILL step 3).

## Vanilla JS / HTML

Three usages, pick one.

**1. Web Component**

```html
<kkiapay-widget amount="1000"
                key="<public-key>"
                position="center"
                sandbox="true"
                data=""
                callback="<success-redirect-url>">
</kkiapay-widget>
```

**2. CSS class** — config on the `<script>`, then `class="kkiapay-button"` on an existing button.

```html
<script amount="1000" theme="#0095ff" position="right" sandbox="true"
        key="<public-key>" callback="" data=""
        src="https://cdn.kkiapay.me/k.js"></script>
<button class="kkiapay-button">Pay</button>
```

**3. JS call** — `openKkiapayWidget` is available on the DOM once the script has loaded.

```javascript
openKkiapayWidget({
  amount: 1000,
  key: "<public-key>",       // ⚠️ vanilla = "key"
  sandbox: true,
  position: "center",
  theme: "green",
  data: "",
});

addSuccessListener(response => {
  // response.transactionId → send to the server for verify
});
addFailedListener(error => console.log(error));
```

## React & Next.js

```bash
npm install kkiapay-react
```

In Next.js, the component must be `'use client'`.

```jsx
import { useKKiaPay } from 'kkiapay-react';
import { useEffect } from 'react';

function PayButton() {
  const { openKkiapayWidget, addKkiapayListener, removeKkiapayListener } = useKKiaPay();

  function open() {
    openKkiapayWidget({
      amount: 4000,
      api_key: "<public-key>",   // ⚠️ React hook = "api_key", not "key"
      sandbox: true,
      email: "client@example.com",
      phone: "97000000",
    });
  }

  useEffect(() => {
    const onSuccess = (res) => {/* res.transactionId → server verify */};
    const onFail = (err) => console.log(err);
    addKkiapayListener('success', onSuccess);
    addKkiapayListener('failed', onFail);
    return () => {                 // required: prevents memory leaks
      removeKkiapayListener('success', onSuccess);
      removeKkiapayListener('failed', onFail);
    };
  }, [addKkiapayListener, removeKkiapayListener]);

  return <button onClick={open}>Pay</button>;
}
```

`kkiapay-react` also covers Vue, Nuxt, Angular, and Svelte through their respective packages — same logic: open the widget, listen for `success`, hand the `transactionId` to the server.

## Widget attributes

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| amount | Number | Yes | Amount to charge |
| key / api_key | String | Yes | **Public** API key (`key` in vanilla, `api_key` in the React hook) |
| sandbox | Boolean | No | `true` → test mode |
| callback | String | No | Redirect URL after payment |
| position | String | No | `left` \| `right` \| `center` |
| theme | String | No | Widget color |
| paymentmethod | array | No | Restrict to: `momo` \| `card` \| `wallet` |
| countries | array | No | Accepted countries: `BJ`\|`CI`\|`TG`\|`SN`\|`NE` |
| phone | String | No | Customer phone (mobile money) |
| name / email | String | No | Customer identity |
| partnerId | String | No | Your order id — comes back in the verify response |
| data | - | No | Free-form data attached to the transaction |
