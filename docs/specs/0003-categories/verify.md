# Verify: Categories · spec 0003 · updated 2026-09-30

_Steps derived from spec 0003 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

_Testing tip from the build: from Git Bash on Windows, `curl -d` with accented text (é, è) is sent in the wrong encoding and gives wrong slugs. Test accents from Swagger (`/api/docs`), the mobile app, or a Node `fetch` script._

_`/check verify` on 2026-10-01: PASS, 19/19 live checks against the real app and database with Node `fetch` (accents sent correctly), throwaway data deleted afterwards._

_A full live pass of the steps marked (live 2026-09-30) was run during `/develop` against a running app and the real database, on throwaway data that was deleted afterwards. `/check verify` should run them again independently._

## Setup

- An admin account (`npm run db:make-admin -- <email>`) and a regular user account, each with a token.

## UI / manual (API calls)

- [x] Admin `POST /categories` `{ "name": "Comédie romantique" }` → `201`, `slug: comedie-romantique`, placed after the last category, `isVisible: true` → AC-1 (live 2026-09-30 with "Comédie musicale")
- [x] `POST /categories` `{ "name": "comedie ROMANTIQUE" }` and `{ "name": "Comèdie Romantique" }` → `409` each → AC-1 (live)
- [x] `POST /categories` with `"All"`, `"Order"`, `"!!!"` → `400` each → AC-1 (live for "All")
- [x] Admin `PATCH /categories/:id` `{ "name": "Comédies romantiques" }` → name changes, `slug` stays `comedie-romantique`; `{ "description": null }` clears it; `{}` → `400`; `{ "slug": "all" }` → `400`; `{ "slug": "<another category's slug>" }` → `409` mentioning slug → AC-2 (live for `{}` and `"all"`)
- [x] `GET /categories/all` → take every id; `PUT /categories/order` with all ids reversed → `200`, orders `0..n-1`; with one id missing → `400` and order unchanged → AC-3 (live)
- [x] `DELETE /categories/:id` on a category with series → `409` `{ code: 'CATEGORY_IN_USE', seriesCount }`; on an unused one → `200` → AC-4 (live for the 409)
- [x] `GET /categories` → visible only, in order; hide one → gone from the list, `GET /categories/<slug>` and `/categories/<slug>/series` → `404`, still in `GET /categories/all` for the admin; a regular user on `/categories/all` → `403` → AC-5 (live, except the 403 which is unit tested)
- [x] `GET /categories/<slug>/series?sort=rating&page=1&limit=1` then `page=2` → no series repeated or skipped; `?page=abc`, `?limit=51`, `?sort=x` → `400` → AC-6 (live for the 400s) (value sourcing: `_id` tiebreak)
- [x] `POST /series` with an unknown category id → `400` naming it; with no `categoryIds` → `400`; with a duplicated id → stored once; with `"genres"` in the body → ignored → AC-7 (live)
- [x] Search every series response for `categoryIds` and `genres`: `GET /series`, `/series/search?q=`, `/series/trending`, `/series/:id`, `POST /series`, `POST /series/:id/episodes`, `POST /series/:id/rate`, `PATCH /series/:id/access`, `/categories/:slug/series`, and all `/recommendations/*` → never present; every series has `categories: [{ _id, name, slug }]` → AC-8 (live for list, by id, rate, browse, category recommendations)
- [x] Hide one of a series' two categories → that series' `categories` lists only the visible one everywhere → AC-8 (live)
- [x] `GET /recommendations/for-me` for a user with no watch history → popular series, each with `categories` (value sourcing: fallback path populated) → AC-8
- [x] `GET /recommendations/category/<slug>` → `200`; hidden or unknown slug → `404`; `GET /series/genre/Drama` and `/recommendations/genre/Drama` → `404` → AC-9 (live)
- [x] Watch an episode of a series in category X, then `GET /recommendations/for-me` → other series in X, not the watched one; still works if X is hidden (value sourcing: unpopulated match) → AC-9

## Commands

- [x] `npx tsc --noEmit -p tsconfig.json` → clean (2026-09-30)
- [x] `npx jest` → 155/155 passing, including `categories.service.spec.ts`, `categories.controller.spec.ts`, `slugify.spec.ts` (2026-09-30)
- [x] `npm run db:migrate-genres-to-categories` on seeded test series → categories created once for near duplicate genres, `!!!` skipped and reported, a genre-less series reported, second run changes nothing (2026-09-30; test data deleted) → AC-10
- [x] `npm run docs:openapi` → 35 routes, 6 category routes, no genre routes, `CreateSeriesDto.categoryIds` required (2026-09-30)

## Acceptance-criteria coverage

- AC-1 … create, near duplicates, reserved · AC-2 … rename keeps slug, clears, conflicts · AC-3 … reorder full and partial · AC-4 … in use guard · AC-5 … visibility and admin list · AC-6 … browse, pagination tiebreak, query validation · AC-7 … series create validation · AC-8 … categories on every response, hidden filtered, fallback · AC-9 … recommendations and removed routes · AC-10 … migration
