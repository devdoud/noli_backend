# Scope: Noli Backend

Noli is a series streaming platform backend: user accounts, a series/episode catalog, watch history, and genre based recommendations, built on NestJS and MongoDB.

**Build approach:** Tracer Bullet (each feature built end to end through every layer, working).
**Workflow:** GA (after /develop: /check verify, /test, a fresh model /check review, then /document; most features are treated as needing a spec first). `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· Alpha`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Authentication | Existing | existing |
| B | User Accounts | Existing | existing |
| C | Series Catalog & Episodes | Existing | existing |
| D | Watch History | Existing | existing |
| E | Recommendations | Existing | existing |
| 11 | Admin Bootstrap | Content | done |
| 12 | Categories | Content | done |
| 13 | Series & Episode Management | Content | done |
| 14 | Image Upload | Content | done |
| 15 | Episode Video Upload & Streaming | Content | in-progress |
| 16 | Pagination Bug Fix | Stabilize | done |
| 17 | Image Upload Hardening | Stabilize | planned |
| 18 | API Docs Refresh | Stabilize | in-progress |
| 19 | Demo Seed Data | Stabilize | done |
| 22 | Custom Domain & DNS | Stabilize | in-progress |
| 1 | Payment Provider Integration & Webhooks | Slice 1 | in-progress |
| 2 | Content Gating for Premium | Slice 1 | done |
| 3 | Subscription Checkout & Plan Management | Slice 1 | planned |
| 4 | Billing Email Notifications | Slice 2 | planned |
| 5 | Admin Billing Dashboard | Slice 2 | planned |
| 6 | Profile Editing | Slice 3 | planned |
| 7 | Google & Apple Sign In | Slice 3 | planned |
| 8 | Watchlist | Slice 3 | planned |
| 9 | Home Feed | Slice 3 | planned |
| 10 | Offline Downloads | Slice 3 | planned |
| 20 | Forgot Password | Slice 3 | in-progress |
| 21 | Push Notifications | Slice 3 | in-progress |

## Existing

### A. Authentication · existing
JWT based login and refresh token issuance; a guard protects routes that require a signed in user.
code in `src/auth/`

### B. User Accounts · existing
Registration, profile lookup, and user listing; roles (`user`/`admin`) and a subscription plan field that exists on the schema but isn't enforced yet.
code in `src/users/`

### C. Series Catalog & Episodes · existing
Create, list, and delete series, add episodes, search, genre browsing, trending, and ratings (no editing a series, and no editing or deleting an episode yet: see feature 13); admin only writes are gated by a manual role check in the controller, not a shared guard.
code in `src/series/`

### D. Watch History · existing
Per user episode progress tracking and a "continue watching" list.
code in `src/watch-history/`

### E. Recommendations · existing
Genre based personalized picks, popular, trending, similar, new, and top rated series.
code in `src/recommendations/`

## Content management

Placed before the rest of monetization: the app can't be tested without content, and content can't be created without an admin.

### 11. Admin Bootstrap · done · Alpha
A safe, one time way to make an existing account admin, since sign up always creates `role: user` and every content write is admin only.
**Done when:** running a script with an existing email makes that user admin, it refuses an unknown email, and running it twice changes nothing.
code in `scripts/make-admin.ts` (`npm run db:make-admin -- <email>`)
- [x] Build it: `/develop admin bootstrap`
- [x] Verify it: `/check verify admin bootstrap`

### 12. Categories · done
A managed list of categories (name, image, display order) that an admin maintains, so series are filed under real categories instead of free text genres with typos and duplicates.
**Done when:** an admin can create, edit, reorder, and remove categories, anyone can list them, series are linked to categories, and existing genres are carried over.
spec [0003](../specs/0003-categories/index.md) · code in `src/categories/`
- [x] Design it (spec): `/architect categories`
- [x] Build it: `/develop categories`
  - [x] Category core: schema, slugify, module wiring, create and public list end to end (satisfies AC-1, AC-5)
  - [x] Series on categories: `categoryIds` replaces `genres`, populate on every read and write, one mapper for single and list responses (satisfies AC-7, AC-8, AC-9)
  - [x] Browsing and admin management: by slug, series in a category, hidden list, edit, reorder, delete in use guard (satisfies AC-2 to AC-6)
  - [x] Recommendations on categories, genres migration run twice, OpenAPI regenerated (satisfies AC-8, AC-9, AC-10)
- [x] Verify it: `/check verify categories`
- [x] Test it: `/test categories`
- [x] Review it (fresh model): `/check review categories`
- [x] Document it: `/document categories`

