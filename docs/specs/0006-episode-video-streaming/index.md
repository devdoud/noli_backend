# 0006. Episode video upload and streaming

**Date**: 2026-10-01
**Status**: In Progress

## Summary

This lets an admin give an episode a real video, either by uploading the file or by importing it from an existing link, instead of pasting a `videoUrl` hosted somewhere else. Videos are stored and encoded by Cloudflare Stream (a managed video service): it cuts each video into several qualities so the app's player switches between them as the network changes (adaptive streaming, HLS). Every playback link is signed and expires a while after the episode would end, so a shared link stops working, which closes today's gap where anyone with the URL could watch a premium episode. Episodes stay hidden from viewers until their video is ready, and old pasted links keep working until they are moved.

## Requirements

**User stories**:
- As an admin, I want to upload an episode's video file (even several hundred MB, over a weak connection) so that it plays in the app without me hosting it elsewhere.
- As an admin, I want to import a video from an existing public link so that I can move the videos I host today without downloading and uploading them again.
- As an admin, I want to replace an episode's video without the episode breaking for viewers in the meantime.
- As a viewer on mobile data, I want the video quality to adapt to my connection so that playback doesn't keep buffering.
- As the business, I want premium playback links to expire so that sharing a link doesn't give premium content away.

**Acceptance criteria** (the contract):
- **AC-1**: An admin calls `POST /series/:id/episodes/:seasonNumber/:episodeNumber/video/upload` with `{ uploadLength }` (the file size in bytes, 1 to 30 GB) → `201` with `{ method, uploadUrl, uid, expiresAt }`: `method: 'post'` (a one time URL for a single form POST) when the file is at most 200 MB, `method: 'tus'` (a resumable upload URL) above that. The episode's `pendingStreamUid` is set, `pendingStatus` is `awaiting_upload`, and `pendingExpiresAt` equals the returned `expiresAt`: 5 h 55 min after the request for a basic upload, and the longest lifetime Cloudflare allows (up to the same 5 h 55 min) for a resumable one. The upload refuses a video longer than 3 hours.
- **AC-2**: An admin calls `POST /series/:id/episodes/:seasonNumber/:episodeNumber/video/import` with `{ url }` (a public `https` link) → `201` with `{ uid, pendingStatus: 'processing' }`; Cloudflare downloads the file itself. A link Cloudflare cannot fetch ends later as `pendingStatus: error`, not as an immediate `400`.
- **AC-3**: When Cloudflare reports the pending video's state as `ready` (signed webhook, or the admin refresh), the episode switches to it in one atomic write keyed by that uid: `streamUid` = the uid, `streamDuration` = Cloudflare's duration (if it is ≤ 0, the episode's `duration` is used instead), all `pending*` fields cleared, a pasted `videoUrl` cleared (no rollback to it afterwards). The previous `streamUid`, if any, is then deleted from Cloudflare (best effort, logged on failure). `readyToStream` alone, while the state is still processing, does not switch.
- **AC-4**: While a replacement is pending, the episode keeps playing its current video. If processing fails, `pendingStatus` becomes `error` with Cloudflare's code and message in `pendingError`, and the current video (if any) keeps playing.
- **AC-5**: `POST /webhooks/cloudflare-stream` accepts only requests whose `Webhook-Signature` verifies against the raw body with the webhook secret (any of the listed `sig1` values, compared in constant time) and whose timestamp is under 5 minutes old; anything else → `401` and no change. Repeated deliveries are harmless (same result, `200`). An event whose `meta.env` is not this environment → `200`, ignored. An event for a uid not yet known is looked up again for a few seconds (the write that saves a new pending uid may still be in flight); still unknown → `200`, logged, no change (the refresh route repairs it).
- **AC-6**: An admin calls `POST /series/:id/episodes/:seasonNumber/:episodeNumber/video/refresh` → the API reads the pending video's state from Cloudflare and applies the same transition as the webhook (`ready` → AC-3, `error` → AC-4, still uploading or encoding → `processing`), expires an unused upload link (AC-16), then returns the admin view of the episode.
- **AC-7**: `GET /series/:id/episodes/:seasonNumber/:episodeNumber/play` (signed in, gating of spec 0002 unchanged) returns `{ seriesId, seasonNumber, episodeNumber, title, duration, videoUrl, type, expiresAt }`. For a Cloudflare video: `type: 'hls'`, `videoUrl` = `https://customer-<code>.cloudflarestream.com/<signed token>/manifest/video.m3u8`, and the token expires at now + 2 × L + 1 hour, where L = the larger of `streamDuration` and `duration` (seconds). For an episode with only a pasted link: `type: 'direct'`, `videoUrl` = the pasted link, `expiresAt: null` (unchanged behaviour, unprotected). The app is expected to call `/play` again when the player gets a `401`/`403` from the manifest, or when resuming later.
- **AC-8**: Every Cloudflare video the API creates has `requireSignedURLs: true`; fetching its manifest without a valid token, or with an expired one, fails at Cloudflare.
- **AC-9**: Viewers only see playable episodes (an episode is playable when it has a `streamUid` or a pasted `videoUrl`). This applies to the only viewer routes that return episodes: `GET /series/:id` (its `episodes` array, and a `totalEpisodes` equal to the playable count), `GET /series/:id/episodes` (its list and its `total`), and `/play` (an unplayable episode → `404`, before any premium check). The free teaser of spec 0002 is computed over playable episodes only, in (season, episode) order, so an episode still processing never takes a free slot. Series lists (all, trending, search, categories, recommendations) are unchanged: they carry no episodes, and a series with no playable episode still appears there.
- **AC-10**: `GET /series/:id/admin` (admin only) returns `{ message, series }`, the series shaped like `GET /series/:id` (categories populated, no `videoUrl` anywhere) but with every episode, playable or not, each carrying `isFree` (over playable episodes, `false` for an unplayable one), `thumbnail`, and `video: { status, streamUid, pendingStreamUid, pendingStatus, pendingError, pendingExpiresAt, hasPastedUrl }`. `status` is `ready` when a Cloudflare video plays (even if a replacement is pending or failed, shown by `pendingStatus`), else `pending` while one is awaited or processing, `error` when the only video failed, `legacy` for a pasted link only, `none` otherwise. Admin write routes on episodes (create, edit, delete, thumbnail, video routes) answer with this same admin shape, so a freshly created episode without video is visible in the response.
- **AC-11**: Requesting a new upload or import while one is pending replaces it: the previous pending video is deleted from Cloudflare (best effort) and the new one becomes pending. Two simultaneous requests leave exactly one pending video (the loser's Cloudflare video is deleted and it answers `409`).
- **AC-12**: `DELETE /series/:id/episodes/:seasonNumber/:episodeNumber/video` (admin) clears `streamUid`, every `pending*` field, and a pasted `videoUrl` in the database first, then deletes the current and pending videos from Cloudflare (best effort); the episode becomes unplayable and disappears for viewers. On an episode with no video → `200`, nothing to do.
- **AC-13**: Deleting an episode or a series (spec 0004) first deletes every Cloudflare video it references (current and pending; a Cloudflare `404` counts as done), then removes the episode or series as today. A Cloudflare failure is logged and never fails the delete; because the videos go first, a retried delete still knows their ids.
- **AC-14**: Video routes: no token → `401`, non admin → `403` (checked first in the handler, before any lookup), unknown or malformed series id → `404`, unknown episode → `404`, non integer season or episode → `400`, `uploadLength` missing, not an integer, below 1, or above 32,212,254,720 (30 GB) → `400`, an import `url` that is not `https` → `400`; more than 10 image or video calls by the same user in 10 minutes → `429` (the shared limit of spec 0005). Creating an episode no longer requires `videoUrl`, and `PATCH` on an episode no longer accepts `videoUrl` (moving a video goes through import).
- **AC-15**: Missing Cloudflare variables never stop the boot (one warning listing what is missing) and gate per feature: upload, import, refresh, and the Cloudflare part of `DELETE .../video` need the account id and API token (else `503`); `/play` for a Cloudflare video needs the customer code, signing key id, and signing key (else `503`), while `/play` for a pasted link always works; the webhook needs its secret (else `503`).
- **AC-16**: An upload link that was never used is expired: when the admin view or refresh sees `pendingStatus: awaiting_upload` with `pendingExpiresAt` in the past, it sets `pendingStatus: error`, `pendingError: 'upload_expired'`, and deletes that uid at Cloudflare (best effort).

## Decision

**Chosen option**: Option 2: Cloudflare Stream with direct uploads from the admin's machine, signed HLS playback, and a signed webhook for processing state.

The API never touches video bytes: it asks Cloudflare for a one time upload link (or an import), tracks each episode's video in two slots (the current playable one and a pending one), learns about processing through a signed webhook (with an admin refresh as a fallback), and hands viewers a signed HLS link from `/play` that expires a while after the episode would end.

**Implementation skills**: `cloudflare` (`cloudflare/skills`, `.agents/skills/cloudflare/`, see its `references/stream/`) · `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.agents/skills/nestjs-best-practices/`) · `mongodb-query-optimizer` (`mongodb/agent-skills`, `.agents/skills/mongodb-query-optimizer/`)

## Feature design

**Stack additions**: none. Cloudflare's REST API is called with Node 22's built in `fetch`; playback tokens are RS256 JWTs signed with `@nestjs/jwt` (already installed). `src/main.ts` becomes `NestFactory.create(AppModule, { rawBody: true })` so the webhook can verify the exact bytes Cloudflare signed. This keeps a copy of JSON and urlencoded bodies in `req.rawBody`; it changes nothing for the KkiaPay webhook (it checks a header secret) or for Multer routes (multipart skips the body parser). HTTP tests that boot the app pass the same option to `createNestApplication`.

**Module layout**: a new `src/video/` module, imported by `SeriesModule`; it also imports `MediaModule` to reuse `UploadThrottlerGuard` and the `ImageRoute` guard pair (the limit is shared with image routes).
- `stream.client.ts` (`StreamClient`): the only place that calls Cloudflare. Reads the six variables from `ConfigService` once; `canManage()` (account id + token), `canPlay()` (customer code + key id + key), `canReceiveWebhooks()` (secret); logs one warning at boot listing what is missing. Methods: `createDirectUpload`, `createTusUpload`, `copyFromUrl`, `getVideo`, `deleteVideo` (never throws; `404` counts as deleted; logs other failures), `signPlaybackToken(uid, expiresAt)`, `manifestUrl(token)`. Base URL `https://api.cloudflare.com/client/v4/accounts/<CLOUDFLARE_ACCOUNT_ID>/stream`, header `Authorization: Bearer <CLOUDFLARE_STREAM_API_TOKEN>`, 30 second timeout per call. A non `success` answer or a network failure → `ServiceUnavailableException`; a Cloudflare `4xx` on `copyFromUrl` → `BadRequestException`.
- Token signing: its own `new JwtService({})` inside `StreamClient` (never the AuthModule instance, which is configured with the app's HS256 `JWT_SECRET` and `expiresIn`). Each call: `sign({ sub: uid, kid, exp, nbf: now - 60 }, { algorithm: 'RS256', privateKey, keyid: kid, noTimestamp: true })`, with no `expiresIn` option (the `exp` is in the payload). `privateKey` = base64 decoded `CLOUDFLARE_STREAM_SIGNING_KEY_PEM` (Cloudflare's key is a PKCS#1 `RSA PRIVATE KEY`, accepted as is).
- `stream-webhook.controller.ts`: `POST /webhooks/cloudflare-stream`, typed with `RawBodyRequest`, documented in Swagger like the billing webhook (summary in French, `@ApiExcludeEndpoint` not used).
- `stream-webhook.verifier.ts`: pure function `verifyStreamSignature(header, rawBody, secret, now)`: parse `time=` and every `sig1=`, reject when `time` is more than 300 s away from `now`, accept when any `sig1` equals HMAC SHA256 of `<time>.<raw body>` (`crypto.timingSafeEqual` on equal length buffers).
- `video-transitions.ts`: `applyStreamState(uid, video)` used by both the webhook and refresh, plus `expireUnusedUpload(episode)`.
- Series side: new methods in `SeriesService` (it owns episode writes), new routes in `SeriesController`, and the viewer filtering in `content-access.ts`.

**Data model sketch** (no new collection; the inline episodes array in `series.schema.ts` is what Mongoose uses, so every change goes there and in the `Episode` class):

| Field (on each episode) | Type | Notes |
|---|---|---|
| `videoUrl` | `String`, default `null` | **`required: true` removed** in both places. Pasted legacy link. `CreateEpisodeDto.videoUrl` becomes optional (still `@IsUrl` when given); `UpdateEpisodeDto.videoUrl` and its entry in `EDITABLE_EPISODE_FIELDS` are removed. |
| `streamUid` | `String`, default `null` | Cloudflare uid of the playing video. |
| `pendingStreamUid` | `String`, default `null` | Uploading or processing video. |
| `pendingStatus` | `String` enum `awaiting_upload`, `processing`, `error`, default `null` | |
| `pendingError` | `String`, default `null` | `<errorReasonCode>: <errorReasonText>`, or `upload_expired`. |
| `pendingExpiresAt` | `Date`, default `null` | When an unused upload link dies (uploads only). |
| `streamDuration` | `Number`, default `null` | Seconds, taken from Cloudflare at `ready` only. |

`PlayableEpisode.videoUrl` stays a `string` (`/play` always returns one) and gains `type: 'hls' | 'direct'` and `expiresAt: Date | null`. New sparse indexes on `series`: `{ 'episodes.pendingStreamUid': 1 }` (webhook lookup) and `{ 'episodes.streamUid': 1 }` (repeat delivery check). Lean reads skip defaults, so every reader treats a missing field as `null`. No migration: existing episodes keep their pasted link and stay playable (`legacy`).

**Viewer filtering** (`content-access.ts`):
- `isPlayable(ep)` = `Boolean(ep.streamUid || ep.videoUrl)`.
- `isEpisodeFree` and `canPlay` compute the index over `sortEpisodes(episodes.filter(isPlayable))`; an unplayable episode is never free.
- `toPublicEpisodes(series, { playableOnly })`: with `playableOnly: true` it filters first, then computes `isFree` by index; without it (admin shapes) it keeps every episode and computes `isFree` over the playable ones. It strips `videoUrl` and every internal video field either way.
- `toPublicSeries(series, { playableOnly })`: passes the option through and, when `playableOnly`, sets `totalEpisodes` to the playable count.
- `GET /series/:id` and `GET /series/:id/episodes` use `playableOnly: true` (`getEpisodes` filters before paginating and returns the playable count as `total`). Every admin write response and `GET /series/:id/admin` use a new `toAdminSeries(series)` = `toPublicSeries` without the filter plus the `video` object per episode (AC-10).
- `getPlayableEpisode`: find the episode in the sorted full list; missing or not playable → `404`; then the unchanged gating; then the play response.
- Consequence to communicate: when an earlier episode becomes ready, the free boundary moves, so an episode that was free can become paid.

**State transitions** (the pending slot; the current slot only changes on `ready`):
- `none` → request upload → `awaiting_upload` (uid A, `pendingExpiresAt`)
- `none` → import → `processing` (uid A)
- `awaiting_upload` → refresh sees Cloudflare uploading or encoding → `processing` (Cloudflare webhooks only fire on `ready` and `error`, so `processing` is only ever set by refresh or import)
- `awaiting_upload` or `processing` → Cloudflare `state: ready` → current = A, pending cleared, old current deleted
- `awaiting_upload` or `processing` → Cloudflare `state: error` → `error`
- `awaiting_upload` past `pendingExpiresAt` (seen by the admin view or refresh) → `error` (`upload_expired`), A deleted
- any pending state → new upload or import (uid B) → pending = B, A deleted
- any → `DELETE .../video` → everything cleared, both uids deleted

**Cloudflare calls** (paths confirmed in the Stream API reference unless marked; confirm the marked ones against the official docs listed in the Cloudflare skill before building):
- Basic direct upload: `POST /stream/direct_upload` with `{ maxDurationSeconds: 10800, expiry: <now + 5 h 55 min, ISO>, requireSignedURLs: true, meta: { name, seriesId, seasonNumber, episodeNumber, env } }` → `result.uploadURL`, `result.uid`.
- Resumable (TUS) direct upload: `POST /stream?direct_user=true` with headers `Tus-Resumable: 1.0.0`, `Upload-Length: <uploadLength>`, `Upload-Metadata` (TUS format, base64 values) carrying `maxDurationSeconds 10800`, `requiresignedurls`, `expiry`, `name` → `201`, upload URL in `Location`, uid in `stream-media-id`. **Confirm at build**: the exact metadata key names and case, and the maximum `expiry` honoured for resumable links (Cloudflare may default to 1 hour); `expiresAt` returned to the admin is whatever was actually sent and accepted. The admin's TUS client must send chunks in multiples of 256 KiB, at least 5 MiB except the last (documented in the route description).
- Import: `POST /stream/copy` with `{ url, requireSignedURLs: true, meta }` → `result.uid`.
- Read state: `GET /stream/<uid>` → `result.status.state` (`pendingupload`, `downloading`, `queued`, `inprogress`, `ready`, `error`; `live-inprogress` is ignored), `result.readyToStream`, `result.duration`, `result.status.errorReasonCode`, `result.status.errorReasonText`, `result.meta` (**confirm at build**).
- Delete: `DELETE /stream/<uid>` (**confirm at build**); `404` counts as already deleted.
- Webhook: one notification URL per Cloudflare account, registered with `PUT /stream/webhook` `{ notificationUrl }`, which returns the secret. Payload = the video object (as in `GET`); header `Webhook-Signature: time=<unix>,sig1=<hex>`; fires on `ready` and `error` (**confirm at build**).
- Signed token: RS256 JWT, header `kid`, claims `sub` (uid), `kid`, `exp`, `nbf`; no `downloadable` claim (downloads are feature 10).

**Upload request flow** (`POST .../video/upload` and `.../video/import`):
1. `JwtAuthGuard` (`401`), then `UploadThrottlerGuard` (`429`), then pipes (body DTO and `ParseIntPipe`, `400`), then in the handler: admin check (`403`) first, `isValidObjectId` (`404`), load the episode (`404`), `canManage()` (`503`).
2. Remember `oldPending` (the episode's current `pendingStreamUid`, may be `null`).
3. Create the Cloudflare upload or copy with `meta.env` = this environment (`503`/`400` on failure, nothing saved).
4. Compare and set: `findOneAndUpdate({ _id, episodes: { $elemMatch: { seasonNumber, episodeNumber, pendingStreamUid: oldPending } } }, { $set: { 'episodes.$.pendingStreamUid': uid, 'episodes.$.pendingStatus': 'awaiting_upload' | 'processing', 'episodes.$.pendingError': null, 'episodes.$.pendingExpiresAt': expiresAt | null } })`. A `null` `oldPending` also matches a missing field.
5. No match → delete the new Cloudflare video, then `404` (episode gone) or `409` (another request won).
6. Match → if `oldPending`, delete it at Cloudflare (best effort). Return `201`. If `oldPending` had just become ready but was not applied yet, it is still replaced (the newest request wins).

**Transition** (`applyStreamState(uid, video)`, idempotent, shared by webhook and refresh):
- `video.meta.env` set and different from this environment → no change.
- `state === 'ready'`: one `findOneAndUpdate({ 'episodes.pendingStreamUid': uid }, { $set: { 'episodes.$[e].streamUid': uid, 'episodes.$[e].streamDuration': d, 'episodes.$[e].pendingStreamUid': null, 'episodes.$[e].pendingStatus': null, 'episodes.$[e].pendingError': null, 'episodes.$[e].pendingExpiresAt': null, 'episodes.$[e].videoUrl': null } }, { arrayFilters: [{ 'e.pendingStreamUid': uid }], returnDocument: 'before' })`, where `d = round(video.duration)` if > 0, else that episode's `duration`. A `null` pre-image → check `{ 'episodes.streamUid': uid }`: found → repeat delivery, no change; not found → unknown (webhook: retry the lookup up to 3 times, 2 seconds apart, then log). Otherwise read the old `streamUid` from the pre-image's matching episode and delete it at Cloudflare if set.
- `state === 'error'`: same filter, `$set` `pendingStatus: 'error'`, `pendingError: '<code>: <text>'`.
- other states (refresh only): `$set` `pendingStatus: 'processing'` for `downloading`, `queued`, `inprogress`; unchanged for `pendingupload`.
- These writes keep normal timestamps (unlike the history cascades of spec 0004): a video change is a real change to the series.

**Play** (AC-7): `canPlay()` else `503` (Cloudflare videos only); `L = max(streamDuration ?? 0, duration)`; `expiresAt = now + 2 × L + 3600 s`; `videoUrl = manifestUrl(signPlaybackToken(streamUid, expiresAt))`.

**Cascades** (AC-13): `deleteEpisode` first reads the episode (`streamUid`, `pendingStreamUid`), deletes both at Cloudflare, then runs today's `$pull` (with the existing history and image cleanups); on the retry the episode may already be gone, in which case there is nothing left to delete. `deleteSeries` first reads the series' episodes, deletes every referenced uid at Cloudflare, then `findByIdAndDelete` and today's cleanups. `DELETE .../video` (AC-12) is the opposite order: database first (so a deleted video is never referenced), then Cloudflare.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/series/:id/episodes/:s/:e/video/upload` | POST | `uploadLength: int` (1 to 30 GB) | `{ method: 'post' \| 'tus', uploadUrl, uid, expiresAt }` | admin | 400, 403, 404, 409, 429, 503 |
| `/series/:id/episodes/:s/:e/video/import` | POST | `url: https URL` | `{ uid, pendingStatus }` | admin | 400, 403, 404, 409, 429, 503 |
| `/series/:id/episodes/:s/:e/video/refresh` | POST | none | `{ message, series }` (admin shape) | admin | 403, 404, 429, 503 |
| `/series/:id/episodes/:s/:e/video` | DELETE | none | `{ message, series }` (admin shape) | admin | 403, 404, 429 |
| `/series/:id/admin` | GET | none | `{ message, series }` (admin shape, every episode) | admin | 403, 404 |
| `/series/:id/episodes/:s/:e/play` | GET | none | `{ videoUrl, type, expiresAt, title, duration, ... }` | signed in (gating of spec 0002) | 403 `PREMIUM_REQUIRED`, 404, 503 |
| `/webhooks/cloudflare-stream` | POST | Cloudflare video JSON + `Webhook-Signature` | `{ received: true }` | signature | 401, 503 |
| `/series/:id/episodes` | POST | `videoUrl` now optional | admin shape | admin | unchanged |
| `/series/:id/episodes/:s/:e` | PATCH | `videoUrl` no longer accepted (stripped by the whitelist) | admin shape | admin | unchanged |

All routes carry Swagger decorators with French summaries (for example "Obtenir un lien d'envoi vidéo pour un épisode"); the upload route description explains `post` vs `tus` and the TUS chunk rules.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Upload request | upload method | `uploadLength` input: ≤ 209,715,200 bytes → `post`, else `tus` |
| Upload request | max duration | constant 10,800 s (decided here) |
| Upload request | link expiry | now + 5 h 55 min (basic), or Cloudflare's accepted maximum (TUS, confirm at build); stored as `pendingExpiresAt`, returned as `expiresAt` |
| Upload / import | uid, upload URL | Cloudflare response (`result.uid`, `result.uploadURL`, or the `stream-media-id` and `Location` headers) |
| Upload / import | meta | series title + episode title (`name`), path params, `env` = cleaned `NODE_ENV` (same as spec 0005's `envSegment`) |
| Import | source file | `url` input |
| Transition | new state | webhook body, or `GET /stream/<uid>` on refresh |
| Transition | `streamDuration` | Cloudflare `duration` at `ready`, rounded; if ≤ 0, the episode's `duration` |
| Transition | old video to delete | pre-image `streamUid` |
| Transition | `pendingError` | `status.errorReasonCode` + `status.errorReasonText`, or `upload_expired` |
| Expire unused upload | now vs `pendingExpiresAt` | server clock, checked by the admin view and refresh |
| Play | `videoUrl` (hls) | `https://customer-` + `CLOUDFLARE_STREAM_CUSTOMER_CODE` + `.cloudflarestream.com/` + token + `/manifest/video.m3u8` |
| Play | token `sub`, `kid`, `exp`, `nbf` | `streamUid`; `CLOUDFLARE_STREAM_SIGNING_KEY_ID`; now + 2 × max(`streamDuration`, `duration`) + 3,600 s; now − 60 s |
| Play | signing key | base64 decoded `CLOUDFLARE_STREAM_SIGNING_KEY_PEM` |
| Play | `videoUrl` (direct) | the pasted `videoUrl` |
| Webhook | trust | `Webhook-Signature` header + `req.rawBody` + `CLOUDFLARE_STREAM_WEBHOOK_SECRET`; 300 s window |
| Webhook | is this environment's video | `meta.env` vs cleaned `NODE_ENV` |
| Viewer routes | which episodes, `total`, `totalEpisodes` | `isPlayable(ep)` |
| Teaser | free episodes | first `freeEpisodeCount` playable episodes in (season, episode) order |
| Admin view | `video.status` | derived per AC-10 from `streamUid`, `pendingStatus`, `videoUrl` |
| Rate limit | counter | the shared `upload` throttler of spec 0005 (per user, 10 per 10 minutes) |

**Key invariants**:
- An episode plays from `streamUid` if set, else from its pasted `videoUrl`, else not at all.
- `streamUid` only ever receives a uid that Cloudflare reported in `state: ready`.
- At most one pending video per episode; a replaced or expired pending video is deleted at Cloudflare.
- Every video the API creates at Cloudflare has `requireSignedURLs: true`, `maxDurationSeconds` ≤ 10,800, and `meta.env`.
- No response except `/play` contains a video link, and `/play` only after the spec 0002 gating check.
- The signing key, API token, and webhook secret never appear in responses or logs.

**Security model**:
- Upload, import, refresh, video delete, and the admin series view: `JwtAuthGuard` + the inline admin check (first thing in the handler), like every admin route (root `AGENTS.md`), plus the shared per user rate limit on the video write routes.
- `/play`: signed in, then the unchanged spec 0002 gating; the signed link is the only key to the video and it dies at `expiresAt`.
- Webhook: public by necessity, trusted only through the HMAC signature on the raw body with a 5 minute replay window; it can only move a known pending uid forward, never attach an arbitrary uid to an episode.
- Import accepts only `https` URLs, and Cloudflare (not your server) fetches them, so the API never makes requests to addresses an admin supplies.
- Upload links are single purpose (one video, under 6 hours, at most 3 hours of content).

**Configuration required**:
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account that holds Stream.
- `CLOUDFLARE_STREAM_API_TOKEN`: an API token limited to Stream (Stream: Edit).
- `CLOUDFLARE_STREAM_CUSTOMER_CODE`: the code in your playback domain `customer-<code>.cloudflarestream.com` (shown in the Stream dashboard).
- `CLOUDFLARE_STREAM_SIGNING_KEY_ID` and `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`: a signing key created once through the Stream API; the PEM is stored base64 encoded. A script `npm run stream:create-signing-key` creates it and prints both values.
- `CLOUDFLARE_STREAM_WEBHOOK_SECRET`: returned when the webhook URL is registered. Cloudflare allows **one** webhook URL per account, so register it only for production with `npm run stream:register-webhook -- <public url>` (it prints the secret); in development, leave the secret empty and use the refresh route (or use a separate Cloudflare account per environment).
- Prerequisite: a Cloudflare account with Stream enabled (usage based: about $5 per 1,000 minutes stored per month and $1 per 1,000 minutes watched, as checked on 2026-10-01; check again before launch).

**Critical test scenarios**:
- Happy path: upload request for a 150 MB file → `method: 'post'`; webhook `ready` for that uid → episode switches, old video deleted; `/play` returns a signed `.m3u8` link whose `exp` is now + 2 × L + 1 h, verifies **AC-1**, **AC-3**, **AC-7**
- Large file: `uploadLength` 900 MB → `method: 'tus'`, verifies **AC-1**
- Replacement: a playing episode gets a new upload; while pending, `/play` still serves the old uid; on `ready` the old uid is deleted, verifies **AC-3**, **AC-4**
- Failure: webhook `error` → `pendingStatus: error` with code and text, current video untouched, verifies **AC-4**
- Webhook security: wrong signature, missing header, a 10 minute old timestamp → `401`; the same valid event twice → one transition; another environment's event → ignored, verifies **AC-5**
- Early webhook: an event arriving before the pending uid is saved is found on a retry, verifies **AC-5**
- Unused link: `awaiting_upload` past `pendingExpiresAt` → `error: upload_expired` on refresh, uid deleted, verifies **AC-16**
- Race: two upload requests at once → one `201`, one `409`, Cloudflare holds one pending video, verifies **AC-11**
- Teaser: a premium series with E1 processing, E2 and E3 ready, `freeEpisodeCount: 1` → E1 hidden, E2 free, E3 paid, `total` 2, verifies **AC-9**
- Admin shape: creating an episode without video returns it with `video.status: 'none'`, verifies **AC-10**
- Auth: viewer on upload → `403`; `/play` on an unplayable episode → `404`; `PATCH` with `videoUrl` leaves it untouched, verifies **AC-9**, **AC-14**
- Cascade: deleting an episode deletes its Cloudflare videos before the `$pull`, and a retry still works, verifies **AC-13**
- Outage: variables unset → boot with one warning, upload → `503`, `/play` on a legacy episode still works, verifies **AC-15**

## Build plan

Tracer Bullet: the first task carries one uploaded video all the way from upload link to signed playback, then the rest thickens around it.

1. [x] Thin thread end to end: the schema fields in the inline array and `Episode` class (`videoUrl` no longer required), the two sparse indexes; `src/video/` with `StreamClient` (`canManage`, `canPlay`, `createDirectUpload`, `getVideo`, `deleteVideo`, `signPlaybackToken` with its own `JwtService`, `manifestUrl`) and `applyStreamState` for `ready`; `POST .../video/upload` (basic POST only, admin check first, shared throttler) and `POST .../video/refresh`; `/play` returning the signed HLS link with `type` and `expiresAt`; the `stream:create-signing-key` script; unit tests with a mocked `StreamClient`, satisfies **AC-1**, **AC-3**, **AC-6**, **AC-7**, **AC-8**, **AC-15**
2. [x] Webhook: `rawBody: true` in `main.ts` (and in the HTTP test bootstraps), the signature verifier, `POST /webhooks/cloudflare-stream` with the environment check, repeat and early delivery handling, the `error` transition, the `stream:register-webhook` script, satisfies **AC-3**, **AC-4**, **AC-5**
3. [x] Thicken uploads: the TUS path above 200 MB, import from URL, pending replacement and the `409` race, unused link expiry, satisfies **AC-1**, **AC-2**, **AC-11**, **AC-16**
4. [x] Viewer visibility and admin shape: `isPlayable`, the `playableOnly` option and playable counts in `GET /series/:id` and `GET /series/:id/episodes`, the teaser helpers over playable episodes, `/play` `404` for unplayable; `toAdminSeries` on every admin write response and `GET /series/:id/admin`; `DELETE .../video`; `CreateEpisodeDto.videoUrl` optional and `videoUrl` removed from `PATCH`; the `400`/`403`/`404`/`429` paths, satisfies **AC-9**, **AC-10**, **AC-12**, **AC-14**
5. [x] Cascades: Cloudflare deletes before the database in `deleteEpisode` and `deleteSeries`, satisfies **AC-13**
6. Docs and live check: Swagger on every route, `npm run docs:openapi`, the six variables in `.env`, then every AC live against real Cloudflare (a short test video, a large one through TUS, an import, a replacement, a failure, the webhook through a tunnel or the refresh route) and clean up (database and Cloudflare videos), satisfies **AC-1** to **AC-16**

## Consequences

**Positive**:
- Admins can publish real episodes without hosting video anywhere else, and move the old ones with one import call each.
- Viewers get adaptive quality, which matters on mobile networks.
- Premium gating finally holds: a shared link dies a while after the episode would end.
- The API never carries video bytes, so server memory and bandwidth stay small.

**Negative / tradeoffs**:
- A paid dependency billed per minute stored and watched; costs grow with the catalog and audience (no free tier).
- The mobile app must play HLS (`.m3u8`), and call `/play` again when the player gets a `401`/`403` or resumes after a long break (a link lives 2 × the episode length + 1 hour).
- Admins now need a tool that can send a file to a URL (Postman, `curl`, or a TUS client for big files) until an admin dashboard exists; Swagger alone can't do the direct upload.
- One webhook URL per Cloudflare account: development relies on the refresh route (or a second account).
- Hiding unplayable episodes changes what viewers see and moves the free teaser boundary when an earlier episode becomes ready (an episode can switch from free to paid).
- Legacy pasted links stay unprotected until each episode is moved, and a moved episode's pasted link is gone for good.
- Deleting videos before the database row means a failed database delete leaves an episode whose video is gone (unplayable until the delete is retried).

**Neutral**:
- `videoUrl` stays in the `/play` response, now pointing at an HLS manifest for moved episodes.
- `PATCH` on an episode no longer edits `videoUrl`; a pasted link is only set on creation.
- Three new admin write routes, one admin read route, one public webhook route; `rawBody` enabled globally.
- One new agent skill installed (`.agents/skills/cloudflare/`).

## Follow-up

- [ ] The `cloudflare` agent skill is installed but not yet in `AGENTS.md`; its Stream conventions are area specific, so they belong in a nested `src/video/AGENTS.md` with a pointer from the root `## Agent skills` section (`/sync` or `/audit` owns that write).
- [ ] Record the optional official Cloudflare documentation MCP server on the root `MCP servers:` line; connect it yourself, it lets the agent check current Stream docs live.
- [ ] Before building, confirm against the official Stream docs (listed in the Cloudflare skill) everything marked "confirm at build": the TUS metadata names and maximum expiry, the `GET`/`DELETE` paths and status fields, the webhook registration, payload, and `Webhook-Signature` format (`/develop` Step 2.6 doc check).
- [ ] Offline Downloads (feature 10) should build on this: enable MP4 downloads per video and add the `downloadable` claim only for premium users.
- [ ] A weekly orphan sweep (list Cloudflare videos, delete uids no episode references, using `meta`) if logs show failed deletes.
- [ ] Tell the mobile team: `/play` now returns HLS links with `type` and `expiresAt` (refetch on `401`/`403` or resume), episodes without a ready video no longer appear, and `totalEpisodes`/`total` count playable episodes.
- [ ] An admin dashboard (deferred in the scope) would make direct and resumable uploads usable without Postman or `curl`.
- [ ] Cloudflare's presence in West Africa could not be confirmed; measure playback start time from the target countries during the live check.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
