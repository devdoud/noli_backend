# 0003. Categories

**Date**: 2026-09-30
**Status**: Accepted

## Summary

This replaces the free text genres on series with a real list of categories that an admin manages: a name, a stable URL slug, an optional image, a display order, and a visible or hidden switch. A series belongs to one or more categories, and the app browses, recommends, and labels series through them. The series collection is empty today, so this is the cheapest moment to make the switch; a small migration script still covers any environment that already has genres.

## Requirements

**User stories**:
- As a viewer, I want to browse series by category, so I can find something in the mood I'm in.
- As a viewer, I want each series card to show its categories, so I know what kind of show it is at a glance.
- As an admin, I want to create, rename, hide, reorder, and remove categories, so the catalog stays tidy without typos or duplicates.
- As an admin, I want to file each series under one or more categories when I create it.

**Acceptance criteria**:
- **AC-1**: An admin `POST /categories` with a `name` creates a category whose `slug` and `nameKey` are `slugify(name)`, placed after the current last category, visible by default. A name whose `nameKey` already exists returns `409` (including when two identical creates race: a duplicate key error is mapped to `409`, never `500`). A name whose slug is empty or reserved (`all`, `order`) returns `400`.
- **AC-2**: An admin `PATCH /categories/:id` can change `name`, `description`, `imageUrl`, `isVisible`, and `slug`; `description` and `imageUrl` can be cleared with `null`. Renaming recomputes `nameKey` but keeps `slug`. An explicit `slug` must match `^[a-z0-9]+(-[a-z0-9]+)*$` and not be reserved (`400`). A `nameKey` or `slug` already used by another category returns `409` naming which one. A body with no known field returns `400`.
- **AC-3**: An admin `PUT /categories/order` with `{ ids }` listing **every** category id exactly once (hidden ones included; `[]` when there are none) sets `displayOrder` to each id's 0 based position. Missing, unknown, or duplicate ids return `400` and change nothing.
- **AC-4**: An admin `DELETE /categories/:id` removes a category no series uses. If series still use it, it returns `409` with body `{ statusCode: 409, code: 'CATEGORY_IN_USE', message, seriesCount }` and deletes nothing.
- **AC-5**: `GET /categories` (public) returns visible categories only, sorted by `displayOrder`, then `createdAt`, then `_id`. `GET /categories/:slug` returns a visible category, else `404`. `GET /categories/all` (admin) returns every category including hidden ones; a non admin gets `403`.
- **AC-6**: `GET /categories/:slug/series` (public) returns the series in a visible category, paginated `{ total, page, limit, series }`, newest first by default or best rated first with `?sort=rating`, with a final `_id` tiebreak so pages never skip or repeat a series. `page` and `limit` must be integers ≥ 1 and `limit` ≤ 50, `sort` must be `newest` or `rating`, else `400`. An unknown or hidden slug returns `404`. Series come without `episodes`.
- **AC-7**: `POST /series` requires `categoryIds` with at least one id; every id must exist (hidden categories allowed), else `400` listing the unknown ids; duplicate ids are merged. `genres` is no longer accepted or stored (silently stripped by the global whitelist).
- **AC-8**: Every series in every response carries `categories: [{ _id, name, slug }]` listing its **visible** categories only (an empty array is legal when all of them are hidden), and carries neither `genres` nor `categoryIds`. This covers single series routes, the write routes (`POST /series`, add episode, rate, access), every list route (`GET /series`, search, trending, category browsing), and every recommendation route.
- **AC-9**: Recommendations use categories: personalized and similar picks match on shared categories, and `GET /recommendations/category/:slug` replaces `GET /recommendations/genre/:genre`. `GET /series/genre/:genre` and `GET /recommendations/genre/:genre` no longer exist.
- **AC-10**: `npm run db:migrate-genres-to-categories` turns every distinct existing genre into a category (reusing one with the same `nameKey`; genres that slugify to empty are skipped and reported), sets each series' `categoryIds` from its genres, and removes `genres`. Running it again changes nothing. It prints the ids of any series left with no category and does not invent one.