### 13. Series & Episode Management · done
Complete the admin content tools: edit a series, and edit or delete an episode.
**Done when:** an admin can update a series' details and an episode's details, delete an episode, and what that means for watch history and premium teaser counts is handled.
spec [0004](../specs/0004-series-episode-management/index.md) · code in `src/series/`, `src/watch-history/`
- [x] Design it (spec): `/architect series & episode management`
- [x] Build it: `/develop series & episode management`
  - [x] Series edit end to end: one PATCH for every field, title and category rules, `/access` as an alias, `409` on duplicate titles (satisfies AC-1, AC-2, AC-3, AC-9)
  - [x] Episode edit with the history title cascade (satisfies AC-4, AC-5, AC-9)
  - [x] Episode and series delete with the retry safe history cleanup (satisfies AC-6, AC-7, AC-8)
  - [x] Atomic episode add, aligned create rules, OpenAPI regenerated (satisfies AC-10, AC-11)
- [x] Verify it: `/check verify series & episode management`
- [x] Test it: `/test series & episode management`
- [x] Review it (fresh model): `/check review series & episode management`
- [x] Document it: `/document series & episode management`

### 14. Image Upload · done
Let an admin upload series cover and banner images (and category images) instead of pasting URLs hosted somewhere else.
**Done when:** an admin uploads an image, gets back a stable public URL stored on the series or category, and oversized or non image files are refused.
spec [0005](../specs/0005-image-upload/index.md) · code in `src/media/`, `src/series/`, `src/categories/`, `src/users/`
- [x] Design it (spec): `/architect image upload`
- [x] Build it: `/develop image upload`
  - [x] Series cover end to end: media module, Cloudinary upload, validation, compare and set replace (satisfies AC-1, AC-5, AC-6, AC-12, AC-14)
  - [x] Remove route and guard rails: shared per user rate limit, 401/403/404/409 paths (satisfies AC-7, AC-10, AC-11, AC-13)
  - [x] Remaining slots: banner, episode thumbnail, category image, user avatar (satisfies AC-1, AC-2, AC-3, AC-4, AC-7)
  - [x] Cascades on delete and pasted URL cleanup, then Swagger, OpenAPI, and the live check (satisfies AC-8, AC-9, all ACs live)
- [x] Verify it: `/check verify image upload`
- [x] Test it: `/test image upload`
- [x] Review it (fresh model): `/check review image upload`
- [x] Document it: `/document image upload`

### 15. Episode Video Upload & Streaming · in-progress
Let an admin upload an episode's video file instead of pasting a `videoUrl` hosted somewhere else, and stream it to the app at a quality that adapts to the viewer's connection.
**Done when:** an admin uploads a video for an episode and it becomes playable once processed, the app streams it at a quality matching the network, a premium episode's playback link expires quickly so a shared link stops working, and deleting the episode or series also removes its video.
spec [0006](../specs/0006-episode-video-streaming/index.md) · code in `src/video/`, `src/series/`
**On hold (2026-10-01):** built and checked without keys (352 tests, 25/25 live); the live check waits for Cloudflare Stream to be activated on the account (paid, usage based) and the API token to get the `Stream · Edit` permission. Until then, episodes keep using pasted `videoUrl` links.
- [x] Design it (spec): `/architect episode video upload & streaming`
- [ ] Build it: `/develop episode video upload & streaming`
  - [x] Thin thread: upload link, refresh, signed HLS playback end to end (satisfies AC-1, AC-3, AC-6, AC-7, AC-8, AC-15)
  - [x] Signed webhook with retries and environment check (satisfies AC-3, AC-4, AC-5)
  - [x] Resumable uploads, import from URL, replacement race, expired links (satisfies AC-1, AC-2, AC-11, AC-16)
  - [ ] Viewer visibility, admin view, video delete, and cascades, then Swagger and the live check (satisfies AC-9, AC-10, AC-12, AC-13, AC-14, all ACs live)
- [ ] Verify it: `/check verify episode video upload & streaming`
- [ ] Test it: `/test episode video upload & streaming`
- [ ] Review it (fresh model): `/check review episode video upload & streaming`
- [ ] Document it: `/document episode video upload & streaming`

## Stabilize (next)

Recommended next slice (from the 2026-10-01 replan): pay the verification debt before building more. Five features are built but never verified; checking them catches bugs before anything is stacked on top. Suggested order, each box a command you may run or skip:

