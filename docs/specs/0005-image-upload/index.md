# 0005. Image upload

**Date**: 2026-09-30
**Status**: Accepted

## Summary

This lets an admin upload the pictures of the catalog (series cover and banner, episode thumbnail, category image) and lets any signed in user upload their own avatar, instead of pasting links to images hosted somewhere else. Files go through the API, which checks type, weight, and pixel size, then stores them on Cloudinary (an image CDN, a service that serves files fast from servers near the user). Cloudinary crops each image to its slot's shape, and every URL asks for the best format and quality per device, which keeps data use low on mobile networks. Old files are deleted when an image is replaced, removed, or its owner is deleted, so nothing piles up on the Cloudinary quota.

## Requirements

**User stories**:
- As an admin, I want to upload a cover and a banner for a series so that the app shows real artwork without me hosting files elsewhere.
- As an admin, I want to upload an episode thumbnail and a category image so that episode lists and genre tiles look finished.
- As a user, I want to upload my own avatar so that my profile shows my picture.
- As a user on mobile data, I want images that are light and sized for my screen so that the app loads fast and costs me little.

**Acceptance criteria** (the contract):
- **AC-1**: An admin sends `PUT /series/:id/cover` with a JPEG, PNG, or WebP in the multipart field `file` → `200` with `{ message, series }` (the public series, categories populated). `coverImage` is a Cloudinary HTTPS URL carrying `f_auto,q_auto`, the stored image is cropped to 2:3 and at most 1000px wide, and `GET /series/:id` returns the same URL. The same holds for `PUT /series/:id/banner` (16:9, at most 1920px wide).
- **AC-2**: An admin sends `PUT /series/:id/episodes/:seasonNumber/:episodeNumber/thumbnail` → `200` with `{ message, series }`, and that episode now has `thumbnail` (16:9, at most 1280px wide). Every episode without one returns `thumbnail: null` (never missing), including episodes created before this feature.
- **AC-3**: An admin sends `PUT /categories/:id/image` → `200` with `{ message, category }`, `imageUrl` set (1:1, at most 800px).
- **AC-4**: A signed in user sends `PUT /users/me/avatar` → `200` with `{ message, user }` (their own profile, same fields as `GET /users/:id`), `avatar` set (1:1, at most 400px, centered on the face when there is one). There is no way through this route to change another user's avatar.
- **AC-5**: A file over 5 MB → `413`. A file whose first bytes are not JPEG, PNG, or WebP (a renamed `.exe` or a GIF is caught), or an animated PNG or WebP → `415`. No `file` field, an unreadable or corrupt image, an image below the slot's minimum width or height (after EXIF rotation), a shape more stretched than 5:1, or more than 25 megapixels → `400`. In every refused case the stored image is unchanged, and all but the corrupt body case are refused before anything is sent to Cloudinary.
- **AC-6**: Replacing an image (a second `PUT` on the same slot) stores the new URL, then deletes the old Cloudinary file (with CDN invalidation). If that delete fails, the response is still `200` and the failure is logged.
- **AC-7**: `DELETE` on any of the five slot routes sets the URL back to `null` and returns `200` with the resource. A file this feature uploaded is deleted from Cloudinary; a pasted URL is just cleared. Calling it again on an empty slot is also `200` (nothing to do).
- **AC-8**: Deleting a series removes all of its Cloudinary files (cover, banner, every thumbnail). Deleting an episode removes its thumbnail. Deleting a category removes its image. A failed Cloudinary cleanup never fails the delete itself, and a retried delete (the `404` repeat from spec 0004) still runs the cleanup.
- **AC-9**: Pasting a URL in `POST`/`PATCH /series` (`coverImage`, `bannerImage`) or `POST`/`PATCH /categories` (`imageUrl`) still works. If the slot held a file this feature uploaded for that owner and slot, that file is deleted after the save. Sending the same URL again deletes nothing, and a pasted URL is never deleted from Cloudinary.
- **AC-10**: Image routes: no token → `401`. Catalog image routes: non admin → `403`, unknown or malformed series or category id → `404`, unknown episode → `404`, non integer season or episode → `400`.
- **AC-11**: More than 10 calls to image routes (uploads and removes together, refused ones included) by the same user within 10 minutes → `429`. The counter is per user id and shared across all ten routes.
- **AC-12**: With the Cloudinary keys missing, the app still boots (one warning in the log) and every other route works. An upload answers `503` ("image service unavailable") and keeps the current image; a remove answers `503` only when it would have to delete an uploaded file. Cloudinary failing or timing out during an upload also gives `503`.
- **AC-13**: Two uploads to the same slot at the same moment never leave an orphan file: exactly one wins with `200`, the other gets `409` and its freshly uploaded file is deleted.
- **AC-14**: Files for each environment land under `noli/<env>/...` on Cloudinary (`<env>` from `NODE_ENV`), so development uploads never mix with production ones, and a delete can never reach outside the owner's own folder.

