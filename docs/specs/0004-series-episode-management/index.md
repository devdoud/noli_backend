# 0004. Series and episode management

**Date**: 2026-09-30
**Status**: Accepted

## Summary

This completes the admin content tools: edit a series (all its details, categories, and premium settings in one call), edit an episode, and delete an episode. Deleting an episode or a series also removes it from every user's watch history, so "continue watching" never shows something that no longer exists, and renaming an episode updates the title users see in their history. Episode numbers stay frozen because they are the episode's identity in links, playback, and history.

## Requirements

**User stories**:
- As an admin, I want to fix or update a series' details, categories, and premium settings from one form, so content stays accurate without touching the database.
- As an admin, I want to edit an episode's title, description, video link, duration, or release date.
- As an admin, I want to delete an episode or a series that shouldn't be there.
- As a viewer, I never want to see a deleted episode or a stale title in my history.

**Acceptance criteria**:
- **AC-1**: An admin `PATCH /series/:id` can change any of `title`, `description`, `coverImage`, `bannerImage`, `languages`, `country`, `releaseYear`, `status`, `categoryIds`, `isPremium`, `freeEpisodeCount`, in one call, and gets the updated series back through the shared mapper (with `categories`, without `videoUrl`). Unknown fields are ignored; `rating`, `votes`, `episodes`, and `totalEpisodes` can't be changed through it. A body with no editable field returns `400`.
- **AC-2**: `categoryIds` on edit follows the create rules from spec 0003: at least one, every id must exist (`400` naming the unknown ones), duplicates merged. `title` is trimmed and must contain a visible character (`400` otherwise) and must stay unique: a title used by another series returns `409` on edit **and on create** (create returns `400` today; it changes to `409` for consistency), including a race, where the duplicate key error maps to `409`. `freeEpisodeCount` must be an integer ≥ 0. A validation error raised by the database layer returns `400`, never `500`.
- **AC-3**: `PATCH /series/:id/access` keeps its spec 0002 contract as a narrower alias of the same update: an empty body returns `400` (checked before the id), and `null` for `isPremium` or `freeEpisodeCount` returns `400`.
- **AC-4**: An admin `PATCH /series/:id/episodes/:seasonNumber/:episodeNumber` can change `title`, `description` (`null` clears it), `videoUrl`, `duration`, and `releaseDate` (an ISO date string). `seasonNumber`, `episodeNumber`, and `views` can't be changed. An unknown series or episode returns `404`; an empty body returns `400`. The response is the updated series through the shared mapper.
- **AC-5**: When an episode's `title` changes, every user's watch history entry for that episode shows the new title.
- **AC-6**: An admin `DELETE /series/:id/episodes/:seasonNumber/:episodeNumber` removes the episode, decrements `totalEpisodes`, and removes that episode from every user's watch history. `freeEpisodeCount` is left unchanged, so the free teaser boundary shifts to the next episodes in order.
- **AC-7**: An admin `DELETE /series/:id` (existing route) also removes every episode of that series from every user's watch history.
- **AC-8**: A delete is safe to retry: if the history cleanup failed after the episode or series was removed, calling the same `DELETE` again returns `404` for the missing content but still completes the history cleanup.
- **AC-9**: Every new or changed write route is admin only (`403` for others, `401` without a token). Malformed ids return `404`; non integer season or episode numbers return `400` (the path pipe runs first, so `400` wins over `404` when both apply).
- **AC-10**: `POST /series/:id/episodes` accepts `releaseDate` as an ISO date string (today it always fails with `400`), and uses the same rules as the edit route: `seasonNumber`, `episodeNumber`, and `duration` are integers ≥ 1, `title` is trimmed and not blank.
- **AC-11**: Adding an episode is a single atomic update: two admins adding and deleting episodes of the same series at the same moment can never leave `totalEpisodes` different from the real number of episodes, and adding an episode whose (season, episode) already exists still returns `400`.

## Decision

