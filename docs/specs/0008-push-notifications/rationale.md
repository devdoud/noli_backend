# 0008. Push notifications: rationale

## Context

Noli is a series app: people come back when a new episode lands. Today nothing tells them; they must open the app and look. The mobile app is Flutter (Android and iOS) and has no push setup yet, so this decision also sets what the app must integrate.

The events worth announcing happen in very different places: an admin adding an episode (an HTTP request), a Cloudflare webhook marking a video ready (spec 0006), a KkiaPay webhook crediting or rejecting a payment (spec 0001), and the passing of time (premium ending). A popular series can have thousands of watchers, so one admin action can mean thousands of messages; doing that inside the admin request would make it slow and fragile, and a restart would lose messages in flight.

Notifications are a known way to lose users when overdone: several pushes a day, or one at 2 a.m., and people turn them off for good at the phone level, which the app can never undo. Many users are on prepaid mobile data in francophone West Africa, with time zones UTC+0 and UTC+1.

Users have no "follow" action yet (feature 8, the watchlist, is planned), so "series I care about" has to come from what exists: the watch history.

## Options considered

### Option 1: Send directly in each request, no queue

Each event calls FCM right where it happens.

**Pros**:
- Least code, no scheduler work.

**Cons**:
- An episode with thousands of watchers makes the admin request slow and can time out.
- A crash or restart loses the messages; FCM outages fail the business action or drop silently.
- Grouping, caps, and quiet hours have nowhere to live.

### Option 2: FCM via `firebase-admin`, MongoDB queue, scheduler, inbox as the log (chosen)

Events write a small job row; the existing `@nestjs/schedule` runs a one minute cron that fans jobs out into per user notifications and pushes them.

**Pros**:
- Durable and retryable with the database and scheduler the project already runs; no new infrastructure.
- One place for preferences, grouping, the daily cap, quiet hours, and idempotence.
- The inbox is the same collection as the dedupe log, so it costs little.
- FCM is free and is the standard for Flutter.

**Cons**:
- Up to a minute of delay.
- Polling MongoDB every minute, and fan out aggregations that will need precomputation at large scale.

### Option 3: A hosted engagement platform (OneSignal or similar)

Send events to a third party that stores tokens, segments users, and sends.

**Pros**:
- Dashboard, campaigns, and analytics ready made.

**Cons**:
- Another provider holding user device data; segment logic duplicated between it and the backend.
- Rules specific to Noli (watch history based targeting, Lagos day caps) are awkward to express there.
- Free tier limits and lock in.

### Option 4: A dedicated queue (Redis with BullMQ)

Same design as Option 2 with a real job queue.

**Pros**:
- Lower latency, built in retries, scales further.

**Cons**:
- A new piece of infrastructure (Redis) to host, pay for, and monitor, for a volume MongoDB handles easily today.

## Rationale

Option 2 fits the project's operational reality: one small team, MongoDB and a scheduler already running, and a budget that already pushed Cloudflare Stream on hold. A minute of delay is irrelevant for "a new episode is out", while durability and the anti spam rules matter a lot: each one maps to a field (`dedupeKey`, `sendAfter`, `pushStatus`) in a collection the inbox needed anyway. Option 1 fails on the first popular series; Option 4 is the natural step if volume ever demands it, and the queue's shape (claim, backoff, lock) ports to it directly.

FCM through the official `firebase-admin` SDK was the engineer's pick: it is the default for Flutter, free, covers iOS through the APNs key, and the SDK reports dead tokens precisely, which keeps the `devices` collection clean. Writing the OAuth signing by hand (the HTTP v1 alternative) saves a dependency but adds code where mistakes are costly.

Using watch history as the follow signal ships value now without new app screens; the watchlist will add an explicit signal later. The top 3 categories rule mirrors the "for me" recommendations, so what we announce matches what we recommend. Africa/Lagos as the day reference covers most of the audience exactly and shifts the day by one hour for the UTC+0 countries, which does not matter for a daily cap or quiet hours.