1. ~~`/check verify content gating for premium` (feature 2)~~ done 2026-10-01
2. ~~`/check verify admin bootstrap` (feature 11, closes it at Alpha)~~ done 2026-10-01
3. ~~`/check verify categories` (feature 12)~~ done 2026-10-01
4. ~~`/check verify series & episode management` (feature 13)~~ done 2026-10-01
5. ~~Feature 16 below (a real bug the mobile app will hit)~~ done 2026-10-01
6. Feature 1's verify once the KkiaPay sandbox keys exist, then Subscription Checkout (3)

### 16. Pagination Bug Fix · done · Alpha
Watch history and recommendations answer `400` as soon as the app sends `page` and `limit`, because the query values arrive as text and are never converted to numbers.
**Done when:** `GET /watch-history?page=1&limit=50` and the paginated recommendations routes accept numeric `page`/`limit` and return the requested page, and invalid values still answer `400`.
code in `src/watch-history/dto/`, `src/recommendations/dto/`, `src/watch-history/watch-history.controller.ts`
- [x] Build it: `/develop pagination bug fix`
- [x] Verify it: `/check verify pagination bug fix`

### 17. Image Upload Hardening · Beta · needs a decision · from spec 0005
Close the four minor points of the Image Upload review: a pasted URL can reuse another owner's uploaded file, no test proves the rate limit guard loads inside the real users module, cleanup only knows the current environment folder, and an unexpected Cloudinary delete result is not logged.
**Done when:** the pasted URL rule is decided and enforced, the guard is proven in its real module, a renamed environment can't silently orphan files, and every failed delete is logged.
- [ ] Design it (spec): `/architect image upload hardening`

### 18. API Docs Refresh · in-progress · Alpha
`docs/api-reference.md` still describes genres and a public `videoUrl`; bring it in line with categories, images, videos, and the new `/play` response.
**Done when:** the reference matches the current OpenAPI file for every route the mobile app uses.
code in `docs/api-reference.md` (and `docs/openapi.json`, regenerated 2026-10-02)
- [x] Build it: `/develop api docs refresh`
- [ ] Verify it: `/check verify api docs refresh`

### 19. Demo Seed Data · done · Alpha
Fill the development database with realistic demo content so the mobile app can be built and tested before real content exists: categories, series with episodes and images, and test accounts.
**Done when:** one command adds 10 categories, 12 series (free and premium, 72 playable episodes with images) and three accounts (free with a watch history, premium, admin), running it twice creates no duplicates, and one command removes exactly what it created.
code in `scripts/seed-demo.ts` (`npm run db:seed-demo`, `-- --remove`, `-- --reset`)
- [x] Build it: `/develop demo seed data`
- [x] Verify it: `/check verify demo seed data` (2026-10-03: 13/13 checks through the live API; reset removed only the recorded data)

### 22. Custom Domain & DNS · in-progress · Alpha
Put Noli on its own domain, `nollli.com` (bought on Hostinger, 2026-10-12): a stable API address instead of the Render URL, a sender domain for emails, and room for the dashboard and a public site.
**Done when:** the API answers over HTTPS on its own subdomain (the app, the dashboard and the payment and video webhooks use it), emails leave from an address on the domain with SPF, DKIM and DMARC passing, the dashboard origin is allowed by CORS, and the Render URL is no longer referenced anywhere.
spec [0009](../specs/0009-custom-domain-dns.md) · code in `src/http-config.ts`, `src/main.ts`
- [x] Design it (spec): `/architect custom domain & dns`
- [ ] Build it: `/develop custom domain & dns`
  - [x] `api.nollli.com` live on Render with HTTPS, app pointed to it; webhooks follow when KkiaPay and Stream go live (satisfies AC-1, AC-2, AC-3)
  - [ ] Email on the domain: Brevo authenticated, one SPF, DMARC, `support@` mailbox (satisfies AC-4, AC-5, AC-6)
  - [ ] Backend switches `CORS_ORIGINS` and `SWAGGER_ENABLED` (satisfies AC-7, AC-8)
  - [ ] Cleanup: no Render URL left, renewal and two factor login on (satisfies AC-9)
- [ ] Verify it: `/check verify custom domain & dns`

## Slice 1: Monetize subscriptions

### 1. Payment Provider Integration & Webhooks
Stand up recurring billing with a payment provider and a webhook endpoint so subscription status updates in real time, not just at checkout.
**Done when:** a test subscription's webhook events (created, renewed, failed, canceled) update the user's subscription record without manual intervention.
spec [0001](../specs/0001-payment-provider-integration-webhooks/index.md) · code in `src/billing/`
- [x] Design it (spec): `/architect payment provider integration & webhooks`
- [x] Build it: `/develop payment provider integration & webhooks`
  - [x] Foundations: KkiaPay SDK client, `PendingCheckout`/`WebhookEvent` schemas, signed webhook route skeleton (satisfies AC-4)
  - [x] Happy path credit flow: verify, atomic claim, credit the subscription end to end (satisfies AC-1)
  - [x] Rejection, idempotency, and retry handling: failed/mismatched transactions, unmatched checkouts, duplicate delivery, processing failures (satisfies AC-2, AC-5, AC-6, AC-7)
  - [x] Grace period automation and observability: the daily downgrade cron, structured logging (satisfies AC-3)