**Chosen option**: in place edits and hard deletes on the embedded episodes, with watch history kept consistent by cascading clean up and rename writes, and episode numbers frozen.

`PATCH /series/:id` becomes the single edit route for a series; episodes get their own `PATCH` and `DELETE` addressed by (season, episode). Watch history is cleaned or updated through three new `WatchHistoryService` methods called after the series write succeeds.

## Rationale

Reasoning and options considered: see `rationale.md`.

## Feature design

**Data model sketch**: no schema change.
- *`Series`*: editable fields as listed in AC-1. `rating` and `votes` are computed from ratings, `episodes` and `totalEpisodes` are managed by the episode routes.
- *`Episode`* (embedded in `Series.episodes`): editable `title`, `description`, `videoUrl`, `duration`, `releaseDate`. Frozen `seasonNumber`, `episodeNumber` (the identity used by `/play`, watch history, and teaser position), `views`, `createdAt`.
- *`WatchHistory`* (one document per user, `episodes[]` of `{ seriesId: string, seasonNumber, episodeNumber, title, ... }`): no new field; entries are removed or retitled by the cascade writes below.

**DTOs**:
- Shared title rule (series and episode titles, create and update): `@Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString @MinLength(1)`, so a blank or spaces-only title is `400` at the pipe, before the database.
- `UpdateSeriesDto` (all optional; required-when-present fields use `ValidateIf(o => o.x !== undefined)` so `null` is rejected, the same pattern as spec 0003's `UpdateCategoryDto`): `title` (title rule), `description`, `coverImage`, `bannerImage`, `country` (`@IsOptional @IsString`: a string, or `null`, which is stored as `null` and passed through by the mapper), `languages` (`@IsArray @IsString({ each: true })`, an empty array is allowed), `releaseYear` (`@IsInt @Min(1888) @Max(2100)`), `status` (`@IsIn(['ongoing', 'completed'])`), `categoryIds` (`@IsArray @ArrayMinSize(1) @IsMongoId({ each: true })`), `isPremium` (`@IsBoolean`), `freeEpisodeCount` (`@IsInt @Min(0)`).
- `UpdateSeriesAccessDto` (spec 0002): switch `isPremium` and `freeEpisodeCount` from `@IsOptional` to `ValidateIf(o => o.x !== undefined)` so `null` is `400` instead of reaching the database (AC-3).
- `UpdateEpisodeDto` (all optional, same `null` rule; only `description` accepts `null`): `title` (title rule), `description`, `videoUrl` (`@IsString @MinLength(1)`), `duration` (`@IsInt @Min(1)`, seconds), `releaseDate` (`@IsDateString()`: must be an ISO string; Mongoose casts it to a `Date`).
- `CreateEpisodeDto` (AC-10): `seasonNumber`, `episodeNumber`, `duration` become `@IsInt @Min(1)` (today `@IsNumber` lets `1.5` in, and such an episode could never be addressed by the integer path routes); `title` gets the title rule; `releaseDate` becomes `@IsDateString()`.
- `CreateSeriesDto.title`: the title rule.
- "No editable field" is checked in the service after the global whitelist has stripped unknown keys.

**Service layer**:
- Error mapping shared by every series write: a duplicate key error (`code === 11000`; `title` is the only unique key on `Series`) → `409`; a Mongoose `Error.ValidationError` or `Error.CastError` → `400`. Never a `500` for bad input.
- `SeriesService.createSeries`: the existing duplicate title check returns `409` instead of `400` (AC-2), plus the duplicate key mapping for the race.
- `SeriesService.updateSeries(id, dto)` (a new, typed method; the old loose `updateSeries(id, any)` was deleted in spec 0003): no editable field → `400`; `isValidObjectId` → else `404`; `categoryIds` → reuse `validateCategoryIds` from spec 0003; if `title` is present, `findOne({ title, _id: { $ne: id } })` → `409` (the friendly path; the duplicate key mapping covers the race); `$set` only the provided fields with `findByIdAndUpdate(id, { $set }, { new: true, runValidators: true }).populate(CATEGORY_POPULATE)`; `null` result → `404`. `runValidators` only checks the paths being set, so series that predate spec 0003 and have no `categoryIds` can still be edited on other fields; the schema's `categoryIds` length validator only runs when `categoryIds` is sent, and the DTO already guarantees at least one.
- `SeriesService.updateAccess(id, dto)`: keeps its current order (empty body → `400` first), then delegates to `updateSeries` with only `isPremium` and `freeEpisodeCount` (AC-3).
- `SeriesService.addEpisode` (AC-11) becomes one atomic `findOneAndUpdate({ _id: id, episodes: { $not: { $elemMatch: { seasonNumber, episodeNumber } } } }, { $push: { episodes: dto }, $inc: { totalEpisodes: 1 } }, { new: true, runValidators: true })`, populated. On `null`, `exists({ _id: id })` tells the two cases apart: series missing → `404`, episode already there → `400` "Episode already exists". This replaces today's read, modify, `save()`, which can lose a concurrent delete's decrement.
- `SeriesService.updateEpisode(id, season, episode, dto)`: `isValidObjectId` → else `404`; no editable field → `400`; one atomic `findOneAndUpdate({ _id: id, episodes: { $elemMatch: { seasonNumber: season, episodeNumber: episode } } }, { $set: { 'episodes.$.title': …, … } }, { new: true, runValidators: true })` with only the provided fields, then populate; `null` → `404`. If `title` was in the body, call `WatchHistoryService.renameEpisodeEverywhere(id, season, episode, title)`.
- `SeriesService.deleteEpisode(id, season, episode)`: `isValidObjectId` → else `404`; `findOneAndUpdate({ _id: id, episodes: { $elemMatch: … } }, { $pull: { episodes: { seasonNumber: season, episodeNumber: episode } }, $inc: { totalEpisodes: -1 } }, { new: true })`, populated. Then **always** call `WatchHistoryService.removeEpisodeEverywhere(id, season, episode)`, whether or not the episode was found. Then return the series, or `404` if it wasn't found. Running the cleanup even on `404` is what makes a retry repair a failed cleanup (AC-8).
- `SeriesService.deleteSeries(id)` (existing): add the same `isValidObjectId` → `404` guard; after `findByIdAndDelete`, **always** call `WatchHistoryService.removeSeriesEverywhere(id)`, then return or `404`.
- `WatchHistoryService` (three new methods; `seriesId` is stored as a string in watch history, so the id is passed as a string):
  - `removeEpisodeEverywhere(seriesId, season, episode)`: `updateMany({ 'episodes.seriesId': seriesId }, { $pull: { episodes: { seriesId, seasonNumber: season, episodeNumber: episode } } })`
  - `removeSeriesEverywhere(seriesId)`: `updateMany({ 'episodes.seriesId': seriesId }, { $pull: { episodes: { seriesId } } })`
  - `renameEpisodeEverywhere(seriesId, season, episode, title)`: `updateMany({ 'episodes.seriesId': seriesId }, { $set: { 'episodes.$[e].title': title } }, { arrayFilters: [{ 'e.seriesId': seriesId, 'e.seasonNumber': season, 'e.episodeNumber': episode }] })`
  - All three filter on the existing `episodes.seriesId` index, so only affected users' documents are scanned, and pass `{ timestamps: false }` so a catalog change doesn't bump every affected user's `updatedAt`.
  - `seriesId` is passed as `String(id)` (history stores it as a string); `seasonNumber` and `episodeNumber` are numbers in both places.
- Module wiring: `SeriesModule` imports `WatchHistoryModule` (which already exports `WatchHistoryService`, and imports nothing from series, so there's no cycle).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/series/:id` | PATCH (**new**) | `UpdateSeriesDto` | `{ message, series }` via `toPublicSeries` | bearer, admin | `400`, `401`, `403`, `404`, `409` |
| `/series/:id/access` | PATCH (unchanged contract) | `UpdateSeriesAccessDto` | same as before | bearer, admin | same as before |
| `/series/:id/episodes/:seasonNumber/:episodeNumber` | PATCH (**new**) | path ints (`ParseIntPipe`); `UpdateEpisodeDto` | `{ message, series }` via `toPublicSeries` | bearer, admin | `400`, `401`, `403`, `404` |
| `/series/:id/episodes/:seasonNumber/:episodeNumber` | DELETE (**new**) | path ints (`ParseIntPipe`) | `{ message, series }` via `toPublicSeries` | bearer, admin | `400`, `401`, `403`, `404` |
| `/series/:id` | DELETE (changed) | `id` | `{ message }` | bearer, admin | `401`, `403`, `404` |
| `/series/:id/episodes` | POST (fixed) | `releaseDate` as an ISO string; integer season, episode, duration; trimmed title | unchanged shape; now one atomic update | bearer, admin | `400` (also duplicate episode), `404` |
| `/series` | POST (changed) | trimmed title | unchanged | bearer, admin | duplicate title `409` (was `400`) |

The new episode routes don't clash with `GET .../play` (different method and segment count) or `GET /series/:id/episodes` (different segment count).

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| edit series | new field values | request body, whitelisted and validated by `UpdateSeriesDto` |
| edit series | validated `categoryIds` | `validateCategoryIds` (spec 0003): dedupe, existence check |
| edit series | title conflict | the `title` unique index; `code === 11000` → `409` |
| edit episode | which episode | path `seasonNumber` + `episodeNumber`, matched with `$elemMatch`, updated with the positional `$` |
| edit episode | new history title | `dto.title`, written to watch history with `arrayFilters` on (seriesId, season, episode) |
| delete episode | new `totalEpisodes` | `$inc: -1` in the same atomic update as the `$pull` |
| delete episode | which history entries | watch history `episodes[]` items with the same `seriesId` (string), `seasonNumber`, `episodeNumber` |
| delete episode | the teaser boundary afterwards | unchanged `freeEpisodeCount` applied to the new episode order (spec 0002 rule) |
| delete series | which history entries | watch history `episodes[]` items with the same `seriesId` |
| every response | series shape | `toPublicSeries` (spec 0002 and 0003) |

**Key invariants**:
- `seasonNumber` and `episodeNumber` of an existing episode never change.
- `totalEpisodes` equals `episodes.length` after every add and delete: after this spec both are single atomic updates on the series document (AC-11).
- A successful episode or series delete removes every watch history entry that existed for it at that moment. It can't stop a history entry being written afterwards (a user's app sending progress at the same moment, or for an id that doesn't exist, since `POST /watch-history/add` doesn't check the catalog today); see Follow-up.
- `rating` and `votes` only change through the rating route.
- Every series response goes through `toPublicSeries`; no `videoUrl` leaves the edit routes.

**Security model**: all new and changed write routes require a bearer token and the inline `req.user.role === 'admin'` check (per `AGENTS.md`). The global whitelist strips any field not in the DTO, so computed fields can't be written. No regulated data. Deleting is irreversible by design (no soft delete); the admin UI should confirm before calling it.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path: an admin changes a series' title, categories, and `isPremium` in one `PATCH` and gets them back with `categories`; renames an episode and a user's history shows the new title, verifies **AC-1**, **AC-4**, **AC-5**.
- Delete path: deleting S1E2 of a premium series with `freeEpisodeCount: 3` removes it from a user's "continue watching", `totalEpisodes` drops by one, and S1E4 (now third) becomes free; deleting the series removes all its history entries, verifies **AC-6**, **AC-7**.
- Failure case: a `PATCH` with another series' title → `409`; with `categoryIds: []` → `400`; with `{}` → `400`; a `DELETE` retried after a simulated history failure returns `404` and leaves no ghost entry, verifies **AC-2**, **AC-8**.
- Auth/permission: a non admin gets `403` on every new route, verifies **AC-9**.

## Build plan

1. [x] Thin thread end to end: the shared title rule, the error mapping helper (duplicate key → `409`, validation or cast error → `400`), `UpdateSeriesDto`, `SeriesService.updateSeries` (empty body, id, `categoryIds`, title pre-check, populate), `PATCH /series/:id` with Swagger decorators and the admin check; `createSeries` duplicate title → `409`; `UpdateSeriesAccessDto` null rule and `updateAccess` delegating. Tests: add a `WatchHistoryService` mock provider to `series.service.spec.ts` now (every existing test fails to build without it once step 2 injects it), update the create duplicate test to expect `409`, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-9**.
2. [x] Episode edit: `UpdateEpisodeDto`, `SeriesService.updateEpisode`, `PATCH /series/:id/episodes/:seasonNumber/:episodeNumber`, the `WatchHistoryService.renameEpisodeEverywhere` cascade, and the `SeriesModule` → `WatchHistoryModule` import; tests, satisfies **AC-4**, **AC-5**, **AC-9**.
3. [x] Episode delete: `SeriesService.deleteEpisode`, `WatchHistoryService.removeEpisodeEverywhere`, the `DELETE` route, with the cleanup running on the `404` path too; tests including the retry case, satisfies **AC-6**, **AC-8**, **AC-9**.
4. [x] Series delete cascade: `WatchHistoryService.removeSeriesEverywhere`, the id guard and cascade in `deleteSeries`. Tests: switch the `deleteSeries` tests to valid ObjectIds (with the new guard, `'test-id'` would return `404` for the wrong reason), satisfies **AC-7**, **AC-8**.
5. [x] Atomic add and aligned create rules: `addEpisode` as one `findOneAndUpdate` with `$push` + `$inc`, `CreateEpisodeDto` integer rules, title rule, and `@IsDateString` release date; rewrite the `addEpisode` tests for the new query, and test that an ISO date string is accepted, satisfies **AC-10**, **AC-11**.
6. [x] Regenerate `docs/openapi.json` (`npm run docs:openapi`) so the new routes are in the frontend contract, supports **AC-1**, **AC-4**, **AC-6**.

## Consequences

**Positive**:
- The admin can maintain content entirely through the API.
- Watch history stays truthful: no ghost entries, no stale titles.
- One edit route for a series keeps the admin form to a single save.

**Negative / tradeoffs**:
- Deletes are permanent; there's no undo.
- Every delete and every episode rename writes to all affected users' history documents. That's fine at the current scale (indexed on `episodes.seriesId`), but it grows with the audience.
- Deleting an early episode of a premium series makes one previously paid episode free (the boundary shifts). This is the intended rule, but an admin could be surprised.
- No transactions: a failure between the series write and the history write leaves ghosts until the same `DELETE` is retried (AC-8 makes the retry safe).
- Two admins editing the same series at once: the last write wins.

**Neutral**:
- `SeriesModule` now depends on `WatchHistoryModule`.

## Follow-up

- [ ] `POST /watch-history/add` accepts any `seriesId` and episode numbers without checking the catalog, and uses a read, modify, `save()` that can race with the cleanup. Checking that the episode exists, and making the add atomic, would close the last way a ghost entry can appear.
- [ ] Deleting an episode and later re-adding the same (season, episode) numbers, then retrying the old delete, would clean the new episode's history too. Rare enough to accept.
- [ ] Image Upload (scope feature 14) will provide real URLs for `coverImage`, `bannerImage`, and category images; today they're free strings.
- [ ] The boot warning "Duplicate schema index on {"title":1}" comes from `SeriesSchema.index({ title: 1 })` duplicating the `unique: true` index on `title`; that extra line can be removed.
- [ ] A bulk "move all series from category A to B" admin action would make deleting a category (spec 0003 `CATEGORY_IN_USE`) easier; not needed yet.
- [ ] `docs/api-reference.md` should gain the new routes when this ships.
