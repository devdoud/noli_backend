# Verify: Episode video upload and streaming · spec 0006 · updated 2026-10-01

_Steps derived from spec 0006 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

_Live run on 2026-10-01 during `/develop`, with the `CLOUDFLARE_*` variables still empty: 25/25 checks passed against the real app and database (throwaway data, deleted afterwards). Steps marked "(live, no keys)" ran then; every step needing a real Cloudflare upload, webhook, or token still waits for the keys. Before that live run: The build ran 79 new automated tests (352 in total, all passing), including real HTTP for the webhook signature and the video routes, and an RS256 token verified with the matching public key._

## Setup

- A Cloudflare account with Stream enabled. In `.env`: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN` (permission Stream: Edit), `CLOUDFLARE_STREAM_CUSTOMER_CODE`; then `npm run stream:create-signing-key` and paste `CLOUDFLARE_STREAM_SIGNING_KEY_ID` / `CLOUDFLARE_STREAM_SIGNING_KEY_PEM`.
- For the webhook steps: a public HTTPS URL to the API (a tunnel, as for mobile testing), `npm run stream:register-webhook -- https://<tunnel host>`, and `CLOUDFLARE_STREAM_WEBHOOK_SECRET`. Without it, use the refresh route.
- An admin, a viewer without premium, a premium series `P` (`freeEpisodeCount: 1`) with episodes E1, E2, E3 created **without** `videoUrl`, and a free series `F` with one episode that has a pasted `videoUrl`.
- Test files: a short video (under 200 MB, a few minutes), a large one (over 200 MB) for the tus path, and a public `https` link to a video file.

## UI / manual (API calls)

- [ ] Admin `POST /series/P/episodes/1/1/video/upload` `{ uploadLength: <small file size> }` → `201`, `method: 'post'`, `uploadUrl`, `uid`, `expiresAt` about 5 h 55 min ahead; `GET /series/P/admin` shows E1 `video.status: 'pending'`, `pendingStatus: 'awaiting_upload'` → AC-1
- [ ] Send the small file to `uploadUrl` (multipart, field `file`); after processing, the webhook (or `POST .../video/refresh`) switches E1: `video.status: 'ready'`, `streamUid` = that uid → AC-3, AC-6
- [ ] Admin `POST /series/P/episodes/1/2/video/upload` `{ uploadLength: <large file size> }` → `method: 'tus'`; upload with a tus client (chunks multiple of 256 KiB, at least 5 MiB); E2 becomes ready → AC-1
- [ ] Admin `POST /series/P/episodes/1/3/video/import` `{ url: <public https link> }` → `201 { uid, pendingStatus: 'processing' }`; E3 becomes ready → AC-2
- [ ] Viewer `GET /series/P/episodes/1/1/play` → `type: 'hls'`, `videoUrl` = `https://customer-<code>.cloudflarestream.com/<token>/manifest/video.m3u8`, `expiresAt` = now + 2 × max(streamDuration, duration) + 1 h; the link plays in an HLS player (VLC, Safari, or the app) → AC-7
- [ ] The manifest URL with the uid instead of a token (`https://customer-<code>.cloudflarestream.com/<uid>/manifest/video.m3u8`) is refused by Cloudflare → AC-8
- [ ] Viewer `/play` on E2 (paid) → `403 PREMIUM_REQUIRED`; on `F`'s episode → `type: 'direct'`, the pasted link, `expiresAt: null` → AC-7
- [ ] Replace E1: a new upload while E1 plays; until processing ends, `/play` still serves the old uid; once ready, the old uid is gone from the Stream dashboard → AC-3, AC-4
- [ ] Make a replacement fail (for example `maxDurationSeconds` exceeded, or a corrupt file) → `pendingStatus: 'error'` with Cloudflare's code and text; E1 keeps playing → AC-4
- [ ] Send the same webhook delivery twice (replay it from the tunnel inspector within 5 minutes) → both `200`, one transition; change one byte of the body → `401`; replay after 5 minutes → `401` → AC-5
- [x] With an episode just created and still without video: viewer `GET /series/P` and `GET /series/P/episodes` don't show it, `total` and `totalEpisodes` count only playable episodes; viewer `/play` on it → `404`; the free teaser counts only playable episodes → AC-9 (live, no keys: also an episode gaining a Cloudflare video takes the free slot)
- [x] Admin `GET /series/P/admin` shows every episode with `video.status` (`ready`, `pending`, `error`, `legacy`, `none`) and no `videoUrl` → AC-10 (live, no keys: ready, legacy, none seen; viewer → 403)
- [ ] Two upload requests for the same episode at the same moment → one `201`, one `409`; the Stream dashboard holds exactly one pending video for it → AC-11
- [ ] Admin `DELETE /series/P/episodes/1/3/video` → E3 disappears for viewers, its video is gone from Stream; again → `200` → AC-12
- [ ] Delete episode E2, then series `P` → their videos are gone from the Stream dashboard → AC-13
- [ ] Viewer on any video route → `403`; no token → `401`; `uploadLength: 0` or above 30 GB → `400`; an `http://` import link → `400`; 11 image or video calls in 10 minutes → `429` → AC-14
- [x] Empty the six variables and restart: one warning, the API works, upload → `503`, `/play` on `F` still works, `/play` on a Cloudflare video → `503`, the webhook → `503` → AC-15 (live, no keys)
- [ ] Request an upload link and never use it; after `expiresAt` (or with the clock moved forward), `GET /series/P/admin` shows `pendingStatus: 'error'`, `pendingError: 'upload_expired'`, and the video is gone from Stream → AC-16

## Value sourcing checks

- [ ] Upload method comes from `uploadLength`: exactly 209,715,200 → `post`, one byte more → `tus`
- [ ] `meta.env` on the created videos (Stream dashboard or `GET /stream/<uid>`) equals the cleaned `NODE_ENV`; a webhook for a video with another `env` changes nothing
- [ ] `streamDuration` comes from Cloudflare at `ready` (compare with the dashboard duration)
- [ ] The token's `exp` comes from the longer of `streamDuration` and `duration`: edit the episode's `duration` to a large value and check `expiresAt` grows
- [x] `PATCH` on an episode with `videoUrl` leaves the video untouched (the field is stripped) (live, no keys)

## Commands

- [x] `npx tsc --noEmit -p tsconfig.json` → clean (2026-10-01)
- [x] `npx jest` → 352/352 passing, 79 new for spec 0006 (2026-10-01)
- [x] `npm run docs:openapi` → 47 paths, including the 6 video routes and `POST /webhooks/cloudflare-stream` (2026-10-01)

## Acceptance-criteria coverage

- AC-1 upload link · AC-2 import · AC-3 ready switch · AC-4 replacement and failure · AC-5 webhook trust · AC-6 refresh · AC-7 signed playback · AC-8 signed URLs required · AC-9 viewer visibility and teaser · AC-10 admin view · AC-11 race · AC-12 remove video · AC-13 cascades · AC-14 auth and validation · AC-15 missing variables · AC-16 expired links