- [ ] Verify it: `/check verify payment provider integration & webhooks`
- [ ] Test it: `/test payment provider integration & webhooks`
- [ ] Review it (fresh model): `/check review payment provider integration & webhooks`
- [ ] Document it: `/document payment provider integration & webhooks`

### 2. Content Gating for Premium · done
Mark which series are free vs premium and enforce it, keeping a real free tier so there's always something to watch before paying.
**Done when:** a free user can play free series but is blocked with an upgrade prompt on premium ones; a premium user plays everything.
spec [0002](../specs/0002-content-gating-premium/index.md) · code in `src/series/`
- [x] Design it (spec): `/architect content gating for premium`
- [x] Build it: `/develop content gating for premium`
  - [x] Data and access rules: `isPremium`/`freeEpisodeCount` fields, backfill run and confirmed, the pure access module (satisfies AC-2, AC-3, AC-8)
  - [x] Gated play endpoint end to end, with the `PREMIUM_REQUIRED` 403 (satisfies AC-1, AC-2, AC-3, AC-4)
  - [x] Close every videoUrl leak: series routes through the shared mapper, episode ordering, recommendations without episodes (satisfies AC-5, AC-6)
  - [x] Admin control: premium flags on create and `PATCH /series/:id/access`, then regenerate the OpenAPI doc (satisfies AC-7)
- [x] Verify it: `/check verify content gating for premium`
- [x] Test it: `/test content gating for premium`
- [x] Review it (fresh model): `/check review content gating for premium`
- [x] Document it: `/document content gating for premium`

### 3. Subscription Checkout & Plan Management · needs a decision
Let a user subscribe, upgrade, downgrade, or cancel their plan, driving the provider set up in feature 1.
**Done when:** a user can complete checkout and land on premium, and later change or cancel their plan, with their account reflecting it immediately.
- [ ] Design it (spec): `/architect subscription checkout & plan management`

## Slice 2: Billing support

### 4. Billing Email Notifications · needs a decision
Email users on payment receipts, failed or renewed payments, and plan changes, so billing surprises don't turn into support tickets or silent churn.
**Done when:** a successful charge, a failed charge, and a plan change each send the right email.
- [ ] Design it (spec): `/architect billing email notifications`

### 5. Admin Billing Dashboard · needs a decision
Give an admin visibility into active subscribers, revenue, and failed payments without querying the database directly.
**Done when:** an admin can see active subscribers, recent revenue, and recent failed payments from an authenticated admin route.
- [ ] Design it (spec): `/architect admin billing dashboard`

## Slice 3: Account and discovery

### 6. Profile Editing · needs a decision
Let a signed in user update their own first and last name, username, and avatar, and change their password. Email change is left out for now.
**Done when:** a user can edit these fields on their own account only, a username clash is rejected, and a password change requires the current password.
- [ ] Design it (spec): `/architect profile editing`

### 7. Google & Apple Sign In · needs a decision
Let users sign up and sign in with their Google or Apple account alongside email and password, so onboarding on mobile takes one tap.
**Done when:** a new user can create an account with Google or Apple, a returning one signs back in to the same account, and both get the usual access and refresh tokens.
- [ ] Design it (spec): `/architect google & apple sign in`

### 8. Watchlist · needs a decision
Let a user save series to watch later and see their saved list.
**Done when:** a user can add and remove a series from their own watchlist and list it paginated, newest first, with no duplicates.
- [ ] Design it (spec): `/architect watchlist`

### 9. Home Feed · needs a decision
One call that returns the home screen rails (continue watching, trending, new, top rated, by genre), so the frontend doesn't make five separate requests.
**Done when:** a signed in user gets all home rails in one response, and a signed out visitor gets the public rails only.
- [ ] Design it (spec): `/architect home feed`

### 10. Offline Downloads · needs a decision
Let premium users download episodes to watch offline, a paid perk that gives free users a reason to upgrade. Depends on Content Gating (feature 2).
**Done when:** a premium user can request a download of an episode and list their downloads, a free user is refused with an upgrade prompt, and downloads stop working once premium lapses.
- [ ] Design it (spec): `/architect offline downloads`