## Decision

**Chosen option**: Option 2: Upload through the API to Cloudinary, one dedicated route per image slot.

Each image slot gets its own `PUT` (upload and replace) and `DELETE` (remove) route. The API validates the file in memory, uploads it to Cloudinary with a crop to the slot's shape, saves the new URL with a compare and set write (it only succeeds if the slot still holds the URL the request started from), then deletes the old file on a best effort basis. The Cloudinary public id (the file's name on Cloudinary) is not stored: it is read back from the URL, and a file is deleted only when that id sits inside the owner's own slot folder.

**Implementation skills**: `cloudinary-transformations` (`cloudinary-devs/skills`, `.agents/skills/cloudinary-transformations/`) · `cloudinary-docs` (`cloudinary-devs/skills`, `.agents/skills/cloudinary-docs/`) · `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.agents/skills/nestjs-best-practices/`) · `mongodb-query-optimizer` (`mongodb/agent-skills`, `.agents/skills/mongodb-query-optimizer/`)

## Feature design

**Stack additions**:
- `cloudinary` (the official Node SDK, v2 API): upload, destroy, delete by prefix, URL building.
- `@nestjs/throttler` (v6): the official NestJS rate limiter, used only on image routes.
- `image-size`, pinned to `^1` (CommonJS, safe under ts-jest; `import sizeOf from 'image-size'` works since `esModuleInterop` is on). `sizeOf(buffer)` returns `{ width, height, type, orientation }` from the file header, and throws on data it can't read.
- `@types/multer` (dev) for the `Express.Multer.File` type. Multer itself already ships with `@nestjs/platform-express`; use its default memory storage (the file stays in RAM, never touches the disk).

**Module layout**: a new `src/media/` module, imported by `SeriesModule`, `CategoriesModule`, and `UsersModule`.
- `media.module.ts`: registers `ThrottlerModule.forRoot([{ name: 'upload', ttl: 600_000, limit: 10 }])` and exports `ThrottlerModule`, `MediaService`, and `UploadThrottlerGuard`, so the guard resolves in all three host modules with one shared in memory store. No global `APP_GUARD`. Add a test that the guard resolves inside `UsersModule`.
- `media.service.ts` (`MediaService`, the only place that talks to Cloudinary):
  - On construction, read `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` from `ConfigService`. All three present → `cloudinary.config({ cloud_name, api_key, api_secret, secure: true })`. Otherwise log one warning (Nest `Logger`) and stay unconfigured. `CLOUDINARY_URL` is ignored.
  - `isConfigured()`: the three vars were present.
  - `uploadImage(buffer, slot, ownerFolder)` → `{ url, publicId }`. Uses `upload_stream` with `public_id` set to the full path (never `folder` too, or it is doubled), `resource_type: 'image'`, `overwrite: false`, `timeout: 30000`, and `transformation: [{ width, height, crop: 'fill', gravity }]` from the slot table. Error in the callback or in `result.error`: `http_code` 400 → `BadRequestException('Image invalide')`; anything else (5xx, timeout, auth) → `ServiceUnavailableException('Service d’images indisponible')`.
  - `destroy(publicId)`: `uploader.destroy(publicId, { invalidate: true })`. Never throws; logs failures.
  - `destroyByPrefix(prefix)`: `api.delete_resources_by_prefix(prefix, { invalidate: true })`, repeated with `next_cursor` while the answer says `partial`, at most 5 rounds (1000 files per round). Never throws; logs failures. Refuses (logs, returns) any prefix that does not match `^noli/[a-z0-9-]+/(series|categories|users)/[a-f0-9]{24}/`.
  - `ownedPublicId(url, ownerSlotPrefix)`: parses `https://res.cloudinary.com/<configured cloud>/image/upload/(<transformations>/)*v<digits>/<publicId>` and returns the public id only if it starts with `ownerSlotPrefix`; otherwise `null` (a pasted URL, another cloud, another owner, another slot, another environment).
