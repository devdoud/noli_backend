# Verify: Series & Episode Management · spec 0004 · updated 2026-09-30

_Steps derived from spec 0004 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

_`/check verify` on 2026-10-01: PASS, 12/12 live checks against the real app and database (throwaway data deleted afterwards). Episodes carried a pasted `videoUrl`, since spec 0006 hides episodes without a playable video._

_Every step below was run live during `/develop` on 2026-09-30 against a running app and the real database, on throwaway data that was deleted afterwards (marked "live"). `/check verify` should run them again independently._

_Testing tips from the build: send accented text from Swagger, the app, or Node (Git Bash `curl -d` breaks the encoding), and call `GET /watch-history` **without** `page`/`limit` (with them it currently returns `400`, a separate existing bug)._

## Setup

- An admin (`npm run db:make-admin -- <email>`), a regular viewer, one category, a premium series `P` with `freeEpisodeCount: 2` and episodes S1E1 to S1E4, and a second series `Q`.
- As the viewer, add S1E1, S1E2, S1E3 of `P` and S1E1 of `Q` to watch history.

## UI / manual (API calls)

- [x] Admin `PATCH /series/P` with `title`, `description`, `status`, plus `rating: 10` and `totalEpisodes: 99` → `200`, new values applied, `rating` and `totalEpisodes` unchanged, `categories` present, no `videoUrl` → AC-1 (live)
- [x] `PATCH /series/Q` with `P`'s title → `409`; `"title": "   "` → `400`; `"categoryIds": []` → `400`; `{}` → `400`; `POST /series` with an existing title → `409` → AC-2 (live)
- [x] `PATCH /series/Q/access` `{ "isPremium": null }` → `400`; `PATCH /series/bad/access {}` → `400` (empty body wins) → AC-3 (live)
- [x] Admin `PATCH /series/P/episodes/1/2` `{ "title": "  Épisode renommé  ", "duration": 900, "seasonNumber": 7, "views": 999 }` → title trimmed, duration 900, still S1E2, views unchanged → AC-4 (live)
- [x] Viewer `GET /watch-history` → the S1E2 entry shows "Épisode renommé" → AC-5 (live)
- [x] Admin `DELETE /series/P/episodes/1/2` → `totalEpisodes` down by one, `freeEpisodeCount` still 2, and the episode list shows E1, E3 free, E4 paid (the boundary shifted) → AC-6 (live)
- [x] Viewer history no longer has S1E2 of `P`, still has S1E1 and S1E3 → AC-6 (live)
- [x] Admin `DELETE /series/P` → the viewer's history has no entry of `P` left, and still has `Q` → AC-7 (live)
- [x] Repeat `DELETE /series/P/episodes/1/2` and `DELETE /series/P` → `404` each (the cleanup still runs on the retry) → AC-8 (live)
- [x] Viewer `PATCH /series/Q` → `403`; `PATCH /series/Q/episodes/x/1` → `400`; `/episodes/9/9` → `404`; `DELETE /series/test-id` → `404` → AC-9 (live)
- [x] `POST /series/P/episodes` with `"releaseDate": "2026-01-20T00:00:00.000Z"` → `201` and the date stored; with `episodeNumber: 1.5` or a blank title → `400` → AC-10 (live)
- [x] Re-add an existing S1E2 → `400`; send 4 different episode adds at the same time → all `201` and `totalEpisodes` equals the number of episodes → AC-11 (live)

## Commands

- [x] `npx tsc --noEmit -p tsconfig.json` → clean (2026-09-30)
- [x] `npx jest` → 176/176 passing (2026-09-30)
- [x] `npm run docs:openapi` → 36 routes, including `PATCH /series/{id}` and `PATCH`/`DELETE /series/{id}/episodes/{seasonNumber}/{episodeNumber}` (2026-09-30)

## Acceptance-criteria coverage

- AC-1 … one edit route · AC-2 … title and category rules · AC-3 … access alias · AC-4 … episode edit · AC-5 … history rename · AC-6 … episode delete and teaser shift · AC-7 … series delete cascade · AC-8 … retry safety · AC-9 … auth and path validation · AC-10 … create rules · AC-11 … atomic add
