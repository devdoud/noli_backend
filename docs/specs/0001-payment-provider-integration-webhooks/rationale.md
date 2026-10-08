# Rationale: 0001 Payment provider integration and webhook handling

## Context

> Premise note: the scope row describes "webhook events update the user's subscription record without manual intervention," which reads like silent auto renewal (the Stripe model: the provider re charges a saved card on its own). KkiaPay cannot do that (see the capability research below). "Without manual intervention" is reinterpreted here as: no engineer or admin ever has to hand edit a subscription row; the webhook and a scheduled check keep the record correct on their own, even though the user must actively repay each period. This spec builds the automation KkiaPay's real capabilities allow, not the automation the wording implied.

Noli needs to charge users for premium access and keep `User.subscription` (already on the schema, currently unenforced) in sync with what was actually paid. The user base is in Benin and neighboring West African countries (the product's routes are in French, per `AGENTS.md`), where mobile money (MTN, Moov) is the primary way people pay online, more than cards. Whatever payment gateway is chosen must support that, or a large share of the real user base cannot pay at all.

A payment gateway's webhook is the only reliable signal that money actually moved: a client side "success" event can be faked, closed before firing, or never received if the user's connection drops. The backend must treat the client event as a hint at best, and the webhook (or a server side lookup keyed off the transaction id) as the source of truth.

This feature sits upstream of two others: feature 3 (checkout and plan management) will be the thing that actually starts a payment, and feature 4 (billing emails) will use this feature's data to know when to warn a user their subscription is about to lapse. Both depend on contracts this spec has to define precisely, since neither exists yet.

## Options considered

### Option 1: KkiaPay one time transactions, recurring billing built at the application layer (chosen)

Use KkiaPay for all payment collection, since it is the only option here that supports West African mobile money (MTN, Moov) alongside cards, essential for the target market. Since KkiaPay has no native recurring billing or payment method tokenization, recurring billing is modeled at the application layer: each cycle requires a fresh KkiaPay checkout, the platform tracks `endDate` and prompts renewal by email before it lapses, and a grace period cron downgrades anyone who does not renew in time.

**Pros**:
- Supports the region's dominant payment method (mobile money), which most Western focused processors do not.
- Keeps card data off the platform's servers entirely (PCI scope stays at SAQ A).
- Works within KkiaPay's actual documented capabilities, rather than assuming capabilities it does not have.

**Cons**:
- Renewal is not silent; a lapsed or forgetful user must actively return and pay, unlike a Stripe style auto charge. This likely costs some retention or conversion versus a frictionless auto renew.

### Option 2: Switch to a subscription native provider (e.g. Stripe) for true silent auto renewal

**Pros**:
- Mature subscription lifecycle webhooks, saved payment methods, and dunning (automatic retry of a failed recurring charge) all built in; no bespoke renewal tracking logic needed.

**Cons**:
- Stripe, and most Western processors, has poor to no support for West African mobile money, the dominant payment method in the target market. Choosing it would exclude a large share of the actual user base, or force a second, more complex dual provider integration just to reach them.

### Option 3: KkiaPay with no renewal automation (manual only)

**Pros**:
- Least engineering effort: no cron job, no grace period logic, no reminder driven state machine.

**Cons**:
- No proactive downgrade means a lapsed payer silently keeps premium access indefinitely, since nothing else in the codebase checks `endDate`. No reminder path exists to recover a renewal before it lapses. This fails the scope row's explicit "without manual intervention" goal outright, since eventually an admin would have to notice and fix stale subscriptions by hand.

## Rationale

KkiaPay is the only realistic choice given the product's West African market and its mobile money requirement; this was also the engineer's explicit pick. Option 2 would mean silently assuming capabilities the chosen provider does not have, or abandoning the provider that actually reaches the target users, neither of which is acceptable. Option 3 fails the scope row's own stated goal outright: a subscription that never gets checked again is exactly the kind of stale state "without manual intervention" was meant to prevent.

Option 1 is the only option that is both honest about KkiaPay's real capabilities (confirmed via its official docs: no native subscriptions, no payment method tokenization, only `transaction.success` / `transaction.failed` webhook events) and automates everything that is actually automatable: record keeping, reminder timing, and grace period downgrade. The one thing it cannot automate, the charge itself, is a hard constraint of the chosen provider, not a design shortfall.

## KkiaPay capability research

Researched via web search against KkiaPay's official documentation (docs.kkiapay.me), since this is a smaller, regional provider not covered by general training knowledge. Confidence: high on the core findings (no recurring billing API, no tokenization), the documentation itself is the primary source.

- **No native recurring billing.** The Node.js Admin SDK (`@kkiapay-org/nodejs-sdk`) exposes only `verify()` (transaction lookup) and `refund()`. No subscription or scheduled charge API exists.
- **No payment method tokenization.** KkiaPay's documented payment methods (mobile money via MTN/Moov, and cards) do not include saving a method for later reuse. A repeat charge requires the user to go through the widget again.
- **Webhook events are transaction scoped, not subscription scoped.** Only `transaction.success` and `transaction.failed` are sent; there is no `subscription.created` / `renewed` / `canceled` concept to consume, confirmed further by the installed `kkiapay` Agent Skill (`Perempty/kkiapay-skill`).
- **Webhook signature**: an `x-kkiapay-secret` header carries a dashboard configured secret hash, compared server side.
- **Webhook retries**: on a non `2xx` response, KkiaPay retries 5 times at a short, incrementable interval (starting around 500ms), a much shorter window than some providers' multi day backoff. Flagged in Consequences and Follow-up in `index.md` as a real limitation: a prolonged outage can exhaust the retry window and lose an event.
- **The installed `kkiapay` skill's cardinal rule**: the webhook payload (and the client's `success` event) are signals, not proof. A server side `verify(transactionId)` call, checking both `status === "SUCCESS"` and that `amount` matches what was expected, is mandatory before crediting anything. This shaped `AC-1`, `AC-2`, and `AC-10`, and the decision to add the `PendingCheckout` collection so the webhook handler has an `expectedAmount` to check against.
