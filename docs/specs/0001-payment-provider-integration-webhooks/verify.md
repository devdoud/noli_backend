# Verify: Payment Provider Integration & Webhooks · spec 0001 · updated 2026-09-29

_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

_Last run 2026-09-30: BLOCKED. Every ticked step below was run again live and still passes after the `req.user._id` fix. The unticked steps need real KkiaPay sandbox keys (`KKIAPAY_*` in `.env`, still empty)._

## UI / manual

- [x] **Fixed (2026-09-29):** As an authenticated user, call `POST /billing/dev/pending-checkout` with `{ expectedAmount: 1000 }` → expect `201` and a `PendingCheckout` row linked to the caller. Was broken (`req.user.userId` read on a `req.user` shaped as the full User document, keyed by `_id`; `new Types.ObjectId(undefined)` silently minted an unrelated id), fixed in `billing.controller.ts` (`req.user._id.toString()`) plus a defensive `BadRequestException` guard in `BillingService.createPendingCheckout` against any future bad caller. Re-verified live: registered a real user, called the endpoint, `PendingCheckout.userId` now exactly matches the caller's real `_id` → AC-1
- [ ] Complete a KkiaPay sandbox payment for that `partnerId` (sandbox phone `97000000`) for exactly `1000`, then deliver the resulting webhook (or let KkiaPay's sandbox fire it) to `POST /billing/webhook` with the correct `x-kkiapay-secret` header → expect `200 { received: true }`, and the user's `subscription` becomes `plan=premium`, `isActive=true`, `endDate` ≈ 30 days out, `lastTransactionId` set, `startDate` set to now (first time subscriber) → AC-1
- [ ] Repeat the same flow for a user who is already active (seed a second `PendingCheckout`, pay again) → expect `endDate` to extend from the *previous* `endDate` (stacks), not reset from today, and `startDate` to stay unchanged → AC-1
- [ ] Deliver a webhook with `event: transaction.failed` for a real transaction → expect `200`, and the user's subscription is completely unchanged (no downgrade) → AC-2
- [ ] Seed a `PendingCheckout` with `expectedAmount: 1000`, but drive a sandbox payment of a different amount → expect the webhook is rejected (`WebhookEvent.outcome = rejected_mismatch`), and the subscription is unchanged → AC-2
- [x] Force a subscription's `endDate` to more than 1 day in the past (e.g. via a direct DB edit in a test environment) with `isActive: true`, then run `BillingGraceScheduler.downgradeLapsedSubscriptions()` (manually invoke, or wait for the daily cron) → expect `plan=free`, `isActive=false` afterward → AC-3
- [x] Force a subscription's `endDate` to less than 1 day in the past, run the same cron → expect it is **not** downgraded (still within grace) → AC-3
- [x] `POST /billing/webhook` with a missing or incorrect `x-kkiapay-secret` header → expect `401`, and confirm no `WebhookEvent` row was created for that request → AC-4
- [ ] `POST /billing/webhook` for a transaction whose verified `partnerId` has no matching `PendingCheckout` → expect `200`, `WebhookEvent.outcome = no_pending_checkout`, no subscription change → AC-5
- [ ] Deliver the exact same webhook payload (same `transactionId`) twice in a row → expect the second delivery returns `200` without crediting a second time (`endDate` advances by exactly one billing period total, not two) → AC-6 (a **partial** version of this ran for real: redelivering a `transactionId` stuck at `status=failed` correctly resumed, no duplicate `WebhookEvent` row was created; the "already `processed`, short circuits to `200`" half is still blocked)
- [x] Simulate a downstream failure during processing and deliver a valid webhook → expect `500`, and the `WebhookEvent` is left at `status=failed` (retryable). Ran for real via the actual credential-less KkiaPay SDK call failing, not a simulated DB outage → AC-7

## Value sourcing coverage

- [ ] Forge the webhook body's `partnerId` to differ from the real `verify()`-returned `partnerId` → expect crediting follows `verify()`'s `partnerId`, never the raw body's → AC-1 (value sourcing: "which user to credit")
- [ ] Deliver a webhook whose `verify()` response has a nonzero `fees` alongside an `amount` that exactly matches `expectedAmount` → expect it is still credited (fees are not part of the compared amount) → AC-1 (value sourcing: "the amount to validate the charge against")

## Commands

- [x] `npx tsc -p tsconfig.build.json` → clean build, `dist/billing/` present
- [x] `npx jest billing` → 18/18 passing (`billing.service.spec.ts`, `billing-grace.scheduler.spec.ts`, `billing.controller.spec.ts`)

## Acceptance-criteria coverage

- AC-1 … covered by the credit flow steps (first time + renewal + fees-ignored) · AC-2 … covered by the failed/mismatch rejection steps · AC-3 … covered by the grace cron steps · AC-4 … covered by the signature step · AC-5 … covered by the no-matching-checkout step · AC-6 … covered by the duplicate-delivery step · AC-7 … covered by the processing-failure step
