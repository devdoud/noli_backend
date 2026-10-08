# 0008. Push notifications

**Date**: 2026-10-07
**Status**: In Progress

## Summary

This sends push notifications to the Noli app on Android and iOS through Firebase Cloud Messaging (FCM, Google's free push service). Users hear about new episodes of series they watched recently, new series in their favorite categories, their premium ending, and their payments. Every notification also lands in an in app inbox kept 30 days. New content events go through a queue in MongoDB, processed by the existing scheduler every minute, so admin actions stay fast and nothing is lost on a restart. Pushes are grouped, capped at 3 content pushes a day, held during quiet hours, and each type can be turned off.

## Requirements

**User stories**:
- As a viewer, I want to know when a series I've been watching gets a new episode I can play, so that I come back to watch it.
- As a viewer, I want to hear about new series in the categories I watch most so that I discover them.
- As a premium user, I want a reminder before my premium ends and a confirmation when I pay so that I'm never cut off by surprise.
- As a user, I want to turn each kind of notification off, never be spammed or woken at night, and find missed notifications in an inbox.
- As an admin, I want to send myself a test push so that I can check the whole chain works.

**Acceptance criteria** (the contract):
- **AC-1**: `PUT /notifications/devices` (signed in) with `{ token, platform: 'android' | 'ios', appVersion? }` → `200 { message, device: { token, platform, appVersion, lastSeenAt } }` (no `_id`, no `userId`). The same token again only refreshes it (no duplicate, also under concurrent calls). A token registered to another account moves to the caller. A user keeps at most 10 devices: beyond that the least recently seen are removed, never the one just registered.
- **AC-2**: `DELETE /notifications/devices` (signed in) with body `{ token }` removes that device if it belongs to the caller and answers `200 { message }` whether or not it existed. A missing token → `400`.
- **AC-3**: `GET /notifications/preferences` → `200 { newEpisodes, newSeries, premium, payment }`, all `true` by default (missing values read as `true`). `PATCH /notifications/preferences` with any subset of those booleans updates them and answers the full set; a non boolean → `400`; a body with no known field left after the whitelist (empty, or only unknown fields) → `400`.
- **AC-4**: When an episode becomes playable (added with a `videoUrl`, or its Cloudflare video reaches ready for the first time) in a series announced before that moment, a `new_episodes` notification goes to every user who watched an episode of that series in the last 90 days, has `newEpisodes` on, and can play that episode (a free episode: anyone; a premium episode: users with premium access per spec 0002). One notification per user, series, and Lagos day: more episodes the same day update its count, text, and position in the inbox, mark it unread, and send no new push. A replacement video for an already playable episode notifies no one.
- **AC-5**: When a series that is new since this feature gets its first playable episode, it is announced once: every user whose top 3 watched categories (by number of distinct watched series per category, all time) include one of the series' categories, who has `newSeries` on, and who can play that first episode, gets a `new_series` notification. Episodes made playable before or with the announcement send no `new_episodes`. Series that existed before this feature are never announced. A crash during the announcement is retried until every recipient has it, without duplicates.
- **AC-6**: A daily run at 09:00 Africa/Lagos (and once at boot if that day's run was missed) sends `premium_ending` to users with an active premium subscription (`plan: 'premium'`, `isActive: true`) and `premium` on, whose `subscription.endDate` falls 3 Lagos days later, and again on the day it falls; each at most once per end date and reminder, even with several API instances.
- **AC-7**: A credited KkiaPay payment sends `payment_succeeded` with the new end date; a transaction KkiaPay verifies as failed sends `payment_failed` to the user of the pending checkout with the same `partnerId` (read, not consumed). No matching checkout or no `partnerId` → no notification. Each transaction notifies at most once per outcome, whatever the webhook retries.
- **AC-8**: At most 3 content pushes (`new_episodes`, `new_series`) per user per Lagos day of sending. When more are due, `new_episodes` go before `new_series`, then oldest first; the rest stay in the inbox without a push. Account notifications (`premium_ending`, `payment_*`) are never capped.
- **AC-9**: A content notification due between 22:00 and 07:00 Lagos time is pushed at 07:00 (and counts toward that day's cap); account notifications are pushed right away.
- **AC-10**: A notification is pushed to all of the user's devices with a French title and body, and data `{ type, notificationId, seriesId?, seasonNumber?, episodeNumber? }` (strings) so the app can open the right screen. On iOS the badge is the user's unread count.
- **AC-11**: A device whose token FCM reports as unregistered or invalid is deleted. A temporary FCM failure retries up to 3 times; a notification still unsent 24 hours after creation is marked `failed` and never pushed late.
- **AC-12**: `GET /notifications?page&limit` (signed in, `limit` 1 to 50, default 20) → `200 { total, page, limit, unread, notifications: [{ _id, type, title, body, data, readAt, createdAt, updatedAt }] }`, most recently updated first, only the caller's, the last 30 days. `PATCH /notifications/:id/read` marks one read (`404` if not the caller's or a malformed id); `POST /notifications/read-all` marks all read and answers `{ message, updated }`.
- **AC-13**: A type turned off in preferences creates no notification of that type (neither push nor inbox).
- **AC-14**: Retries, crashes, and several API instances never put the same notification twice in an inbox, never inflate an episode count, and never push the same notification twice except in the narrow window of a crash between FCM accepting it and the database recording it (at least once delivery for pushes, exactly once for the inbox).
- **AC-15**: `POST /notifications/test` (admin only) pushes a French test notification to the caller's own devices right away and answers `200 { devices, sent, failed }` (in dev log mode, `sent` = `devices`); a non admin → `403`; no Firebase credentials outside dev → `503 { code: 'PUSH_UNAVAILABLE' }`.
- **AC-16**: After a password reset (spec 0007), all of that user's devices are removed.
- **AC-17**: Without Firebase credentials the app still boots and everything except the push itself works: with `NODE_ENV` `development` or `test`, each push is written to the log (`[push:dev] …`) and counts as sent; otherwise pushes stay unsent (and expire per AC-11) and a warning is logged at boot.
- **AC-18**: Adding an episode, a Stream video becoming ready, or a payment webhook never fails or slows down because of notifications: the work is a small write in the same request, and a failure of that write is logged, never thrown.

## Decision

**Chosen option**: Option 2: FCM through `firebase-admin`, a MongoDB queue for content events processed by the existing scheduler every minute, an inbox collection that doubles as the dedupe log, and send time claims for the cap and delivery.

Content events become rows in `notification_jobs`; a one minute cron turns jobs into per user `notifications` (preferences, access, grouping, quiet hours), then claims due notifications one by one, checks the daily cap, and pushes them to every device of the user. Payment and premium notifications are written directly (one recipient, no fan out).

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.agents/skills/nestjs-best-practices/`) · `mongodb-query-optimizer` (`mongodb/agent-skills`, `.agents/skills/mongodb-query-optimizer/`, for the fan out aggregations) · `push-notification-setup` (`secondsky/claude-skills`, `.agents/skills/push-notification-setup/`) · `firebase-basics` (`firebase/agent-skills`, `.agents/skills/firebase-basics/`, project and service account setup) · app side: `firebase-messaging` (`evanca/flutter-ai-rules`, installed in `noli_app/.agents/skills/`)

## Feature design

**Module layout**: new `src/notifications/` with `NotificationsModule`: schemas; `DevicesService`; `NotificationsService` (inbox, preferences, and `createDirect` for single recipient notifications); `NotificationQueue` (enqueue); `NotificationProcessor` (fan out); `PushSender` (claims and delivery); `FcmClient`; `NotificationsScheduler` (crons); `notifications.controller.ts`; `templates/fr.ts`; `lagos-time.ts` (day key, next 07:00, day ranges; Lagos is a fixed UTC+1 with no daylight saving, so plain arithmetic on UTC is enough, no `Intl` or library). `SeriesModule`, `VideoModule`, `BillingModule` and `AuthModule` import it. The module registers with `forFeature` the models it reads (`Series`, `WatchHistory`, `User`, `Category`, `PendingCheckout`) and never calls those modules' services, to avoid circular imports. `ScheduleModule.forRoot()` is already registered in `AppModule`.

**Data model sketch**:

`devices` (new)
| Field | Type | Rule |
|---|---|---|
| `userId` | ObjectId → users | required, index `{ userId: 1, lastSeenAt: -1 }` |
| `token` | string | required, unique index, 1 to 4096 characters |
| `platform` | `'android' \| 'ios'` | required |
| `appVersion` | string \| null | optional, at most 32 characters |
| `lastSeenAt` | Date | set on every registration |
| `createdAt`, `updatedAt` | Date | timestamps |

`users` (changed): `notificationPrefs: { newEpisodes?: boolean, newSeries?: boolean, premium?: boolean, payment?: boolean }`, no defaults written; a missing value reads as `true`.

`series` (changed): `announcedAt: Date | null`. `createSeries` writes `announcedAt: null` from now on. A **missing** field means "already announced" (every series created before this feature), so no backfill is needed and no old series can ever be announced. The announce claim matches `{ announcedAt: null, ... }` only on documents where the field exists and is null (`announcedAt: { $type: 'null' }`).

`notifications` (new, inbox and log)
| Field | Type | Rule |
|---|---|---|
| `userId` | ObjectId → users | required; index `{ userId: 1, updatedAt: -1 }` |
| `type` | `'new_episodes' \| 'new_series' \| 'premium_ending' \| 'payment_succeeded' \| 'payment_failed'` | required |
| `title`, `body` | string | French, from `templates/fr.ts` |
| `data` | `{ seriesId?, seasonNumber?, episodeNumber?, count?, endDate? }` | for the app and the texts; for `new_episodes`, `seasonNumber`/`episodeNumber` are the latest episode and `count` = `jobIds.length` |
| `dedupeKey` | string | required; unique index `{ userId: 1, dedupeKey: 1 }` |
| `jobIds` | ObjectId[] | jobs applied to this notification (idempotence) |
| `pushStatus` | `'pending' \| 'sending' \| 'sent' \| 'skipped' \| 'failed'` | `skipped` with `skipReason` `'cap' \| 'no_device'`; `failed` with `'stale' \| 'fcm'` |
| `skipReason` | string \| null | see above |
| `sendAfter` | Date | when it may be pushed (quiet hours); index `{ pushStatus: 1, sendAfter: 1 }` |
| `pushAttempts` | number | default 0, at most 3 |
| `typeRank` | number | `0` account types, `1` `new_episodes`, `2` `new_series`; delivery order (AC-8) |
| `lockedAt` | Date \| null | set while `sending`; a `sending` notification locked more than 2 minutes ago goes back to `pending` |
| `readAt` | Date \| null | |
| `createdAt` | Date | immutable; TTL index, 30 days |
| `updatedAt` | Date | bumped when a grouped update lands; the inbox sorts on it |

Dedupe keys: `new_episodes:<seriesId>:<lagosDay>` (Lagos day of the job's creation), `new_series:<seriesId>`, `premium_ending:<endDateLagosDay>:<d3|d0>`, `payment_succeeded:<transactionId>`, `payment_failed:<transactionId>`. `<lagosDay>` is `YYYY-MM-DD` in Africa/Lagos.

`push_counters` (new, the daily cap)
| Field | Type | Rule |
|---|---|---|
| `userId` | ObjectId | |
| `lagosDay` | string | `YYYY-MM-DD`; unique index `{ userId: 1, lagosDay: 1 }` |
| `count` | number | content pushes claimed that day, at most 3 |
| `createdAt` | Date | TTL 2 days |

`notification_jobs` (new, queue for content events)
| Field | Type | Rule |
|---|---|---|
| `kind` | `'episode_playable'` | the only kind for now |
| `payload` | `{ seriesId, seasonNumber, episodeNumber, announcing? }` | `announcing` is set when this job claimed the series announcement |
| `status` | `'pending' \| 'processing' \| 'done' \| 'failed'` | default `pending`; index `{ status: 1, runAfter: 1 }` |
| `attempts` | number | default 0, at most 5 |
| `runAfter` | Date | default now; backoff 1, 5, 15, 60 minutes |
| `lockedAt` | Date \| null | refreshed after every write batch; a `processing` job whose `lockedAt` is older than 5 minutes is taken again |
| `error` | string \| null | last error message |
| `createdAt`, `updatedAt` | Date | partial TTL index, 7 days on `updatedAt` for `done` and `failed` |

**State transitions**:
- Job: `pending` → `processing` (claimed) → `done`; on error → `pending` with `attempts + 1` and the next `runAfter`; after the 5th failure → `failed`. Finishing (`done`) is conditional on `lockedAt` still being this worker's value; if another worker took it over, the first one stops quietly.
- Push: `pending` → `sending` (claimed with `lockedAt`) → `sent`, or → `skipped` (`cap`, `no_device`), or → `pending` again (temporary FCM error, `pushAttempts + 1`), or → `failed` (`fcm` after 3 attempts, `stale` when older than 24 hours).

**Hooks** (each in a try/catch that logs and never rethrows, AC-18):
- `SeriesService.addEpisode`: when the added episode has a `videoUrl`, `NotificationQueue.enqueue(seriesId, season, episode)`.
- `VideoStateService.applyOnce`, state `ready`, only on the path where the update applied (after the `!before` early return, never on `'repeat'`): when the pre image episode had neither `streamUid` nor `videoUrl`, enqueue. A replacement (it was playable) enqueues nothing. `addEpisode` and Stream ready are the only ways an episode becomes playable (`updateEpisode` and `createSeries` cannot set a video).
- `BillingService.handleWebhook`:
  - Success: `creditSubscription` now returns the user's `subscription.endDate` after the update (`returnDocument: 'after'`). Right after it, **before** `markCredited`, call `NotificationsService.createDirect` for `payment_succeeded` (key `payment_succeeded:<transactionId>`). A retried webhook that re credits (no op) re reads the end date and hits the existing key, so nothing is duplicated, and a notification failure can never leave the event marked processed without it.
  - Failure (`verified.status !== 'SUCCESS'`): if `verified.partnerId` is set, read the `PendingCheckout` with that `partnerId` (lean, not consumed); if found, `createDirect` for `payment_failed` (key `payment_failed:<transactionId>`). A webhook is only acted on after KkiaPay verifies the transaction, so a forged call cannot invent a failure.
- `PasswordResetService.resetPassword`: after the user update, `DevicesService.removeAllForUser(userId)` (AC-16).

`createDirect` checks the user's preference, inserts with the dedupe key (a duplicate key error means "already there", treated as success), `sendAfter = now`, `pushStatus: 'pending'`.

**Processing** (`NotificationsScheduler`, `@Cron('* * * * *')`; an in memory flag skips a run while the previous one is still going in this process; claims make it safe across instances):
1. Claim jobs one by one (`findOneAndUpdate` on `status: 'pending', runAfter <= now` or a stale `processing`, setting `processing` and `lockedAt`), up to 50 per run.
2. `episode_playable`: load the series (`_id`, `title`, `categoryIds`, `isPremium`, `freeEpisodeCount`, `announcedAt`, `episodes`). Episode or series gone, or episode no longer playable → `done`.
   - **Announcement**: if `payload.announcing` is already true, continue the `new_series` fan out (a retry). Else claim it: `findOneAndUpdate({ _id, announcedAt: { $type: 'null' } }, { announcedAt: now })`, and on success set `payload.announcing: true` on the job in the same step (job update right after, before any fan out). Announcing jobs fan out `new_series` only.
   - **New episodes**: only if the series' `announcedAt` exists and is earlier than the job's `createdAt` (so episodes made playable around the launch don't also send `new_episodes`).
   - Who can play the episode: `isEpisodeFree` from `content-access.ts` with the series' current episodes; if free, everyone; else only users with premium access now (`hasPremiumAccess`, which covers admins and the grace period).
   - `new_episodes` recipients: an aggregation on `watch_histories` matching `episodes: { $elemMatch: { seriesId: <seriesId as string>, lastWatchedAt: { $gte: now - 90 days } } }` (watch history stores `seriesId` as a string; `userId` is an ObjectId), projecting only `userId`; then the users' `notificationPrefs` and `subscription`/`role` in one `users` query on those ids; filter by preference and access.
   - `new_series` recipients: one aggregation over `watch_histories`: unwind `episodes`, group distinct `(userId, seriesId)`, convert `seriesId` with `$toObjectId`, `$lookup` the series' `categoryIds`, unwind, count distinct series per `(userId, categoryId)`, sort by count desc then `categoryId` asc, keep each user's first 3, keep users whose top 3 intersect the new series' `categoryIds` (remember the first matching category for the text); then prefs and access as above. A series without categories matches no one. This is a full scan of `watch_histories` per announcement, acceptable at current scale (see Consequences).
3. For each recipient, write the notification idempotently in `bulkWrite` batches of 500 (unordered), refreshing the job's `lockedAt` after each batch:
   - `new_episodes`: one pipeline update with `upsert: true` on `{ userId, dedupeKey }`. Stage 1 `$set`: `jobIds` = `$setUnion` of the existing `jobIds` (or `[]`) and `[jobId]`; `createdAt`, `type`, `typeRank`, `pushStatus` (`'pending'`), `sendAfter`, `pushAttempts` (`0`) each kept with `$ifNull` (only written on insert); `title`, `data.seriesId`, `data.seasonNumber`, `data.episodeNumber` set to this episode; `readAt: null`; `updatedAt: now`. Stage 2 `$set`: `data.count` = `$size` of `jobIds`, and `body` = `$cond` on that count (the single episode text when 1, else `$concat` of the count and ` nouveaux épisodes sont disponibles`). Applying the same job twice yields the same document (the union and the size do not change), so retries are harmless. A duplicate key error from two concurrent upserts is retried once (the retry finds the document and updates it).
   - `new_series`: insert with `$setOnInsert` only (the key makes it once per user and series).
   - `sendAfter`: now, or the next 07:00 Lagos when now is between 22:00 and 07:00 Lagos.
   - A grouped update does not touch `pushStatus`: if the push already went (or was skipped), no new push; the inbox entry becomes unread and moves to the top, so the next badge reflects it.
4. Mark the job `done` (conditional on its `lockedAt`).

**Delivery** (`PushSender`, after processing in the same cron run):
1. `updateMany` `pending` notifications with `createdAt` older than 24 hours → `failed` / `stale`; `sending` ones with `lockedAt` older than 2 minutes → `pending`.
2. Repeat up to 500 times: claim the next due notification with `findOneAndUpdate({ pushStatus: 'pending', sendAfter: { $lte: now } }, { pushStatus: 'sending', lockedAt: now }, { sort: { typeRank: 1, sendAfter: 1 } })`, where `typeRank` is a stored number (`0` account types, `1` `new_episodes`, `2` `new_series`) written at creation, so account pushes go first and episodes beat series under the cap (AC-8).
3. Content types: claim the cap slot `findOneAndUpdate({ userId, lagosDay: <today in Lagos>, count: { $lt: 3 } }, { $inc: { count: 1 }, $setOnInsert: { createdAt: now } }, { upsert: true })`. No slot (the upsert hits the unique index because the existing document has `count: 3`) → `skipped` / `cap`.
4. Load the user's devices. None → `skipped` / `no_device`.
5. Build and send with `sendEachForMulticast`: `notification { title, body }`; `data` as strings (`type`, `notificationId`, `seriesId`, `seasonNumber`, `episodeNumber` when present); Android `priority` `'high'` for account types, `'normal'` for content, `channelId` `'account'` or `'content'`, `collapseKey` and `tag` = `dedupeKey`; APNs `aps.badge` = the user's unread count, `threadId` = `seriesId` when present.
6. Per token: `messaging/registration-token-not-registered`, `messaging/invalid-registration-token`, or a token level `messaging/invalid-argument` → delete that device. At least one success → `sent`. Only temporary errors → back to `pending` with `pushAttempts + 1` (`failed` / `fcm` at 3), and give back the cap slot (`$inc: -1`). All tokens invalid → `skipped` / `no_device`, cap slot given back.

**Premium reminders** (`@Cron('0 9 * * *', { timeZone: 'Africa/Lagos' })`, plus one run at boot when the current Lagos time is past 09:00): query users with `subscription.plan: 'premium'`, `subscription.isActive: true`, `notificationPrefs.premium` not `false`, and `subscription.endDate` in the UTC range of the Lagos day today + 3 (`d3`) or today (`d0`), so an index on `subscription.endDate` can serve it; insert with `bulkWrite` unordered, ignoring duplicate key errors (several instances or a rerun add nothing).

**Texts** (`templates/fr.ts`):
- `new_episodes`, count 1: title = series title; body `Nouvel épisode : S{season} É{episode}, {episode title}`. Count above 1: body `{n} nouveaux épisodes sont disponibles`.
- `new_series`: title `Nouvelle série : {title}`; body `À découvrir dans {matching category name}. Le premier épisode est disponible.`
- `premium_ending` `d3`: title `Ton premium se termine dans 3 jours`; `d0`: `Ton premium se termine aujourd'hui`; body `Renouvelle ton abonnement pour continuer à tout regarder.`
- `payment_succeeded`: title `Paiement reçu`; body `Ton premium est actif jusqu'au {endDate as dd/MM/yyyy in Lagos}.`
- `payment_failed`: title `Paiement échoué`; body `Ton paiement n'a pas abouti. Tu peux réessayer depuis l'app.`
- Test: title `Notification de test`; body `Si tu vois ce message, les notifications Noli fonctionnent.`

**Devices** (AC-1): `findOneAndUpdate({ token }, { $set: { userId, platform, appVersion, lastSeenAt: now } }, { upsert: true, returnDocument: 'after' })`; a duplicate key error from a concurrent upsert is retried once. Then delete the caller's devices beyond the 10 most recent by `lastSeenAt`, excluding the token just registered.

**API surface** (`@ApiTags('Notifications')`, all routes `JwtAuthGuard`, all `POST` routes `@HttpCode(200)`):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/notifications/devices` | PUT | `token` string (req, 1 to 4096), `platform` `android\|ios` (req), `appVersion` string (opt, ≤ 32) | `200 { message, device }` | signed in | `400`, `401` |
| `/notifications/devices` | DELETE | body `token` string (req) | `200 { message }` | signed in | `400`, `401` |
| `/notifications/preferences` | GET | | `200 { newEpisodes, newSeries, premium, payment }` | signed in | `401` |
| `/notifications/preferences` | PATCH | any of the 4 booleans | `200` full set | signed in | `400` non boolean, or nothing left after the whitelist (checked in the service) |
| `/notifications` | GET | `page` (≥ 1, default 1), `limit` (1 to 50, default 20) | `200 { total, page, limit, unread, notifications }` | signed in | `400` |
| `/notifications/:id/read` | PATCH | | `200 { message, notification }` | owner | `404` |
| `/notifications/read-all` | POST | | `200 { message, updated }` | signed in | |
| `/notifications/test` | POST | | `200 { devices, sent, failed }` | admin (inline check) | `403`, `503 PUSH_UNAVAILABLE` |

The `/notifications/test` push is sent synchronously (no queue, not stored in the inbox).

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| register device | owner | `req.user._id` |
| register device | token, platform, appVersion | request body |
| preferences | each flag | `users.notificationPrefs.*`, missing → `true` |
| new episode | became playable | `addEpisode` input `videoUrl`; Stream pre image with no `streamUid` and no `videoUrl` |
| new episode | recipients | `watch_histories.episodes` with this `seriesId` (string) and `lastWatchedAt` within 90 days → `userId`; filtered by prefs and access |
| new episode | access | `isEpisodeFree(series, episode)`; `hasPremiumAccess(user, now)` (spec 0002) |
| new episode | episode title, numbers | the series' episode found by the job's numbers |
| new episode | count | size of `notifications.jobIds` |
| new series | first playable, once | `series.announcedAt` existing and null, claimed atomically; `payload.announcing` for retries |
| new series | new episodes suppressed at launch | `series.announcedAt` vs `job.createdAt` |
| new series | recipients | aggregation of watched series' `categoryIds` per user, top 3, plus prefs and access |
| new series | category name | the first of the user's top 3 present in the series, `categories.name` |
| premium | who and when | `subscription.plan`, `subscription.isActive`, `subscription.endDate` in the Lagos day range |
| payment success | user, end date | `checkout.userId`; `subscription.endDate` returned by `creditSubscription` |
| payment failure | user | `PendingCheckout` with `verified.partnerId`, read only |
| any | Lagos day, 07:00, ranges | server clock + 1 hour (`lagos-time.ts`) |
| cap | pushes today | `push_counters.count` for `(userId, Lagos day of sending)` |
| order under cap | priority | `notifications.typeRank`, then `sendAfter` |
| push | devices | `devices` by `userId` |
| push | badge, unread | count of the user's notifications with `readAt: null` |
| test | admin | `req.user.role === 'admin'` |

**Key invariants**:
- One notification per `(userId, dedupeKey)`; a job's effect applies to a notification at most once (`jobIds`).
- A series is announced at most once, and only series created after this feature.
- A notification is pushed by one worker at a time (`sending` claim); at most 3 content pushes per user per Lagos day (`push_counters`); never a content push between 22:00 and 07:00 Lagos; never a push older than 24 hours.
- A token belongs to one user at a time; a user has at most 10 devices.
- A user never reads or changes another user's notifications, devices, or preferences.
- `createdAt` on a notification never changes (it drives the 30 day expiry).

**Security model**: Every route requires a signed in user and only touches the caller's data; the test route is admin only (inline role check). Push tokens are personal data: stored only in `devices`, returned only to their owner, logged only as their last 6 characters (the full token only in dev log mode). Notification texts contain no amounts or personal details beyond a series title and an end date. Payment notifications only follow a KkiaPay verified transaction. The Firebase service account key is a secret in the environment, never in the repo.

**Configuration required**:
- `FIREBASE_SERVICE_ACCOUNT_BASE64`: the Firebase service account JSON (Firebase console, Project settings, Service accounts, Generate new private key), base64 encoded on one line. Missing → AC-17 behavior.
- Prerequisites (outside this repo): a Firebase project with the Android and iOS apps added; an APNs authentication key uploaded in Firebase; `firebase_messaging` set up in `noli_app` (token on login and refresh, `PUT /notifications/devices`, `DELETE` on logout, Android channels `content` and `account`, routing taps from `data`, the inbox screen).

**Critical test scenarios**:
- Happy path: register a device, add an episode with a `videoUrl` to an announced series a user watched last week → within a minute one `new_episodes` notification, pushed (dev log), in `GET /notifications`, verifies **AC-1**, **AC-4**, **AC-10**, **AC-12**.
- Grouping and idempotence: three episodes the same day → one push, count 3, entry unread and on top; the same job processed twice (forced stale lock) leaves count 3 and one inbox entry, verifies **AC-4**, **AC-14**.
- Targeting: a user who watched 4 months ago gets nothing; a free user gets nothing for a premium episode, verifies **AC-4**.
- New series: a new series' first playable episode → `new_series` to top 3 fans only; two episodes playable in the same minute → no `new_episodes`; a pre existing series (no `announcedAt`) never announces; a crash after the claim (job reset) still completes the fan out, verifies **AC-5**.
- Limits: 5 content notifications due → 3 pushed (episodes first), 2 `skipped` / `cap`; content at 23:00 → pushed at 07:00 and counted that day; an account notification at 23:00 → pushed now; two instances never push the same notification, verifies **AC-8**, **AC-9**, **AC-14**.
- Failures: not registered token → device deleted; temporary error 3 times → `failed` / `fcm` with the cap slot returned; older than 24 hours → `stale`, verifies **AC-11**.
- Preferences and isolation: `newEpisodes: false` → nothing created; another user's notification id → `404`; empty or unknown only `PATCH` body → `400`; non admin on `/test` → `403`, verifies **AC-3**, **AC-12**, **AC-13**, **AC-15**.
- Account events: credited webhook → `payment_succeeded` with the right date, once despite a retry; failed verified transaction with a checkout → `payment_failed`; d3 and d0 reminders once each, inactive premium skipped; password reset → devices gone, verifies **AC-6**, **AC-7**, **AC-16**.
- No credentials: dev logs `[push:dev]` and `/test` answers `sent` = devices; staging boots with a warning, pushes stay pending then expire, verifies **AC-15**, **AC-17**.

## Build plan

Tracer Bullet: first one real push end to end (device, Firebase, test route), then the inbox, then the main event (new episode) through queue, fan out and delivery, then the other events.

1. [x] Thin thread: install `firebase-admin`; `lagos-time.ts`; `FcmClient` (credentials from `FIREBASE_SERVICE_ACCOUNT_BASE64`, dev log mode, boot warning); `devices` schema; `PUT`/`DELETE /notifications/devices` with the upsert and the 10 device rule; `POST /notifications/test`, satisfies **AC-1**, **AC-2**, **AC-15**, **AC-17**
2. [x] Inbox and preferences: `notifications` schema with its indexes and TTL; `notificationPrefs` on `User`; `GET`/`PATCH /notifications/preferences`; `GET /notifications`, read one, read all, satisfies **AC-3**, **AC-12**, **AC-13**
3. [x] New episodes end to end: `notification_jobs` and `push_counters` schemas; `announcedAt` on `Series` (null on create); enqueue hooks in `addEpisode` and the Stream ready transition; scheduler with job claims, backoff and lock refresh; `new_episodes` fan out (90 days, access, prefs) with idempotent grouping; `PushSender` with send claims, `typeRank`, cap slots, quiet hours, badge, stale and token cleanup; French templates, satisfies **AC-4**, **AC-8**, **AC-9**, **AC-10**, **AC-11**, **AC-14**, **AC-18**
4. [x] New series: the announcement claim with `payload.announcing`; the top 3 categories aggregation; `new_series` fan out; launch suppression of `new_episodes`, satisfies **AC-5**
5. [x] Account events: `createDirect`; payment hooks (success before `markCredited` with the end date returned by `creditSubscription`, failure through the checkout lookup); premium cron with boot catch up; device purge in the password reset, satisfies **AC-6**, **AC-7**, **AC-16**, **AC-18**
6. [x] Wrap up: Swagger (French summaries), OpenAPI regenerated, `docs/api-reference.md` section with the app side checklist, `.env` line, then the live check (dev log mode, and a real device once the Firebase project exists), satisfies all ACs live

## Consequences

**Positive**:
- Users come back when something they care about arrives, the main retention lever of a series app.
- Content events are durable and keep admin requests fast; the queue can carry future event kinds (watchlist, billing emails) with no new infrastructure.
- The inbox gives a second chance to every notification, including those not pushed (cap, quiet hours, no device).
- Targeting respects access (no promise of an episode the user cannot play) and recency (no push for a series dropped months ago).
- FCM is free and covers Android and iOS with one integration.

**Negative / tradeoffs**:
- Delivery has up to one minute of delay (cron), plus quiet hours; not real time.
- At least once push delivery: a crash between FCM accepting a push and the database recording it can duplicate that push (the inbox never duplicates).
- The fan outs are aggregations over watch histories; `new_series` scans them all per announcement. Fine for thousands of users; at hundreds of thousands it needs a precomputed "top categories per user" and a follower index (watchlist, feature 8).
- Several moving parts (jobs, send claims, cap counters, stale lock resets) for correctness across instances; more code to test than a naive sender.
- Google dependency: the app needs the Firebase SDK on both platforms, and iOS delivery depends on the APNs key uploaded in Firebase.
- Hooks in series, video, billing and auth couple four modules to notifications (one guarded call each).
- If no instance runs at 09:00 and none starts later that day, that day's premium reminders are lost (the boot catch up only covers a restart the same day).

**Neutral**:
- `creditSubscription` changes from `void` to returning the end date (billing tests to adapt).
- Feature 4 (billing emails) and feature 8 (watchlist) should plug into this module rather than build their own triggers.
- Deleting a series leaves its notifications in inboxes until their 30 day TTL; tapping one opens a missing series, which the app must handle as "no longer available".

## Follow-up

- [ ] App side (noli_app): add Firebase to the Flutter app with `firebase_messaging` (skill installed there), register and refresh the token, unregister on logout, create the `content` and `account` channels, route taps from `data`, show the inbox.
- [ ] Create the Firebase project, add both apps, upload the APNs key, generate the service account key, and fill `FIREBASE_SERVICE_ACCOUNT_BASE64`.
- [ ] Connect the official Firebase MCP server once the project exists: `claude mcp add firebase -- npx -y firebase-tools@latest mcp`.
- [ ] `/sync`: add `push-notification-setup` and `firebase-basics` to `AGENTS.md` (`src/notifications/AGENTS.md` for the queue and push conventions, pointer from root).
- [ ] Feature 8 (watchlist): add "series in my watchlist" as a second source of `new_episodes` recipients.
- [ ] Feature 4 (billing emails): reuse the payment hooks to send the emails.
- [ ] When users grow past tens of thousands: precompute top categories per user and move the fan out off the per event aggregation.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
