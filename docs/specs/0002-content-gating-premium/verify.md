# Verify: Content Gating for Premium · spec 0002 · updated 2026-09-30

_Steps derived from spec 0002 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

_`/check verify` on 2026-10-01: PASS, 16/16 live checks against the real app and database (throwaway data, deleted afterwards), and the backfill rerun changed nothing. Episodes in the test carried a pasted `videoUrl`, since spec 0006 hides episodes without a playable video._

_Backfill ran 2026-09-30 (`still missing: 0`). Rerun it in any environment that already has series before relying on list responses._

## Setup (seed data, test environment only)

- A **free series** `F` with at least one episode.
- A **premium series** `P` with `freeEpisodeCount: 2` and three episodes added **out of order**: S2E1, S1E2, S1E1.
- Three users: a **free** user, a **premium** user (`plan: premium`, `isActive: true`, `endDate` in the future), and an **admin**.

## UI / manual (API calls)

- [x] Free user: `GET /series/F/episodes/1/1/play` → `200` with `data.videoUrl` → AC-1
- [x] Free user: `GET /series/P/episodes/1/1/play` and `.../1/2/play` → `200`; `.../2/1/play` → `403` with body exactly `{ statusCode: 403, code: 'PREMIUM_REQUIRED', message: 'Premium subscription required' }` → AC-2
- [x] Premium user: `GET /series/P/episodes/2/1/play` → `200` → AC-3
- [x] Set the premium user's `endDate` to 12 hours ago (inside the 1 day grace) → `.../2/1/play` still `200`; set it to 2 days ago while leaving `isActive: true` (the cron hasn't run) → `403` → AC-3 (value sourcing: grace window checked live)
- [x] Premium user with `endDate` removed → `403` (fails closed) → AC-3
- [x] Admin with a free subscription: `.../2/1/play` → `200` → AC-3
- [x] No token: `GET /series/P/episodes/1/1/play` → `401`; `GET /series/not-an-id/episodes/1/1/play` → `404` (not `500`); `GET /series/P/episodes/9/9/play` → `404`; `GET /series/P/episodes/abc/1/play` → `400` → AC-4
- [x] Search every response for the string `videoUrl`: `GET /series/P`, `GET /series/P/episodes`, `POST /series/P/rate` (as a free user), `POST /series` and `POST /series/P/episodes` (as admin), `PATCH /series/P/access`, and all 7 `/recommendations/*` routes → no match anywhere; recommendations contain no `episodes` field → AC-5
- [x] `GET /series/P/episodes?page=1&limit=10` → order S1E1, S1E2, S2E1 with `isFree` true, true, false; `?page=3&limit=1` → S2E1 with `isFree: false` → AC-6 (value sourcing: ordering and isFree before pagination)
- [x] `GET /series`, `/series/search?q=...`, `/recommendations/popular` → every series has `isPremium` and `freeEpisodeCount` → AC-6
- [x] Admin: `PATCH /series/P/access` with `{ "freeEpisodeCount": 3 }` → `200`, and the free user can now play S2E1 on the next request; with `{}` → `400`; with `{ "freeEpisodeCount": -1 }` or `1.5` → `400`; as a non admin → `403` → AC-7
- [x] After the backfill, query the `series` collection: `countDocuments({ $or: [{ isPremium: { $exists: false } }, { freeEpisodeCount: { $exists: false } }] })` → `0`; rerun the backfill → it changes nothing → AC-8

## Commands

- [x] `npx tsc --noEmit -p tsconfig.json` → clean (2026-09-30)
- [x] `npx jest` → 113/113 passing, including `content-access.spec.ts` (2026-09-30)
- [x] `npm run db:backfill-series-access` → `still missing: 0` (2026-09-30; collection empty, second run changed nothing)
- [x] `npm run docs:openapi` (2026-09-30) → `docs/openapi.json` shows the `/play` route and no `videoUrl` on episode schemas

## Acceptance-criteria coverage

- AC-1 … free series play · AC-2 … teaser boundary + 403 body · AC-3 … premium, grace, fail closed, admin · AC-4 … 401/404/400 · AC-5 … videoUrl search across 13 routes · AC-6 … flags + ordering · AC-7 … admin PATCH validation · AC-8 … backfill query
