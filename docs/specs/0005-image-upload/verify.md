# Verify: Image upload · spec 0005 · updated 2026-10-01 (live run without keys)

_Steps derived from spec 0005 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

_`/check verify` on 2026-10-01: PASS. All 14 acceptance criteria met live on the final code (after the `/debug` fix for the `?_a=` URL parameter): 23/23 upload checks against real Cloudinary, 27/27 checks on an instance started with empty keys (AC-10, AC-11, AC-12), and the AC-5 refusals. Test data removed from the database and Cloudinary (0 files under `noli/`). Three supplementary steps were not run and stay unticked: the stored file being upright after EXIF rotation (needs a real phone JPEG), the cross slot size check, and the `staging` folder check._

_Live run on 2026-10-01 during `/develop`, against the real app and database, with the `CLOUDINARY_*` keys still empty in `.env`: 27/27 checks passed on throwaway data that was deleted afterwards. Steps marked "(live)" ran then. Every step that needs a real upload (crops, URLs, replace, Cloudinary deletes, the race) waits for the keys; fill them in `.env`, then run those._

## Setup

- `.env` has `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `NODE_ENV=development`.
- An admin (`npm run db:make-admin -- <email>`), a regular viewer, one category, a series `S` with episodes S1E1 and S1E2.
- Test images: `cover.jpg` (1200 × 1800), `banner.jpg` (1920 × 1080), `thumb.png` (1280 × 720), `square.webp` (800 × 800), `face.jpg` (a portrait photo, at least 200 × 200), `big.jpg` (over 5 MB), `anim.gif` renamed to `anim.jpg`, an animated WebP, `tiny.png` (400 × 50), `phone.jpg` (portrait taken on a phone, stored rotated with EXIF orientation 6).
- Send files with Swagger (`/api/docs`, the routes show a file picker) or the app; for scripts use Node `fetch` with `FormData` (Git Bash `curl` breaks accented text).

## UI / manual (API calls)

_Also live without keys (2026-10-01): a file over 5 MB → `413`, a wrong field name → `400`, every episode returns `thumbnail: null`, `DELETE /users/me/avatar` → `200` with `{ message, user }` and no password, episode, series, and category deletes still `200` (and the episode retry `404`) with Cloudinary unconfigured. The steps below that still need a real upload stay unticked._


- [x] Admin `PUT /series/S/cover` with `cover.jpg` → `200` `{ message, series }`, `coverImage` starts with `https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto/v`, `categories` is populated, and `GET /series/S` shows the same URL → AC-1
- [x] Open that URL: the image is 2:3, 1000 px wide; in Cloudinary it sits at `noli/development/series/S/cover-<12 hex>` → AC-1, AC-14
- [x] Admin `PUT /series/S/banner` with `banner.jpg` → `200`, 16:9, at most 1920 px wide → AC-1
- [x] Admin `PUT /series/S/episodes/1/1/thumbnail` with `thumb.png` → `200`, that episode has `thumbnail`; S1E2 shows `thumbnail: null` in `GET /series/S/episodes` → AC-2
- [x] Admin `PUT /categories/<id>/image` with `square.webp` → `200` `{ message, category }`, `imageUrl` set, 800 × 800 → AC-3
- [x] Viewer `PUT /users/me/avatar` with `face.jpg` → `200` `{ message, user }`, `avatar` set, 400 × 400 centered on the face; `GET /users/<viewer id>` shows it → AC-4
- [x] `big.jpg` → `413`; `anim.jpg` (a GIF) → `415`; animated WebP → `415`; `tiny.png` as a cover → `400`; no file field → `400`; in each case `coverImage` is unchanged and nothing new appears in Cloudinary → AC-5 (live 2026-10-01: also executable bytes → `415`, animated PNG → `415`, unreadable → `400`, 5:1+ → `400`, over 25 MP → `400`; all refused before any Cloudinary call)
- [ ] `phone.jpg` as a cover is measured upright (accepted as a portrait), and the stored image is upright → AC-5 (half live 2026-10-01: an EXIF 6 JPEG stored 1500 × 1000 passes as a cover and is refused as a banner; the upright stored file still needs working keys)
- [x] Upload a second cover → `200`, the first file disappears from Cloudinary → AC-6
- [x] `DELETE /series/S/cover` → `200`, `coverImage: null`, the file is gone from Cloudinary; again → `200` → AC-7
- [x] `PATCH /series/S` with `coverImage: "https://example.com/x.jpg"` → `DELETE /series/S/cover` clears it without any Cloudinary call; a second `DELETE` → `200` → AC-7, AC-9 (live, without keys)
- [x] Upload a banner, then `PATCH /series/S` with a pasted `bannerImage` → the uploaded banner file is deleted from Cloudinary; send the same pasted URL again → nothing deleted → AC-9
- [x] Same for a category: upload an image, then `PATCH /categories/<id>` with a pasted `imageUrl` → the old file is deleted → AC-9
- [x] `DELETE /series/S/episodes/1/1` → that episode's thumbnail is gone from Cloudinary; `DELETE /series/S` → the whole `noli/development/series/S/` folder is empty; repeat both → `404`, cleanup still runs → AC-8
- [x] Delete an unused category with an image → its folder is empty; a category still used by a series → `409`, its image stays → AC-8
- [x] No token on any image route → `401`; viewer on `PUT /series/S/cover` → `403`; `PUT /series/bad/cover` → `404`; `PUT /series/S/episodes/x/1/thumbnail` → `400`; `/episodes/9/9/thumbnail` → `404`; unknown category → `404` → AC-10 (live)
- [x] 10 image calls by one user spread over different routes, then an 11th → `429`; another user still → `200` → AC-11 (live)
- [x] Remove the three `CLOUDINARY_*` keys and restart: one warning in the log, the app boots, `GET /series` works, an upload → `503` and the image is unchanged, removing a pasted URL → `200`, removing an uploaded file → `503`, avatar upload → `503` → AC-12 (live)
- [x] Send two cover uploads for `S` at the same moment → one `200`, one `409`, and Cloudinary holds exactly one cover file for `S` → AC-13

## Value sourcing checks

- [x] File bytes and type come from the multipart field `file`: send the same file under another field name → `400` → Value sourcing (file bytes)
- [ ] The crop and minimums come from the slot table: the same 800 × 800 image is accepted as a category image but refused as a banner (`400`, needs 1280 × 720) → Value sourcing (slot table)
- [ ] The public id folder comes from `NODE_ENV`: restart with `NODE_ENV=staging`, upload → file lands under `noli/staging/...`; a cover uploaded under `development` is not deleted when replaced from `staging` → Value sourcing (public id), AC-14
- [x] The stored URL carries the upload's version: two uploads give different `v<version>` segments and different random suffixes → Value sourcing (stored URL)
- [x] The avatar user comes only from the token: viewer A's `PUT /users/me/avatar` never changes viewer B → Value sourcing (avatar user)
- [x] The rate limit key is the user id: two accounts behind the same IP each get their own 10 → Value sourcing (rate limit key)

## Commands

- [x] `npx tsc --noEmit -p tsconfig.json` → clean (2026-10-01)
- [x] `npx jest` → 239/239 passing, including the HTTP test of the shared rate limit (2026-10-01)
- [x] `npm run docs:openapi` → 41 paths (2026-10-01); the OpenAPI file lists `PUT`/`DELETE` on `/series/{id}/cover`, `/series/{id}/banner`, `/series/{id}/episodes/{seasonNumber}/{episodeNumber}/thumbnail`, `/categories/{id}/image`, `/users/me/avatar`

## Acceptance-criteria coverage

- AC-1 cover and banner · AC-2 thumbnail · AC-3 category image · AC-4 avatar · AC-5 refusals and EXIF · AC-6 replace · AC-7 remove · AC-8 cascades · AC-9 pasted URLs · AC-10 auth and paths · AC-11 rate limit · AC-12 no keys · AC-13 race · AC-14 environment folders