- `image-slots.ts`: the slot table below, plus `envSegment()` and `ownerFolder(slot, ids)`, the single builder of every path used by uploads, ownership checks, and cascades.
- `validate-image.ts`: type, animation, and dimension checks, throwing the right Nest exception.
- `upload-throttler.guard.ts`: extends `ThrottlerGuard`. `getTracker(req)` returns `String(req.user._id)`. `generateKey(context, suffix, name)` returns `` `${name}-${suffix}` `` so the counter is shared across all routes (the default key includes the controller and handler names, which would give each route its own counter). Used as `@UseGuards(JwtAuthGuard, UploadThrottlerGuard)`, so it always runs after the JWT guard.
- `file-upload.decorator.ts`: one decorator bundling `UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))`, `@ApiConsumes('multipart/form-data')`, and `@ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })`. Nest's `FileInterceptor` already maps Multer's `LIMIT_FILE_SIZE` to `413` and a wrong field name or extra file to `400`; add no custom filter.

**Slot table** (`image-slots.ts`):

| Slot | Crop on upload | Minimum source (w × h) | Owner slot prefix (under `noli/<env>/`) |
|---|---|---|---|
| `seriesCover` | 1000 × 1500 (2:3), `gravity: 'auto'` | 400 × 600 | `series/<seriesId>/cover-` |
| `seriesBanner` | 1920 × 1080 (16:9), `gravity: 'auto'` | 1280 × 720 | `series/<seriesId>/banner-` |
| `episodeThumbnail` | 1280 × 720 (16:9), `gravity: 'auto'` | 640 × 360 | `series/<seriesId>/episodes/s<season>e<episode>-` |
| `categoryImage` | 800 × 800 (1:1), `gravity: 'auto'` | 400 × 400 | `categories/<categoryId>/image-` |
| `userAvatar` | 400 × 400 (1:1), `gravity: 'auto:face'` (falls back to auto when no face is found) | 200 × 200 | `users/<userId>/avatar-` |

Full public id = `noli/<env>/<owner slot prefix><rand>`, where `<rand>` is 12 hex characters from `crypto.randomBytes(6)`, new on every upload, so a CDN cache never serves an old picture under a new URL. `envSegment()` = `NODE_ENV` lower cased with every character outside `[a-z0-9-]` removed, falling back to `development` when empty. `crop: 'fill'` scales the source to cover the target box and crops what overflows; a source between the minimum and the target is scaled up a little, and the minimum keeps that acceptably sharp. The trailing hyphen in each prefix keeps `s1e2-` from matching `s1e20-` and `cover-` from matching a banner.

**Image validation** (`validate-image.ts`, in this order, on the Multer buffer):
1. No file → `400`.
2. Magic bytes: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF` + 4 bytes + `WEBP`. Anything else → `415`.
3. Animated: a PNG containing an `acTL` chunk, or a WebP containing an `ANIM` chunk → `415` ("images animées non acceptées").
4. `sizeOf(buffer)`; a throw → `400`. If `orientation` is 5, 6, 7, or 8, swap width and height (Cloudinary rotates by EXIF, so the stored image is upright).
5. Width or height below the slot minimum, long side over 5 × short side, or width × height over 25,000,000 → `400` with the slot's rule in the message.

A header can be valid over a corrupt body; Cloudinary then refuses it with `http_code` 400, which `uploadImage` maps to `400` (so that one case does reach Cloudinary).

**Data model sketch** (no new collection, no hidden fields; each image lives on its owner as a URL, 1:1):

| Entity | URL field | Change |
|---|---|---|
| `Series` | `coverImage: string \| null` | none (exists) |
| `Series` | `bannerImage: string \| null` | none (exists) |
| `Episode` (subdocument in `Series.episodes`) | `thumbnail: string \| null` | **new**: add `thumbnail: { type: String, default: null }` to the **inline episodes array definition** in `series.schema.ts` (that inline object is what Mongoose uses; without it, strict mode silently drops `episodes.$.thumbnail`), and keep the `Episode` class in sync |
| `Category` | `imageUrl: string \| null` | none (exists) |
| `User` | `avatar: string \| null` | none (exists) |

No migration: old episodes have no `thumbnail`, and lean reads skip defaults, so `toPublicEpisodes` emits `thumbnail: ep.thumbnail ?? null`. No new index: every write filters by `_id`.

**Stored URL**: `cloudinary.url(publicId, { secure: true, version, fetch_format: 'auto', quality: 'auto' })`, `version` from the upload result, giving `https://res.cloudinary.com/<cloud>/image/upload/f_auto,q_auto/v<version>/<publicId>` (no file extension). The upload result's `secure_url` is not used because it lacks `f_auto,q_auto`. The crop is baked into the stored file at upload, so the delivery URL only carries format and quality.

