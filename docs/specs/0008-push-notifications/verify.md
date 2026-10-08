# Verify: Push notifications · spec 0008 · updated 2026-10-07
_Steps derived from spec 0008 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Setup: API with `NODE_ENV=development` and no `FIREBASE_SERVICE_ACCOUNT_BASE64`, so pushes are written to the server log (`[push:dev] user <id>, N device(s): <title> | <body> {data}`). Use throwaway `@noli.test` accounts, a throwaway series, and remove them with their devices, notifications, jobs, counters and watch histories afterwards. Content events need the one minute scheduler: wait for the jobs of the test series to leave `pending`/`processing`.

## Commands (API)
- [ ] `PUT /notifications/devices` twice with the same token → `200`, one `devices` row, response without `_id`/`userId`, `appVersion` updated → AC-1
- [ ] Same token registered by a second account → the row now belongs to that account → AC-1
- [ ] 11 tokens for one account → 10 kept, newest kept, oldest removed → AC-1
- [ ] Bad `platform` → `400`; no bearer → `401` → AC-1
- [ ] `DELETE /notifications/devices` with another account's token → `200`, row untouched; with no token → `400`; own token → removed → AC-2
- [ ] `GET /notifications/preferences` on a fresh account → all four `true` → AC-3
- [ ] `PATCH` `{ newSeries: false }` → full set with `newSeries: false`; `{}`, `{ foo: true }`, `{ premium: "oui" }` → `400` → AC-3
- [ ] `POST /notifications/test` as a user → `403`; as an admin with one device → `{ devices: 1, sent: 1, failed: 0 }` and a `[push:dev]` line → AC-15
- [ ] A new series (`announcedAt: null`), a fan whose top 3 categories include its category, then its first episode with a `videoUrl` → after the scheduler one `new_series` for the fan, French title and body, `pushStatus: sent`; `announcedAt` now set → AC-5
- [ ] A second episode added in the same minute as the first → no `new_episodes` for anyone → AC-5
- [ ] A user with `newSeries: false` gets no `new_series` → AC-13
- [ ] Two more episodes the same day on that (announced) series watched last week by a free user → one `new_episodes` notification, `data.count: 2`, body `2 nouveaux épisodes sont disponibles`, one push only → AC-4
- [ ] The series made premium with 4 free episodes, a 5th (premium) episode → the free user's count stays 2, a premium watcher's count reaches 3 → AC-4
- [ ] A watcher whose last view of the series is 200 days old → nothing → AC-4
- [ ] A premium watcher whose `push_counters` for today is already 3 → notification in the inbox with `pushStatus: skipped`, `skipReason: cap` → AC-8
- [ ] A `done` job set back to `pending` → after the scheduler, still one notification with the same count → AC-14
- [ ] A pending notification created 25 hours ago → `failed` / `stale`; a pending one for a user with no device → `skipped` / `no_device` → AC-11
- [ ] `GET /notifications` → total, unread, newest updated first, no `jobIds`/`userId` in items; read one → `readAt` set; another user's id or `nope` → `404`; read-all → `{ updated }`, unread 0; `limit=51` → `400` → AC-12
- [ ] Active premium user ending in 3 Lagos days, server started after 09:00 Lagos → one `premium_ending` `d3`; an inactive one → none; another start → still one → AC-6
- [ ] Password reset (spec 0007 flow) → every device of that account removed → AC-16
- [ ] Adding episodes answers `201` and only inserts `notification_jobs` rows → AC-18
- [ ] Logs carry no `@` address and no full token except inside `[push:dev]` lines → security model
- [ ] Credited KkiaPay webhook → one `payment_succeeded` with the new end date, a retried webhook adds nothing; a failed verified transaction with a pending checkout → one `payment_failed` → AC-7 (needs KkiaPay sandbox keys)
- [ ] A Cloudflare video reaching ready on an episode with no video → one job; a replacement video → no job → AC-4 (needs Stream active)
- [ ] An episode added at 23:00 Lagos → notification `sendAfter` = next 07:00 Lagos, pushed then and counted that day; an account notification at 23:00 → pushed right away → AC-9 (run at night)

## Commands (config and real delivery)
- [ ] `NODE_ENV=staging`, no Firebase key → boot warning `pushes are disabled`, `/notifications/test` → `503 PUSH_UNAVAILABLE`, pushes stay `pending` then go `stale` → AC-17
- [ ] With a real Firebase project, the service account in `FIREBASE_SERVICE_ACCOUNT_BASE64`, and the app installed on a phone: test push arrives; a new episode arrives with the right title, opens the series on tap, iOS badge = unread → AC-10
- [ ] Uninstall the app, trigger a push → the device row is deleted (unregistered token) → AC-11
- [ ] `npm run docs:openapi` lists the six `/notifications` routes → wrap up

## Value sourcing checks
- [ ] Recipients of `new_episodes` come from `watch_histories.episodes` (`seriesId` as a string, `lastWatchedAt` within 90 days)
- [ ] Access: free episode → everyone; premium episode → `hasPremiumAccess` only (admins included)
- [ ] `new_series` recipients: top 3 categories by distinct watched series; the category named in the body is the first of the user's top 3 present in the series
- [ ] `data.count` equals the size of `jobIds`
- [ ] Lagos day and quiet hours: `lagos-time.ts` gives 22:30 Lagos → next day 07:00; 06:59 → same day 07:00; 15:00 → now
- [ ] Premium reminder range: the UTC bounds of the Lagos day today + 3
- [ ] Payment success end date = `subscription.endDate` after the credit (re read on a retried webhook)
- [ ] Payment failure user = `PendingCheckout` with the transaction's `partnerId`, still unconsumed afterwards
- [ ] Badge and inbox `unread` = notifications with `readAt: null`

## Acceptance criteria coverage
- AC-1 devices · AC-2 delete · AC-3 preferences · AC-4 new episodes, grouping, access, recency, Stream hook · AC-5 announcement · AC-6 premium · AC-7 payments · AC-8 cap · AC-9 quiet hours · AC-10 payload, badge · AC-11 stale, no device, dead tokens · AC-12 inbox · AC-13 preferences off · AC-14 idempotence · AC-15 test route · AC-16 reset purge · AC-17 no credentials · AC-18 hooks never block