### 20. Forgot Password · in-progress
Let a user who forgot their password get it back on their own: they enter their email, receive a single use reset code or link that expires quickly, and choose a new password. Today the only way out is a new account.
**Done when:** a user can request a reset by email and set a new password with the code or link, the code or link works once and expires, the answer never reveals whether an email has an account, requests are rate limited, and old sessions stop working after the reset.
Picks the email sending service (Brevo, `src/mail/`) that feature 4 (Billing Email Notifications) will reuse.
spec [0007](../specs/0007-forgot-password/index.md) · code in `src/auth/password-reset/`, `src/mail/`, `src/auth/`, `src/throttler.config.ts`
- [x] Design it (spec): `/architect forgot password`
- [x] Build it: `/develop forgot password`
  - [x] Thin thread: request, code in the dev log, verify, reset with login shaped tokens (satisfies AC-1, AC-5, AC-8, AC-11, AC-15, AC-16, AC-18)
  - [x] Session cut with `tokenVersion` in every token (satisfies AC-9)
  - [x] Hardening: silent limits, uniform errors, atomic tries, single use claim with rollback (satisfies AC-2, AC-3, AC-4, AC-6, AC-7, AC-10, AC-17)
  - [x] Real email through Brevo, French templates, changed password alert (satisfies AC-1, AC-12, AC-14, AC-18)
  - [x] IP limits, `TRUST_PROXY`, Swagger, OpenAPI, API reference, then the live check (satisfies AC-13, AC-18, all ACs live)
- [ ] Verify it: `/check verify forgot password`
- [ ] Test it: `/test forgot password`
- [ ] Review it (fresh model): `/check review forgot password`
- [ ] Document it: `/document forgot password`

### 21. Push Notifications · in-progress
Send push notifications to the mobile app, so users hear about new episodes of series they follow or watch, and about their account (premium ending, payment failed).
**Done when:** the app can register and remove a device for a signed in user, a new episode notifies the users concerned, a user can turn notification types off, and devices that no longer exist are cleaned up.
Gets stronger once Watchlist (feature 8) exists, since "series I follow" can come from it; until then, watch history (last 90 days) stands in. Needs the app side Firebase setup in `noli_app` to reach real phones.
spec [0008](../specs/0008-push-notifications/index.md) · code in `src/notifications/`, hooks in `src/series/`, `src/video/`, `src/billing/`, `src/auth/password-reset/`
- [x] Design it (spec): `/architect push notifications`
- [x] Build it: `/develop push notifications`
  - [x] Thin thread: devices, Firebase client with dev log mode, admin test push (satisfies AC-1, AC-2, AC-15, AC-17)
  - [x] Inbox and preferences routes (satisfies AC-3, AC-12, AC-13)
  - [x] New episodes end to end: queue, fan out, grouping, cap, quiet hours, delivery and token cleanup (satisfies AC-4, AC-8, AC-9, AC-10, AC-11, AC-14, AC-18)
  - [x] New series announcement and account events: premium reminders, payments, device purge on reset (satisfies AC-5, AC-6, AC-7, AC-16)
  - [x] Swagger, OpenAPI, API reference, then the live check (all ACs live)
- [ ] Verify it: `/check verify push notifications`
- [ ] Test it: `/test push notifications`
- [ ] Review it (fresh model): `/check review push notifications`
- [ ] Document it: `/document push notifications`

## Deferred
Out of scope for this pass, kept so the plan stays honest.
- **Admin dashboard UI**: a dedicated content management screen on top of the admin API (features 11 to 14) · needs a decision
- **Catalog and discovery expansion**: search upgrade, reviews · needs a decision
- **Public site and legal pages** (from feature 22): a landing page on the domain, plus a privacy policy, terms of use, and an account deletion page. Google Play and the App Store require the privacy policy URL (and Google Play an account deletion URL) before publishing the app · needs a decision
- **Media orphan sweep** (from specs 0005 and 0006): a periodic cleanup of Cloudinary images and Cloudflare videos that no document references, worth adding if the logs show failed deletes · needs a decision

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies, so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + 2 to 5 milestones; the tier's closing boxes (`Verify it`, `Test it`, `Review it`, `Document it` for GA); any surfaced follow up enrolled |
| `in-progress` (building) | `/develop` | milestone sub boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | you, when you decide it is; `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; for GA, `/test` is the suggested point to call it done |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`. The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre workflow) and `dropped` (de scoped, kept for history).
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Alpha`) sets that one feature's rigor above or below the project default; no tag inherits the default (GA here).
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
