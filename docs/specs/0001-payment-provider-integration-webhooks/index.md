# 0001. Payment provider integration and webhook handling

**Date**: 2026-09-29
**Status**: In Progress

## Summary

This decides how Noli takes payments and keeps a user's subscription record correct. We use KkiaPay (a West African mobile money and card payment gateway) since it is the only realistic option that supports mobile money, the dominant payment method in the target market. KkiaPay only processes one time charges, it has no built in recurring billing, so this feature builds the recurring billing logic itself: a webhook confirms each payment, a reminder driven renewal flow prompts the user before their period ends, and a daily check downgrades anyone who does not renew in time. Feature 3 (checkout) and feature 4 (billing emails) both build on contracts this spec defines.

## Requirements

**User stories**:
- As a user, I want my premium access to turn on automatically once my payment is confirmed, so I do not have to contact support.
- As a user, I want a failed or lapsed payment to be reflected accurately (downgraded to free), so the platform's records match what I actually paid for.
- As the platform, I want every payment event processed exactly once and every credited transaction independently verified, so a spoofed or duplicated webhook can never grant free access.

**Acceptance criteria** (the contract, each criterion is independently checkable):
- **AC-1**: A transaction whose `verify()` call (KkiaPay's server side lookup, never the webhook body alone) returns `SUCCESS`, whose `verify()`-returned `partnerId` atomically claims an unconsumed `PendingCheckout`, and whose `verify()`-returned `amount` equals that checkout's `expectedAmount`, credits the linked user: `endDate = max(current endDate, now) + 30 days`, `isActive=true`, `plan=premium`, `lastTransactionId` updated; `startDate` is only set to now if the user was not already active (a renewal never resets it). A renewal never shortens time already paid for, and an active user is never downgraded or reset by this path.
- **AC-2**: A verified `transaction.failed` event, or a verified `SUCCESS` whose amount does not match the claimed checkout's `expectedAmount`, is never credited and never alters the user's existing subscription state (no downgrade, no reset); it is recorded with an explicit rejection reason for audit. Only the grace period cron (AC-3) ever downgrades an active subscription.
- **AC-3**: A subscription whose `endDate` plus a 1 day grace period has passed is downgraded to free by a daily scheduled check, applied as a single atomic update so a renewal that lands concurrently is never clobbered by it.
- **AC-4**: A webhook request whose `x-kkiapay-secret` header does not match the configured secret is rejected with `401` and never processed or persisted.
- **AC-5**: A transaction whose `verify()`-returned `partnerId` has no matching, unconsumed `PendingCheckout` (missing, already consumed, or unrecognized) is logged as a warning and acknowledged with `200` (not retried; it will never resolve), and alters no subscription state.
- **AC-6**: The same `transactionId` delivered more than once (a KkiaPay retry) is fully processed at most once: a `transactionId` already recorded as `processed` short circuits to `200` without reprocessing; one still `received` or `failed` (an earlier attempt crashed or errored mid processing) is safely retried to completion, never double applied.
- **AC-7**: An unexpected processing failure (e.g. a database write error, or `verify()` itself timing out or erroring) after the claim row is inserted returns `500`, so KkiaPay's own retry mechanism redelivers it, and the `WebhookEvent` is left at `status=failed` (or `received`) for that safe retry.

## Decision

**Chosen option**: Option 1: KkiaPay one time transactions, with recurring billing built at the application layer (reminder driven renewal, grace period downgrade).

The backend integrates KkiaPay's server SDK for verification and its webhook for real time notification, and owns the entire recurring billing state machine itself, since KkiaPay provides none.

**Implementation skills**: `kkiapay` (`Perempty/kkiapay-skill`, `.agents/skills/kkiapay/`)

## Rationale

Reasoning and options considered: see `rationale.md`.

## Feature design

**Data model sketch**:

*`User.subscription`* (existing embedded object, extended):
- `plan`: `'free' | 'premium'` (existing)
- `startDate`: `Date` (existing)
- `endDate`: `Date | null` (existing, now actively driven)
- `isActive`: `boolean` (existing)
- `lastTransactionId`: `string | null` (**new**) — the KkiaPay transaction id of the most recent successful payment

*`PendingCheckout`* (**new** collection, `src/billing/schemas/pending-checkout.schema.ts`) — the contract feature 3 must write to before opening the KkiaPay widget, so this feature's webhook handler knows who to credit and what amount to expect. `partnerId` is an opaque unique token (e.g. a UUID); it carries no encoded meaning of its own, `userId` is the source of truth for who it belongs to, closing the spoofing gap a client-decodable format would leave open:
- `partnerId`: `string`, required, **unique index** — an opaque token generated by feature 3, passed to the KkiaPay widget and echoed back by `verify()`
- `userId`: `ObjectId` ref `User`, required, indexed
- `expectedAmount`: `number`, required
- `createdAt`: `Date`, required
- `consumedAt`: `Date | null` — set atomically when a matching webhook claims it (see Key invariants); a row with `consumedAt` already set cannot be claimed again

*`WebhookEvent`* (**new** collection, `src/billing/schemas/webhook-event.schema.ts`). Its insert with `status='received'` **is** the idempotency claim (the unique index on `transactionId` is the lock), so most fields are only populated once processing resolves enough to know them:
- `transactionId`: `string`, required, **unique index** — the dedupe key and idempotency claim
- `kkiapayEvent`: `'transaction.success' | 'transaction.failed'`, required — the raw `event` field from the webhook payload (always present in a valid payload)
- `status`: `'received' | 'processed' | 'failed'`, required, default `received` — this feature's own processing lifecycle; `processed` is terminal (never reprocessed), `received`/`failed` are retryable
- `outcome`: `'credited' | 'rejected_failed' | 'rejected_mismatch' | 'no_pending_checkout' | 'verify_error'`, optional — set once `status` reaches `processed`; explicitly covers every edge case rather than forcing one onto an ill-fitting enum
- `partnerId`: `string`, optional — from the `verify()` response, once it returns
- `userId`: `ObjectId` ref `User`, optional, indexed — from the claimed `PendingCheckout`, once matched
- `verifiedAmount`: `number`, optional — from the `verify()` response
- `wasReactivation`: `boolean`, optional — whether the user was inactive immediately before this credit (for audit/analytics only, computed server side at processing time, never trusted from client input)
- `payload`: `Mixed`, required — the raw webhook body, for audit and replay
- `receivedAt`: `Date`, required
- `processedAt`: `Date | null`

Relationships: `PendingCheckout` is atomically claimed by `partnerId` (from `verify()`, not the raw webhook body) when its matching transaction resolves. `WebhookEvent` optionally links to a `User` once one is resolved. `User.subscription` stays embedded, not a separate collection.

**State transitions** (`User.subscription`):

```
inactive --(verify() SUCCESS, partnerId claims an unconsumed PendingCheckout, amount matches)--> active
    (isActive=true, plan=premium, startDate=now, endDate=max(endDate, now)+30d, lastTransactionId set)
active --(verify() SUCCESS, partnerId claims an unconsumed PendingCheckout, amount matches)--> active
    (endDate=max(endDate, now)+30d, startDate unchanged, lastTransactionId updated)
any state --(verify() FAILED, or amount mismatch, or no matching PendingCheckout)--> unchanged
    (no credit, no downgrade; recorded as a rejected WebhookEvent)
active --(grace cron: now > endDate + 1 day, atomic updateMany)--> inactive/free
```

Failure never downgrades an active subscription; only the grace cron does, and only once the paid period plus grace has actually passed.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/billing/webhook` | POST | KkiaPay payload as a typed DTO (`transactionId`, `event`, `isPaymentSucces`, `amount`, `partnerId`, `account`, `method`, `performedAt`); normal JSON parsing, no raw body needed (the signature is a static header value, not a body HMAC) | `{ received: true }` | none (no JWT); authenticated by a constant time comparison of the `x-kkiapay-secret` header, plus the mandatory server side `verify()` call as a second, independent confirmation | `401` invalid signature (nothing persisted); `200` for a rejected/unmatched transaction (acknowledged, not retried, no state change); `500` for an internal processing failure (triggers KkiaPay's retry) |

There is no other new endpoint. Checkout initiation (what opens the KkiaPay widget, and what writes `PendingCheckout`) belongs to feature 3.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| POST /billing/webhook | which user to credit | `PendingCheckout.userId`, looked up by the `verify()`-returned `partnerId` (never the raw webhook body's `partnerId`, and never decoded from a client-supplied string) |
| POST /billing/webhook | whether the transaction actually succeeded | **not** the webhook body's `isPaymentSucces`/`event` field; the authoritative source is calling `verify(transactionId)` server side (KkiaPay's own cardinal rule: the client, and the webhook body, can lie) |
| POST /billing/webhook | the amount to validate the charge against | `PendingCheckout.expectedAmount`, matched by the claimed row; compared against `verify()`'s `amount` field exactly (not `amount + fees`; `fees` is KkiaPay's cut, irrelevant to whether the platform's own price was paid) |
| POST /billing/webhook | the billing period length | decided in this spec: 30 days, a config constant (`BILLING_PERIOD_DAYS`) |
| POST /billing/webhook | the new `endDate` | derived, unconditionally: `max(current endDate, now) + BILLING_PERIOD_DAYS`. There is deliberately no client-supplied "new vs renewal" distinction driving this: a single formula covers both cases correctly and removes a class of bug where a stale or incorrect client signal could reset an active user's paid time |
| POST /billing/webhook | whether `startDate` should reset | derived: only if the user's subscription was `isActive=false` immediately before this credit |
| Daily grace cron | the grace cutoff | decided in this spec: 1 day, a config constant (`BILLING_GRACE_PERIOD_DAYS`) |
| POST /billing/webhook | whether the request is authentic | the `x-kkiapay-secret` header, compared to `KKIAPAY_WEBHOOK_SECRET` via `crypto.timingSafeEqual` |
| Feature 3 (checkout initiation, out of this feature's scope but a value it depends on) | `PendingCheckout.expectedAmount` | the plan's price, owned and decided by feature 3's own spec, not this one |

**Key invariants**:
- `isActive=true` implies `plan=premium` and `endDate` is in the future (respecting the grace period).
- `endDate` never decreases; a credited transaction always extends or matches the current period, and a rejected one (failed, mismatched, unmatched) never touches it at all. Only the grace cron ever moves a subscription toward `inactive`.
- A `WebhookEvent.transactionId` claim (the unique index insert at `status='received'`) is the sole idempotency boundary: a `processed` row short circuits every retry to `200`; a `received`/`failed` row is safely reprocessed to completion, never double credited.
- A `PendingCheckout` is claimed atomically (`findOneAndUpdate` on `{ partnerId, consumedAt: null }`), so two webhooks racing for the same `partnerId` can only ever credit one user once.
- A subscription is never upgraded, extended, or have its `startDate` reset on the strength of a client reported or webhook reported "success" alone; only an independently verified `SUCCESS` with a matching amount, against a claimed `PendingCheckout`, can do that.
- The grace cron's downgrade is a single atomic `updateMany({ isActive: true, endDate: { $lt: cutoff } }, ...)`, never a separate read then write, so a renewal that lands mid run can never be clobbered by it.

**Security model**:
The webhook route is public (no JWT) but authenticated by a constant time comparison of a shared secret header, plus the mandatory server side `verify()` call as a second, independent confirmation: even a leaked webhook secret cannot forge a credited payment on its own, since the `partnerId`, amount, and status all have to check out against KkiaPay's own record and an unconsumed `PendingCheckout` the platform itself created. No end user ever calls this route directly. Card data never reaches this backend; KkiaPay's hosted widget/checkout handles it, keeping PCI scope at SAQ A (the lightest tier, for merchants who never see, store, or transmit raw card data). All KkiaPay credentials are environment variables, never logged, never committed.

**Configuration required**:
- `KKIAPAY_PUBLIC_KEY`: the public key the client widget uses (not secret, but centralized here with the others)
- `KKIAPAY_PRIVATE_KEY`: server side SDK authentication (secret)
- `KKIAPAY_SECRET_KEY`: server side SDK authentication (secret)
- `KKIAPAY_WEBHOOK_SECRET`: the hash configured on the KkiaPay dashboard's webhook setup, compared against the `x-kkiapay-secret` header (secret)

Note: this feature needs no plan-price config of its own; `PendingCheckout.expectedAmount` is written per checkout by feature 3, which owns pricing.

**Critical test scenarios**:
- Happy path: a signed `transaction.success` webhook whose `verify()` call returns `SUCCESS` and a matching amount against a seeded `PendingCheckout` credits the subscription, verifies **AC-1**.
- Failure case: the same `transactionId` is delivered twice (simulating a KkiaPay retry) and is only ever credited once, verifies **AC-6**; a verified `SUCCESS` whose amount does not match the claimed checkout is not credited and does not downgrade an already active subscription, verifies **AC-2**.
- Auth/permission: a webhook with an incorrect `x-kkiapay-secret` header is rejected with `401` and never persisted, verifies **AC-4**.

## Build plan

1. [x] Add the `@kkiapay-org/nodejs-sdk` and `@nestjs/schedule` dependencies; add the four `KKIAPAY_*` env vars to `.env` (infrastructure, no direct AC).
2. [x] Create `BillingModule` (`src/billing/`) with a `KkiapayService` wrapping the SDK client (`verify()`, sandbox flag derived from `NODE_ENV !== 'production'`) (infrastructure for AC-1).
3. [x] Extend the `User` schema with `subscription.lastTransactionId`; add the `PendingCheckout` schema and collection with the atomic claim method (`findOneAndUpdate` on `{ partnerId, consumedAt: null }`), satisfies **AC-1**, **AC-2**, **AC-5** (the data model target for this slice).
4. [x] Add the `WebhookEvent` schema and collection, including the claim-insert helper (`status='received'` insert as the idempotency lock), satisfies **AC-6**, **AC-7**.
5. [x] Add the route skeleton (`POST /billing/webhook`, a typed DTO, normal JSON parsing) that checks the `x-kkiapay-secret` header with a constant time comparison, returning `401` on a mismatch without persisting anything, satisfies **AC-4**.
6. [x] Add a dev/test only seed path (a script or an endpoint gated to non-production) for creating a `PendingCheckout` row directly, so the thread below can be exercised end to end against KkiaPay's sandbox before feature 3 (which will own the real checkout flow) exists.
7. [x] Wire the thinnest end to end thread: on a valid signature, insert the `WebhookEvent` claim row, call `verify(transactionId)`, atomically claim the matching `PendingCheckout` by the verify()-returned `partnerId`, and on `SUCCESS` with a matching amount, credit the subscription (`endDate = max(endDate, now) + 30d`, `startDate` reset only if previously inactive) and mark the row `processed`/`credited`, satisfies **AC-1**.
8. [x] Add the rejection paths: a verified `transaction.failed`, and an amount mismatch, both leave the subscription untouched and record an explicit `outcome` (`rejected_failed` / `rejected_mismatch`), satisfies **AC-2**.
9. [x] Add the no-matching-checkout path (`no_pending_checkout` outcome: missing, already consumed, or unrecognized `partnerId`), logged as a warning, `200`, no state change, satisfies **AC-5**.
10. [x] Add retry-safe reprocessing: on a duplicate `transactionId`, look up the existing `WebhookEvent`; short circuit to `200` if `processed`, otherwise resume processing from where it left off, satisfies **AC-6**.
11. [x] Add the processing failure path (`500`, `WebhookEvent` left at `status=failed` on an unexpected error such as a database write failure or a `verify()` timeout/error), satisfies **AC-7**.
12. [x] Add the daily grace period cron job (`@nestjs/schedule`) as a single atomic `updateMany` (no separate read-then-write), satisfies **AC-3**.
13. [x] Add structured logging on every branch (received, credited, rejected, unmatched, signature rejected, processing failed) for operability. Supports all acceptance criteria; verified by none individually.

## Consequences

**Positive**:
- Subscription record keeping and access control are fully automated from KkiaPay's own confirmed transaction outcomes; no engineer ever hand edits a subscription row.
- PCI scope stays at the lightest tier (SAQ A); card data never touches this backend.
- `WebhookEvent` gives a full audit trail and replay path for support and dispute resolution.

**Negative / tradeoffs**:
- Renewal requires the user to actively return and pay again; there is no silent auto charge. Expect some churn from users who simply forget, mitigated only by the reminder email that feature 4 has not been built yet.
- KkiaPay's webhook retries only 5 times at short, incrementable intervals (not a multi day backoff like some providers); a backend outage long enough to exhaust those retries can lose an event entirely, with no built in safety net beyond the grace period cron (which only catches a lapsed `endDate`, not a lost webhook for an otherwise on time payment).
- Feature 3 and feature 4 both take on a hard dependency on contracts defined here (writing a `PendingCheckout` row before opening the widget, `endDate` as the reminder trigger source). Any drift from these contracts silently desyncs subscription state from reality.

**Neutral**:
- Introduces a new `src/billing/` area and two new Mongoose collections (`PendingCheckout`, `WebhookEvent`).
- Introduces `@nestjs/schedule` as a new project dependency, the project's first background job.

## Follow-up

- [ ] Feature 3 (Subscription Checkout & Plan Management) must, before opening the KkiaPay widget: create a `PendingCheckout` row with a fresh opaque `partnerId` (e.g. a UUID, no encoded meaning required), the paying `userId`, and `expectedAmount` set to the real plan price it decides.
- [ ] Feature 4 (Billing Email Notifications) should read `User.subscription.endDate` directly to decide when to send a renewal reminder; this feature does not emit its own "reminder due" event or notification.
- [ ] Plan pricing is entirely feature 3's decision; this spec only consumes whatever `expectedAmount` feature 3 writes to `PendingCheckout`.
- [ ] Given KkiaPay's short (5 attempt, sub-second interval) retry window, consider a periodic reconciliation job (calling KkiaPay's verification API for any `PendingCheckout` older than a few minutes with no matching `WebhookEvent`) as part of the initial build rather than a someday item, to catch a webhook lost to that short window (see Consequences).
- [ ] `src/billing/AGENTS.md` should be created once this feature is built (by `/audit` or `/sync`), documenting the `partnerId` contract, the installed `kkiapay` skill, and the `WebhookEvent`/`PendingCheckout` schemas, so features 3 and 4 do not have to rediscover them.
- [ ] The `hookdeck/webhook-skills` community skill (generic webhook receiver patterns) was found during discovery but not installed, since the KkiaPay specific skill already covers this provider; reconsider if a second webhook based provider is ever added.