## Decision

**Chosen option**: a managed `Category` collection, referenced from `Series.categoryIds`, replacing genres everywhere.

Categories are their own documents with a stable slug. Series hold a list of category ids. Every series response, single or list, is built through the shared mapper from spec 0002, which now also turns the populated ids into a small `categories` list.

## Rationale

Reasoning and options considered: see `rationale.md`.

## Feature design

**Data model sketch**:

*`Category`* (new collection, `src/categories/schemas/category.schema.ts`, `timestamps: true`):
- `name`: `string`, required, trimmed, 1 to 50 chars
- `nameKey`: `string`, required, **unique index**. `slugify(name)`; recomputed on every rename. Blocks near duplicates ("Comédie" vs "comedie").
- `slug`: `string`, required, **unique index**, pattern `^[a-z0-9]+(-[a-z0-9]+)*$`, not in `RESERVED_SLUGS = ['all', 'order']`. Set to `slugify(name)` at creation; changes only when an admin sends a new `slug`.
- `description`: `string | null`, optional, ≤ 300 chars
- `imageUrl`: `string | null`, optional, a URL (`@IsUrl`)
- `displayOrder`: `number`, integer ≥ 0, required, indexed, **not unique**
- `isVisible`: `boolean`, required, default `true`
- `createdAt`, `updatedAt`

*`Series`* (changed):
- `categoryIds`: `Types.ObjectId[]` ref `Category`, required, schema validator `length >= 1`, **indexed** (`{ categoryIds: 1 }`, used by browsing and the in-use count). Replaces `genres`.
- `genres` and its index: **removed** from the schema.

Relationship: Series N to M Category, stored as ids on the series side.

**Module wiring**:
- `CategoriesModule` (`src/categories/`) registers `Category` and `Series` with `MongooseModule.forFeature` (it needs `Series` for browsing and the in-use count), and **exports** `MongooseModule` so the `Category` model is available elsewhere.
- `SeriesModule` and `RecommendationsModule` import `CategoriesModule`. Mongoose resolves populate by model name, so without this registration populate throws `MissingSchemaError`.
- Recommendations call the category lookup by slug directly on the `Category` model (no service cycle).

**Shared helpers** (in `src/series/content-access.ts` unless noted):
- `slugify(text)` in `src/categories/slugify.ts`: `text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')`. The combining mark range is written with `\u` escapes, not literal characters. No new dependency.
- `CATEGORY_POPULATE = { path: 'categoryIds', select: 'name slug', match: { isVisible: true } }`. On an array path, populate with `match` **removes** non matching and missing ids from the array (it does not leave `null`), so hidden and dangling categories simply vanish.
- `toPublicSeries(series): PublicSeries` (return type changed from the generic `T`): converts a hydrated document with `toObject()`, then **first** builds `categories` from `categoryIds`, keeping only elements that are populated objects with a `name` (a raw ObjectId is dropped, never echoed), and deletes `categoryIds` and `genres`; **then** applies the spec 0002 episode logic (`videoUrl` removal, `isFree`) only when `episodes` is an array. The category step must not sit behind the episodes early return.
- `toPublicSeriesList(list)`: `list.map(toPublicSeries)`.

**Where populate and mapping happen** (the full list, so no path is missed):
- Reads in `SeriesService`: `getAllSeries`, `searchSeries`, `getTrendingSeries`, `getSeriesById`, `getEpisodes` (no categories needed there, unchanged) add `.populate(CATEGORY_POPULATE)`.
- Writes in `SeriesService`: `createSeries`, `addEpisode`, `rateSeries`, `updateAccess` end by re-reading the saved series with `findById(id).populate(CATEGORY_POPULATE)` and returning that.
- `SeriesController` maps single series with `toPublicSeries` (already the case for spec 0002) and lists with `toPublicSeriesList` inside their existing envelopes (`data.series`, `series`).
- `CategoriesService.getSeriesInCategory` populates and returns `toPublicSeriesList` inside `{ total, page, limit, series }`.
- Every `RecommendationsService` method that returns series (personalized, **including its popular fallback**, popular, trending, top rated, new, similar, category) adds `.populate(CATEGORY_POPULATE)`, and the recommendations controller wraps each result in `toPublicSeriesList`.
- `SeriesService.updateSeries(id, any)` is **deleted**: it's unrouted and would allow writing `genres` or `categoryIds` without validation.