**Check order** (Nest runs guards, then interceptors, then pipes, then the handler, so the codes come in this order):
1. `JwtAuthGuard` → `401`.
2. `UploadThrottlerGuard` → `429` (refused uploads count too, on purpose: they still cost a request).
3. `PUT` only: `FileInterceptor` reads the file into memory → `413` over 5 MB, `400` wrong field. A signed in non admin can push one 5 MB file before the `403`; the rate limit caps that at 10 per 10 minutes, which is accepted (the inline admin rule stays, no new `AdminGuard`).
4. Pipes: `ParseIntPipe` on season and episode → `400`.
5. Handler: inline admin check (catalog routes) → `403`; `isValidObjectId` on series or category id → `404` (as every existing route does).
6. Load the owner (series with `.select('coverImage bannerImage episodes')` as needed, category, or the user read fresh by `req.user._id`, since `req.user` is a snapshot taken at the guard) → `404`, or for a thumbnail the episode missing → `404`.
7. Then the flow below. So `404` always comes before `503`.

**Upload flow** (all five `PUT` routes, after the check order):
1. `isConfigured()` false → `503`.
2. `validateImage(file, slot)`.
3. Remember `oldUrl` (the slot's current URL, may be `null`).
4. `uploadImage` → `{ url, publicId }` (`400` or `503` on failure, nothing saved).
5. Compare and set: `findOneAndUpdate({ _id, <urlField>: oldUrl }, { $set: { <urlField>: url } }, { new: true })`, with `.populate(CATEGORY_POPULATE)` for series (without it `categories` comes back empty). For a thumbnail the filter is `{ _id, episodes: { $elemMatch: { seasonNumber, episodeNumber, thumbnail: oldUrl } } }` and the update `$set: { 'episodes.$.thumbnail': url }`. An `oldUrl` of `null` also matches a missing field in MongoDB.
6. No match → `destroy(publicId)` of the new file, then one `exists` read (`{ _id }`, plus the `$elemMatch` on season and episode for a thumbnail): gone → `404`, else `409` ("l'image a changé entre temps, réessayez").
7. Match → `ownedPublicId(oldUrl, slotPrefix)`; if non null, `destroy` it (best effort). Return the envelope.

**Remove flow** (all five `DELETE` routes, after the check order):
1. `oldUrl` null or missing → `200` with the resource, no write, no Cloudinary call.
2. `oldId = ownedPublicId(oldUrl, slotPrefix)`. If `oldId` is set and `isConfigured()` is false → `503` (nothing changed).
3. Compare and set the URL to `null` with the same filter as the upload. No match → the same `exists` read: `404` or `409`.
4. Match → if `oldId`, `destroy(oldId)` best effort. Return the envelope.

**Response envelopes** (mirror the existing routes):
- Series slots: `{ message: 'Series cover updated' | 'Series cover removed' | 'Series banner updated' | ..., series: toPublicSeries(populated) }`.
- Category slot: `{ message: 'Category image updated' | 'Category image removed', category }` (the category document as the existing `PATCH /categories/:id` returns it).
- Avatar: `{ message: 'Avatar updated' | 'Avatar removed', user: toUserProfile(user) }`. Extract `toUserProfile` from the object built in `UsersController.findById` (id, email, username, firstName, lastName, avatar, role, subscription, createdAt) so both routes share it.

**Cascades** (all best effort, logged, never change the response; every prefix built by `image-slots.ts` from an id already checked by `isValidObjectId`):
- `SeriesService.deleteSeries`: after the delete, and also on the `404` retry branch (like the history cleanup), one `destroyByPrefix('noli/<env>/series/<id>/')`. It covers cover, banner, and every thumbnail. An Admin API call on a retry for an id that never existed is accepted: admin only and rare.
- `SeriesService.deleteEpisode`: always `destroyByPrefix('noli/<env>/series/<id>/episodes/s<season>e<episode>-')`, on success and on the retry branch. Accepted even when the episode never had a thumbnail (admin only, rare).
- `CategoriesService.remove`: after `deleteOne` succeeds, `destroyByPrefix('noli/<env>/categories/<id>/')`. A category in use is refused `409` earlier (spec 0003), so no cleanup runs then.
- Users: no delete route exists today (see Follow-up).

**Pasted URLs** (AC-9): in `updateSeries` and `CategoriesService.update`, when the DTO carries `coverImage`, `bannerImage`, or `imageUrl` (a string or `null`, both already accepted by the DTOs):
1. Run the update as `findOneAndUpdate(..., { returnDocument: 'before' })` selecting only the image fields, so the old values come from the same atomic write (no gap for a concurrent upload to slip into).
2. Read the updated document again for the response (series populated with `CATEGORY_POPULATE`), keeping the existing `404`, `409`, and error mapping of spec 0004.
3. For each image field in the DTO whose old value differs from the new one, `ownedPublicId(old, slotPrefix)` and `destroy` it if non null. Same URL sent again → nothing deleted. A pasted URL is never owned, so never deleted.
`createSeries` and `CategoriesService.create` need no change. `UpdateEpisodeDto` does not gain `thumbnail`: thumbnails are upload only.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/series/:id/cover` | PUT | `file` (multipart, req) | `{ message, series }` | admin | 400, 403, 404, 409, 413, 415, 429, 503 |
| `/series/:id/cover` | DELETE | none | `{ message, series }` | admin | 403, 404, 409, 429, 503 |
| `/series/:id/banner` | PUT | `file` | `{ message, series }` | admin | same as cover PUT |
| `/series/:id/banner` | DELETE | none | `{ message, series }` | admin | same as cover DELETE |
| `/series/:id/episodes/:seasonNumber/:episodeNumber/thumbnail` | PUT | `file` | `{ message, series }` | admin | same as cover PUT |
| `/series/:id/episodes/:seasonNumber/:episodeNumber/thumbnail` | DELETE | none | `{ message, series }` | admin | 400, 403, 404, 409, 429, 503 |
| `/categories/:id/image` | PUT | `file` | `{ message, category }` | admin | same as cover PUT |
| `/categories/:id/image` | DELETE | none | `{ message, category }` | admin | same as cover DELETE |
| `/users/me/avatar` | PUT | `file` | `{ message, user }` | any signed in user | 400, 409, 413, 415, 429, 503 |
| `/users/me/avatar` | DELETE | none | `{ message, user }` | any signed in user | 409, 429, 503 |

Every route also answers `401` without a token. All carry `@ApiTags`, `@ApiOperation` with a French summary (for example "Téléverser la couverture d'une série"), `@ApiBearerAuth('JWT-auth')`, and `@ApiResponse` for each listed code. No route order concern: the only parametrised sibling is `GET /users/:id`, and these are other methods or segment counts. No `@Body()` on these routes, so the global `ValidationPipe` does not apply to them.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Any upload | the file bytes | multipart field `file` (Multer memory buffer) |
| Any upload | type, animation, width, height, orientation | derived from the buffer (magic bytes, chunk scan, `image-size`) |
| Any upload | crop shape, target size, minimum size, gravity | `image-slots.ts` slot table |
| Any upload | Cloudinary public id | `noli/` + `envSegment()` (from `NODE_ENV`) + owner slot prefix (slot table + path params or `req.user._id`) + `crypto.randomBytes(6)` |
| Any upload | stored URL | `cloudinary.url(publicId, { secure, version, f_auto, q_auto })`, `version` from the upload result |
| Upload, remove, pasted URL | the old file to delete | the slot's previous URL → `ownedPublicId(oldUrl, slotPrefix)` |
| Series and episode routes | series id, season, episode | path params |
| Category routes | category id | path param `:id` |
| Avatar routes | the user | `req.user._id`, user read fresh from the database |
| Rate limit | the counter key | `upload-` + `String(req.user._id)` |
| Rate limit | window and limit | `ThrottlerModule.forRoot` in `MediaModule`: `ttl: 600_000`, `limit: 10` |
| `503` decision | configured or not | the three `CLOUDINARY_*` env vars all present at boot |
| Cascades | the prefix to delete | `image-slots.ts`: `noli/<env>/series/<id>/`, `.../episodes/s<s>e<e>-`, `noli/<env>/categories/<id>/` |
| Episode reads | `thumbnail` | `Episode.thumbnail`, `?? null` in `toPublicEpisodes` |
| Response messages | `message` | fixed strings listed under Response envelopes |

**Key invariants**:
- A Cloudinary file is deleted only when its public id starts with the owner's own slot prefix in the current environment; pasted URLs, other owners, other slots, and other environments are never touched.
- A slot's URL changes in one atomic compare and set write; the database is written before any old file is deleted, so it never points at a deleted file.
- A refused file never gets saved; a failed save never leaves the new file behind (it is destroyed before the error returns).
- Every Cloudinary delete is best effort; its failure is logged and never changes the response.
- `destroyByPrefix` never runs on a prefix that does not match the owner folder pattern.

**Security model**:
- Catalog image routes: `JwtAuthGuard` plus the inline `req.user.role === 'admin'` check (`ForbiddenException`), as for every admin route (root `AGENTS.md`).
- Avatar routes: any signed in user, only on their own account (`req.user._id`); no admin override in this spec.
- Files are checked on content, not on name or declared type. The server never writes the file to disk.
- Image URLs are public, which is fine: covers, thumbnails, and avatars are shown to everyone anyway. Premium gating (spec 0002) applies to video, not artwork.
- The Cloudinary secret stays in env vars, never in responses or logs. Log the public id and the error message on failures (Nest `Logger`), not the credentials.
- Rate limiting: 10 per 10 minutes per user across every image route, which caps quota abuse by a stolen or scripted account.

**Configuration required**:
- `CLOUDINARY_CLOUD_NAME`: your Cloudinary cloud name (Dashboard → Product environment).
- `CLOUDINARY_API_KEY`: the API key of that environment.
- `CLOUDINARY_API_SECRET`: the API secret (keep it out of git; `.env` is already gitignored).
- Prerequisite: create a free Cloudinary account before `/develop` reaches the live checks. Without the keys the code and unit tests still build; only live uploads return `503`.

**Critical test scenarios**:
- Happy path: admin uploads a valid 1200 × 1800 JPEG as a cover, gets `200`, the URL carries `f_auto,q_auto`, `categories` is populated, and `GET /series/:id` shows it, verifies **AC-1**
- Replace and remove: a second upload destroys the first file's id; `DELETE` clears and destroys; `DELETE` on a pasted URL clears without a Cloudinary call; a second `DELETE` is `200`, verifies **AC-6**, **AC-7**
- Refusals: 6 MB → `413`, a GIF renamed `.jpg` → `415`, an animated WebP → `415`, a 400 × 50 cover → `400`, a portrait photo stored landscape with EXIF orientation 6 is measured upright, and the Cloudinary mock is never called; a Cloudinary `http_code` 400 → `400`, verifies **AC-5**
- Ownership: `ownedPublicId` returns `null` for a pasted URL, another cloud, another series, the banner prefix on a cover, and the `production` folder while running as `development`, verifies **AC-9**, **AC-14**
- Concurrency: the compare and set misses → the new file is destroyed and `409` is returned (or `404` when the series is gone), verifies **AC-13**
- Cascade: deleting a series calls `destroyByPrefix` with the series folder, also on the `404` retry, and a throwing destroy still returns the normal response, verifies **AC-8**
- Rate limit: 10 calls spread over two different image routes, the 11th on a third route → `429`, verifies **AC-11**
- Auth/permission: a viewer on `PUT /series/:id/cover` gets `403`; no token gets `401`; `PUT /series/bad/cover` → `404`, verifies **AC-10**
- Outage: keys unset → the app boots with one warning, upload → `503`, remove of a pasted URL → `200`, verifies **AC-12**
- Old episodes: an episode saved without `thumbnail` comes back with `thumbnail: null`, verifies **AC-2**

## Build plan

Tracer Bullet: the first task pushes one slot (series cover) through every layer end to end, then the other slots reuse the same pieces.

1. [x] Thin end to end thread on the series cover: install `cloudinary`, `image-size@^1`, `@nestjs/throttler`, and `@types/multer`; create `src/media/` (`MediaService` with explicit config, `isConfigured()`, `uploadImage`, `destroy`, `ownedPublicId`; `image-slots.ts` with the cover entry and the path builders; `validate-image.ts`; the upload decorator); add `PUT /series/:id/cover` with the full check order and upload flow; unit tests with a mocked `MediaService`, satisfies **AC-1**, **AC-5**, **AC-6**, **AC-12**, **AC-14**
2. [x] Remove and guard rails: `DELETE /series/:id/cover`; `ThrottlerModule` and `UploadThrottlerGuard` in `MediaModule` (shared key, user tracker) on both routes; the `409`/`404` race path; tests for `401`, `403`, `404`, `409`, `429`, satisfies **AC-7**, **AC-10**, **AC-11**, **AC-13**
3. [x] Remaining slots on the same pieces: banner; thumbnail (new `thumbnail` in the inline episodes schema and the class, `?? null` in `toPublicEpisodes`); category image; user avatar (`/users/me/avatar`, fresh user read, shared `toUserProfile`); `MediaModule` imported by `CategoriesModule` and `UsersModule`; each slot with `PUT` and `DELETE`, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-7**
4. [x] Cascades and pasted URLs: `destroyByPrefix` (with the `partial` loop and the prefix guard) in `deleteSeries`, `deleteEpisode`, and `CategoriesService.remove`, retry safe; `returnDocument: 'before'` in `updateSeries` and `CategoriesService.update` with owned file deletion, satisfies **AC-8**, **AC-9**
5. [x] Docs and live check: Swagger decorators on all ten routes, `npm run docs:openapi`, add the three `CLOUDINARY_*` keys to `.env` (from your account), then run every AC live on throwaway data and clean it up afterwards (database and the `noli/development/` folder), satisfies **AC-1** to **AC-14**

## Consequences

**Positive**:
- Admins manage artwork end to end from the API; the app gets consistent shapes and light, device fitted images.
- One media module and one slot table: adding a future slot (for example a trailer poster) is a table row and two routes.
- No hidden fields: the data model barely changes (one new episode field), and there is nothing to leak in responses.
- The avatar part of feature 6 (Profile Editing) is done early, on the same plumbing.

**Negative / tradeoffs**:
- A new external dependency: uploads stop (`503`) when Cloudinary is down, and the free tier has monthly credit and Admin API rate limits (about 500 calls per hour; the prefix deletes use the Admin API).
- Files pass through your server's memory; ten parallel 5 MB uploads hold about 50 MB of RAM, and a signed in non admin can push one file before the `403`. Fine at this scale, worth revisiting before opening uploads widely.
- Ownership depends on the URL format: if the stored URL shape ever changes, `ownedPublicId` must learn the new one, or old files stop being cleaned (never wrongly deleted).
- Best effort deletes can still leave a rare orphan: a Cloudinary outage during cleanup, or a client that disconnects after the upload and before the save. There is no sweeper job in this spec.
- `@nestjs/throttler` keeps its counters in process memory: they reset on restart and are not shared if you run several instances. Fine for one instance.

**Neutral**:
- Existing pasted URLs keep working untouched; no data migration.
- Episode reads gain a `thumbnail` field (`null` until uploaded), a small, additive change for the app.
- Two new Cloudinary agent skills are installed in `.agents/skills/`.

## Follow-up

- [ ] `cloudinary-docs` and `cloudinary-transformations` are installed but not yet in `AGENTS.md`. Their conventions are area specific, so they belong in a nested `src/media/AGENTS.md` with a one line pointer from the root `## Agent skills` section (`/sync` or `/audit` owns that write).
- [ ] Record the optional official Cloudinary MCP server on the root `MCP servers:` line; connect it yourself once your account exists, it lets the agent see and clean the media library during testing.
- [ ] When a user delete route is added (or in feature 6), cascade `destroyByPrefix('noli/<env>/users/<id>/')`.
- [ ] Feature 6 (Profile Editing) should reuse `PUT /users/me/avatar` rather than accept a pasted avatar URL.
- [ ] Consider a weekly orphan sweep (list the Cloudinary folder, drop ids no document references) if the logs show failed deletes.
- [ ] If the API ever runs on several instances, move the throttler storage to a shared store.
- [ ] `docs/api-reference.md` is already out of date (genres, `videoUrl`); refresh it along with these routes.
- [ ] Your `.env` has a stray `EOF` line between the KkiaPay keys (likely a leftover from a shell heredoc). It is harmless but worth deleting.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