**State transitions**: a category is visible or hidden (`isVisible`), freely toggled by an admin. Deletion is only possible from "no series uses it".

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/categories` | GET (**new**) | none | `{ message, categories }` visible, ordered | public | none |
| `/categories/all` | GET (**new**, declared before `:slug`) | none | `{ message, categories }` all, ordered | bearer, admin | `401`, `403` |
| `/categories/:slug` | GET (**new**) | `slug` | `{ message, category }` | public | `404` unknown or hidden |
| `/categories/:slug/series` | GET (**new**) | `slug`; `CategorySeriesQueryDto`: `page` (`@Type(() => Number) @IsInt @Min(1)`, default 1), `limit` (`@IsInt @Min(1) @Max(50)`, default 10), `sort` (`@IsIn(['newest', 'rating'])`, default `newest`) | `{ message, data: { total, page, limit, series } }` | public | `400`, `404` |
| `/categories` | POST (**new**) | `CreateCategoryDto`: `name` (req), `description?`, `imageUrl?`, `isVisible?` | `{ message, category }` | bearer, admin | `400`, `401`, `403`, `409` |
| `/categories/order` | PUT (**new**) | `ReorderCategoriesDto`: `ids` (`@IsArray @ArrayUnique @IsMongoId({ each: true })`) | `{ message, categories }` freshly read in the new order | bearer, admin | `400`, `401`, `403` |
| `/categories/:id` | PATCH (**new**) | `UpdateCategoryDto`: `name?`, `description?` (string or `null`), `imageUrl?` (URL or `null`), `isVisible?`, `slug?` | `{ message, category }` | bearer, admin | `400`, `401`, `403`, `404`, `409` |
| `/categories/:id` | DELETE (**new**) | `id` | `{ message }` | bearer, admin | `401`, `403`, `404`, `409 CATEGORY_IN_USE` |
| `/series` | POST (changed) | `CreateSeriesDto`: `categoryIds: string[]` (`@IsArray @ArrayMinSize(1) @IsMongoId({ each: true })`) replaces `genres` | series with `categories` | bearer, admin | `400` unknown ids |
| all other series routes | changed | unchanged | each series gains `categories`, loses `genres` | unchanged | unchanged |
| `/series/genre/:genre` | GET | **removed** | | | |
| `/recommendations/category/:slug` | GET (**new**, replaces `/recommendations/genre/:genre`) | `slug`; query `limit` | `{ message, data: series[] }` best rated first | public | `404` unknown or hidden |
| `/recommendations/*` (the others) | changed | unchanged | series with `categories` | unchanged | unchanged |

Every `:id` param on the new category routes is checked with `isValidObjectId` first (malformed → `404`, never `500`). Existing series routes keep their current id handling; that gap is tracked in spec 0002's Follow-up.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| create or rename category | `nameKey` | `slugify(dto.name)`; empty → `400` |
| create category | `slug` | `slugify(dto.name)`; reserved → `400`; never recomputed on rename |
| create category | `displayOrder` | current highest `displayOrder` + 1, or `0` when there are no categories |
| update category | new `slug` | `dto.slug`, pattern, reserved list, uniqueness |
| create or update, concurrent duplicate | the `409` | a `MongoServerError` with `code === 11000`, told apart by `keyPattern` (`nameKey` or `slug`) |
| update category | "no known field" | checked after the global whitelist strips unknown keys |
| reorder | each `displayOrder` | the id's index in `dto.ids`; `bulkWrite` only after checking `dto.ids` has exactly the ids of `Category.find({}, { _id: 1 })` |
| delete | `seriesCount` in the `409` | `Series.countDocuments({ categoryIds: id })` |
| list categories | order | sort `{ displayOrder: 1, createdAt: 1, _id: 1 }` |
| browse category | series and total | filter `{ categoryIds: category._id }`; `countDocuments` for `total`; `find(...).select('-episodes').populate(CATEGORY_POPULATE)`, sort `{ createdAt: -1, _id: -1 }` or `{ rating: -1, votes: -1, _id: -1 }`, then `skip`/`limit` |
| any series response | `categories` | populated `categoryIds`, mapped by `toPublicSeries` |
| create series | validated `categoryIds` | `dto.categoryIds` deduplicated as strings; `Category.find({ _id: { $in } })` must return every id (hidden allowed), else `400` naming the missing ones |
| personalized recommendations | categories to match | the **unpopulated** `categoryIds` (all, hidden included) of the series whose ids appear in the watch history, read with `find({ _id: { $in: watchedIds } }, { categoryIds: 1 }).lean()`; watched ids are strings from `WatchHistory.seriesId`, invalid ones filtered with `isValidObjectId` before querying; deleted series are simply absent |
| similar series | categories to match | the source series' unpopulated `categoryIds` |
| category recommendations | the category | visible category found by `slug`, else `404` |
| migration | category per genre | existing category with `nameKey === slugify(genre)`, else a new visible one appended to the order in alphabetical order of genre |

**Key invariants**:
- Every stored series has at least one `categoryId` (schema validator plus DTO). A genre-less series found by the migration is reported, not fixed silently.
- `nameKey` and `slug` are each unique across categories.
- A category with series attached can't be deleted.
- No series response exposes `categoryIds`, `genres`, or a hidden category's name.
- `displayOrder` only grows on create and is rewritten as a full `0..n-1` sequence by reorder. Between reorders it may have gaps (after a delete) or ties (two creates at the same moment); ties are ordered by `createdAt`, then `_id`.

**Security model**: reading categories and browsing by category are public, like the rest of the catalog. Every write (`POST`, `PATCH`, `PUT /order`, `DELETE`) and the hidden-including list require a bearer token and the inline `req.user.role === 'admin'` check, per `AGENTS.md`. `imageUrl` must be a URL; the app renders it, the backend never fetches it. No regulated data.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path: an admin creates "Comédie romantique" → slug `comedie-romantique`, placed last; a series created with it shows `categories: [{ name: 'Comédie romantique', slug: 'comedie-romantique' }]` on `GET /series`, `GET /series/:id`, `POST /series/:id/rate`, and in `GET /categories/comedie-romantique/series`, verifies **AC-1**, **AC-6**, **AC-7**, **AC-8**.
- Failure case: creating "comedie romantique" after "Comédie romantique" → `409`; a category named "All" → `400`; deleting a category with 3 series → `409 CATEGORY_IN_USE, seriesCount: 3`; a reorder missing one id → `400` and no order change; `?page=abc` → `400`, verifies **AC-1**, **AC-3**, **AC-4**, **AC-6**.
- Visibility: hiding a category removes it from `GET /categories`, makes `GET /categories/:slug` and its series route `404`, and removes it from every series' `categories`, while `GET /categories/all` still shows it to an admin and personalized recommendations still match on it, verifies **AC-5**, **AC-8**, **AC-9**.
- Recommendation fallback: a user with no watch history gets the popular fallback, and those series still carry `categories`, verifies **AC-8**.
- Auth/permission: a non admin gets `403` on every write route and on `/categories/all`, verifies **AC-5**.

## Build plan

1. [x] Thin thread end to end: `Category` schema, `slugify` and `RESERVED_SLUGS`, `CategoriesModule` (registering `Category` and `Series`, exporting `MongooseModule`) with `POST /categories` (admin, duplicate key → `409`) and `GET /categories` (public), Swagger decorators, unit tests for `slugify` (accents, spaces, punctuation, empty, reserved) and the create error paths, satisfies **AC-1**, **AC-5**.
2. [x] Switch series to categories: schema (`categoryIds` in, `genres` out), `CreateSeriesDto`, id validation and dedupe in `createSeries`, import `CategoriesModule` in `SeriesModule`, `CATEGORY_POPULATE` on every read listed above, re-read with populate after every write listed above, `toPublicSeries` building `categories` before the episodes step, `toPublicSeriesList` on every list route, delete `updateSeries` and `getSeriesByGenre` plus its route. Rewrite the affected tests: `series.service.spec.ts` mock chains gain `populate` (and write paths mock the re-read), `series.controller.spec.ts` drops the genre test and `genres` fixtures, satisfies **AC-7**, **AC-8**, **AC-9**.
3. [x] Browsing: `GET /categories/:slug`, `GET /categories/:slug/series` with `CategorySeriesQueryDto`, and admin `GET /categories/all`, static routes declared before `:slug`, satisfies **AC-5**, **AC-6**.
4. [x] Admin management: `PATCH /categories/:id` (including `null` clears and "no known field" → `400`), `PUT /categories/order`, `DELETE /categories/:id` with `CATEGORY_IN_USE`, satisfies **AC-2**, **AC-3**, **AC-4**.
5. [x] Recommendations on categories: import `CategoriesModule`, personalized (unpopulated category read, invalid watched ids filtered, fallback populated and mapped) and similar picks on `categoryIds`, `GET /recommendations/category/:slug` replacing the genre route, populate on every returned list and `toPublicSeriesList` in the controller. Rewrite `recommendations.service.spec.ts` (mock chains gain `populate`, `genres` fixtures and the `{ genres }` assertion replaced), and add a test that the fallback result carries `categories`, satisfies **AC-8**, **AC-9**.
6. [x] Migration: `scripts/migrate-genres-to-categories.ts` using the native collection driver (the schema no longer knows `genres`), `npm run db:migrate-genres-to-categories`; run it against the database, run it again to confirm no change, confirm with a query that no series still has `genres`, satisfies **AC-10**.
7. [x] Regenerate `docs/openapi.json` (`npm run docs:openapi`) and check the genre routes are gone and the category routes are present, supports **AC-9**.

## Consequences

**Positive**:
- No more typos or near duplicate genres; the catalog is organized by a list the admin controls and orders.
- Category URLs stay stable across renames.
- Browsing and recommendations share one classification.
- Every series response now goes through one mapper, lists included, which also makes future shape changes one edit.

**Negative / tradeoffs**:
- Breaking change: `genres` disappears from every response and from `POST /series`, and two genre routes are removed. No frontend uses them yet.
- Every series response now costs one extra query (the populate) for category names.
- Deleting a category needs its series moved first; there's no bulk "move series to another category" tool yet.
- No transactions (the database may not be a replica set): a reorder can be overtaken by a create landing between the check and the write, and a category deleted at the moment a series is created in it leaves a dangling id. Both are admin only and unlikely; the dangling id is dropped by the mapper, and the next reorder or edit repairs order and links.

**Neutral**:
- New `src/categories/` module; the series and recommendations modules now depend on it.

## Follow-up

- [ ] Series & Episode Management (scope feature 13) must let an admin change a series' `categoryIds`, with the same validation as create, and must re-read with populate like the other writes.
- [ ] Image Upload (scope feature 14) will fill `Category.imageUrl`.
- [ ] Home Feed (scope feature 9) can build its "by category" rails from `GET /categories` and the category browse query.
- [ ] `RecommendationsQueryDto.limit` uses `@IsNumber` on a query string without implicit conversion and has no upper cap; worth the same treatment as `CategorySeriesQueryDto` in a later pass.
- [ ] `docs/api-reference.md` still documents genres; update it when this ships.
