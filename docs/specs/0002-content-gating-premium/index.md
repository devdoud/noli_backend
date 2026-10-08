# 0002. Content gating for premium

**Date**: 2026-09-30
**Status**: Accepted

## Summary

This decides how Noli keeps premium episodes for paying users while keeping a real free tier. A series is free or premium, and a premium series can leave its first few episodes free as a teaser. Today every episode's video link is handed out by public endpoints, so the fix is to stop the links leaking from the catalog and make one new signed in "play" endpoint the only place a link comes from, checked against the user's subscription at that moment.

## Requirements

**User stories**:
- As a free user, I want to watch free series and the teaser episodes of premium series, so I can decide whether premium is worth paying for.
- As a free user, I want a clear signal when something is premium, so I know why I can't play it and how to unlock it.
- As a premium user, I want to play everything, and keep access until my paid period (plus grace) really ends.
- As an admin, I want to mark a series premium and choose how many teaser episodes stay free.

**Acceptance criteria**:
- **AC-1**: For a series with `isPremium = false`, any signed in user gets `200` and the episode's `videoUrl` from `GET /series/:id/episodes/:seasonNumber/:episodeNumber/play`.
- **AC-2**: For a series with `isPremium = true`, an episode whose position in (season, episode) order across the whole series is within the first `freeEpisodeCount` is playable by any signed in user. Any other episode returns `403` with body `{ statusCode: 403, code: 'PREMIUM_REQUIRED', message }` for a user without premium access.
- **AC-3**: A user has premium access when, at request time, `subscription.plan === 'premium'`, `subscription.isActive === true`, and `subscription.endDate + 1 day grace > now`. Users with `role === 'admin'` always have access. A user with premium access can play every episode.
- **AC-4**: The play endpoint requires a valid access token (`401` without one). A malformed or unknown series id, or an episode that doesn't exist in the series, returns `404`. A non integer season or episode number returns `400`.
- **AC-5**: `videoUrl` appears in no response other than the play endpoint, for any caller including admins: not in `GET /series/:id`, `GET /series/:id/episodes`, `POST /series/:id/rate`, `POST /series`, `POST /series/:id/episodes`, `PATCH /series/:id/access`, or any `/recommendations/*` route. All `/recommendations/*` routes return series without `episodes`.
- **AC-6**: Every series in every response carries `isPremium` and `freeEpisodeCount`. Each episode in any response carries a derived `isFree` boolean, and `GET /series/:id/episodes` lists episodes in (season, episode) order.
- **AC-7**: An admin can set `isPremium` and `freeEpisodeCount` in `POST /series` and change them with `PATCH /series/:id/access`. A non admin gets `403`. `freeEpisodeCount` must be an integer ≥ 0, else `400`. A PATCH body with neither field returns `400`. Changes apply to the next request, with no caching.
- **AC-8**: Every series that existed before this feature ships is stored with `isPremium: false` and `freeEpisodeCount: 0` (a real field in the database, not just a schema default, because `.lean()` reads skip defaults). The backfill runs with the deploy and is safe to run again.

## Decision

**Chosen option**: Option 1, a gated play endpoint with `videoUrl` removed from the catalog.

Content access is decided in one pure helper and enforced in one endpoint. The catalog only ever says *whether* something is free, never gives out the link.

## Rationale

Reasoning and options considered: see `rationale.md`.

## Feature design

**Data model sketch**:

*`Series`* (existing, extended):
- `isPremium`: `boolean`, required, default `false`
- `freeEpisodeCount`: `number`, integer ≥ 0, required, default `0`. Only meaningful when `isPremium` is `true`. May exceed the number of episodes (then every episode is free).

*`Episode`* (embedded, unchanged). `isFree` is derived at read time, never stored.

*`User.subscription`* (unchanged, read only here): `plan`, `isActive`, `endDate`, from spec 0001.

**Derived rules** (one pure module, `src/series/content-access.ts`, no database access):
- `sortEpisodes(episodes)`: a copy sorted by (`seasonNumber`, `episodeNumber`) ascending. The only ordering used anywhere (lists and the free rule). Ties can't occur: `addEpisode` already rejects a duplicate (season, episode) pair.
- `isEpisodeFree(series, seasonNumber, episodeNumber)`: `true` if `!series.isPremium` (a missing flag counts as free, matching the backfill); else the episode's zero based index in `sortEpisodes(series.episodes)` is `< series.freeEpisodeCount`. The count runs across the whole series, not per season.
- `hasPremiumAccess(user, now)`: `true` if `user.role === 'admin'`; else `user.subscription?.plan === 'premium' && user.subscription?.isActive === true && user.subscription?.endDate != null && endDate.getTime() + BILLING_GRACE_PERIOD_MS > now.getTime()`. `BILLING_GRACE_PERIOD_MS` is imported from `src/billing/billing.constants.ts` so the grace can't drift from spec 0001. Optional chaining covers old users with no `subscription`.
- `canPlay = isEpisodeFree(...) || hasPremiumAccess(...)`.
- `toPublicSeries(series)`: takes a **plain object** (`.lean()` result or `doc.toObject()`, never a hydrated document, whose subdocuments serialize through `toJSON` and would keep `videoUrl`), returns the series with `episodes` (when present) sorted, each mapped to `{ ...episode, isFree }` minus `videoUrl`. Every series response in the series module passes through it.

**State transitions**: none. Access is computed per request from the series flags and the subscription state that spec 0001 maintains.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/series/:id/episodes/:seasonNumber/:episodeNumber/play` | GET (**new**) | path: `id` (ObjectId), `seasonNumber`, `episodeNumber` (`ParseIntPipe`) | `{ message, data: { seriesId, seasonNumber, episodeNumber, title, duration, videoUrl } }` | bearer | `401`; `403 { statusCode: 403, code: 'PREMIUM_REQUIRED', message }`; `404` malformed or unknown series id (checked with `isValidObjectId` before querying), or episode not in series; `400` non integer season/episode |
| `/series/:id/access` | PATCH (**new**) | body `UpdateSeriesAccessDto`: `isPremium?: boolean`, `freeEpisodeCount?: int ≥ 0` (`@IsInt @Min(0)`); neither present → `400` | `{ message, series }` via `toPublicSeries` | bearer, admin (inline role check per `AGENTS.md`) | `401`, `403`, `404`, `400` |
| `/series` | POST (changed) | `CreateSeriesDto` gains `isPremium?: boolean`, `freeEpisodeCount?: int ≥ 0` | `series` via `toPublicSeries` | bearer, admin | `400` invalid `freeEpisodeCount` |
| `/series/:id/episodes` | POST (changed) | unchanged | `series` via `toPublicSeries` | bearer, admin | unchanged |
| `/series/:id/rate` | POST (changed) | unchanged | `series` via `toPublicSeries` (closes a leak: any signed in user could read every `videoUrl` here) | bearer | unchanged |
| `/series/:id` | GET (changed) | unchanged | `series` via `toPublicSeries` | public | unchanged |
| `/series/:id/episodes` | GET (changed) | unchanged | episodes in (season, episode) order, `isFree` computed over the full sorted list **before** paginating, no `videoUrl` | public | unchanged |
| `/recommendations/*` (7 routes) | GET (changed) | unchanged | series without `episodes`, with `isPremium`, `freeEpisodeCount` | unchanged | unchanged |

Recommendations detail: add `.select('-episodes')` to the returned queries of `getRecommendations` (including its fallback to `getPopularSeries`), `getPopularSeries`, `getTrendingNow`, `getTopRatedSeries`, `getNewSeries`, `getGenreRecommendations`, and the `similar` query in `getSimilarSeries`. Leave the internal reads (the source series in `getSimilarSeries`, the watched series in `getRecommendations`) alone; they read genres and are never returned. Existing recommendation specs that mock the query chain need the extra `.select` step.

`GET /series`, `/series/search`, `/series/genre/:genre`, `/series/trending` already exclude `episodes`; they gain `isPremium` and `freeEpisodeCount` through the schema and backfill, with no code change.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| play | who is calling | `req.user`, the full User document loaded fresh by `JwtStrategy.validate` on each request (so the subscription is never stale) |
| play | whether the caller has premium access | `hasPremiumAccess(req.user, new Date())`, from `req.user.role` and `req.user.subscription.{plan,isActive,endDate}` |
| play | the grace window | `BILLING_GRACE_PERIOD_MS` in `src/billing/billing.constants.ts` (spec 0001) |
| play | whether the episode is free | `isEpisodeFree` from `Series.isPremium`, `Series.freeEpisodeCount`, and the episode's position in `Series.episodes` sorted by (season, episode) |
| play | `videoUrl`, `title`, `duration` | the matched `Series.episodes` entry |
| play | the upgrade signal | the constant code `PREMIUM_REQUIRED` in the `403` body |
| episode lists | `isFree` per episode | `isEpisodeFree`, same inputs, caller independent; `getEpisodes` must select `episodes isPremium freeEpisodeCount` (today it selects only `episodes`, which would make every episode look free) |
| episode lists | episode order | `sortEpisodes`, (season, episode) ascending |
| PATCH access | new flag values | request body, validated by `UpdateSeriesAccessDto`, written by a dedicated service method (`$set` of only these two fields with `runValidators`), never the existing loose `updateSeries(id, any)` |
| backfill | values for existing series | constants `false` and `0` (engineer's decision: existing series become free) |

**Key invariants**:
- `videoUrl` is returned by exactly one endpoint, the play endpoint, and only when `canPlay` is true. Every other series response in the series module goes through `toPublicSeries`.
- One ordering, `sortEpisodes`, is used for both listing and the free rule.
- Whether an episode is free is never stored; it's always derived from the series flags and episode order.
- The access rule reads the subscription at request time; nothing caches it.
- A premium subscription with no `endDate` grants nothing (fail closed).
- Catalog responses don't depend on who is calling.

**Security model**: browsing the catalog stays public and reveals only metadata plus `isPremium`/`isFree`. Getting a video link requires a signed in user and passes the access rule. Changing the flags is admin only, using the project's existing inline `req.user.role === 'admin'` check. Known limit: a link handed to an entitled user can be shared and keeps working, because links are plain URLs until hosting is decided (Follow-up). No regulated data is involved.

**Configuration required**: none. The grace period comes from spec 0001's constants.

**Critical test scenarios**:
- Happy path: a free user plays a free series episode and a premium teaser episode (200 with `videoUrl`), verifies **AC-1**, **AC-2**.
- Failure case: a free user requests episode 4 of a premium series with `freeEpisodeCount: 3` and gets `403 PREMIUM_REQUIRED`; a user whose `endDate` is 2 days past (beyond grace) is refused while `isActive` is still `true` because the cron hasn't run, verifies **AC-2**, **AC-3**.
- Leak check: no response from `GET /series/:id`, `GET /series/:id/episodes`, `POST /series/:id/rate`, the admin create and add episode routes, or any `/recommendations/*` route contains `videoUrl`, verifies **AC-5**.
- Ordering: on a two season series with `freeEpisodeCount: 2`, `GET /series/:id/episodes` lists S1E1, S1E2, S2E1 in that order with `isFree` true, true, false, including when paginated with `limit=1`, verifies **AC-2**, **AC-6**.
- Auth/permission: signed out play gets `401`; a non admin `PATCH /series/:id/access` gets `403`, verifies **AC-4**, **AC-7**.

## Build plan

1. [x] Add `isPremium` and `freeEpisodeCount` to the `Series` schema (`@Prop` fields; the inline episodes `type` array is untouched); write an idempotent backfill script (`scripts/backfill-series-access.ts`, `updateMany({ isPremium: { $exists: false } }, …)`) and an npm script `db:backfill-series-access` to run it; run it against the target database and confirm with a query that no series lacks the fields. It must run with the deploy, before list responses are relied on, satisfies **AC-8**, **AC-6**.
2. [x] Add the pure module `src/series/content-access.ts` (`sortEpisodes`, `isEpisodeFree`, `hasPremiumAccess`, `canPlay`, `toPublicSeries`), importing the grace constant from billing, with unit tests for multi season ordering, the teaser boundary, grace, a missing `endDate`, a missing `subscription`, admin, and `videoUrl` removal, satisfies **AC-2**, **AC-3**, **AC-5**.
3. [x] Thin thread end to end: the play route (`ParseIntPipe` on season and episode, `isValidObjectId` → `404`), its service method (load the series as a plain object with `episodes isPremium freeEpisodeCount`, find the episode, apply `canPlay`, return the link or throw `new ForbiddenException({ statusCode: 403, code: 'PREMIUM_REQUIRED', message: 'Premium subscription required' })`), Swagger decorators including the `403` shape, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**.
4. [x] Close the leaks in the series module: `GET /series/:id`, `POST /series/:id/rate`, `POST /series`, and `POST /series/:id/episodes` return `toPublicSeries(...)`; `getEpisodes` selects the two flags, sorts with `sortEpisodes`, computes `isFree` over the full list, then paginates, satisfies **AC-5**, **AC-6**.
5. [x] Close the leak in recommendations: `.select('-episodes')` on the seven returned query paths listed above, and update the affected mocks, satisfies **AC-5**, **AC-6**.
6. [x] Admin control: extend `CreateSeriesDto` (`@IsBoolean`, `@IsInt @Min(0)`), add `UpdateSeriesAccessDto` and `PATCH /series/:id/access` with the inline admin check, a `400` when both fields are absent, and a dedicated `updateAccess` service method, satisfies **AC-7**.
7. [x] Regenerate `docs/openapi.json` (`npm run docs:openapi`) so the frontend contract shows the new endpoint and the removed field, supports **AC-5**.

## Consequences

**Positive**:
- One place hands out video links, so signed URLs or view counting later change one endpoint.
- Catalog responses get lighter (recommendations no longer ship every episode) and stay cacheable.
- Access ends at the exact moment a subscription lapses, not at the next cron run.

**Negative / tradeoffs**:
- **Breaking change**: any client reading `videoUrl` from episode lists or recommendations breaks and must call the play endpoint. The frontend isn't built yet, so the cost is low now and grows later.
- One extra request per play.
- Links are shareable once handed out; this gates the handout, not the link.
- Inserting an episode earlier in the order shifts which episodes fall inside the free teaser count. This is intended, but an admin could be surprised by it.

**Neutral**:
- First code outside `src/billing/` to depend on spec 0001's constants and subscription fields.

## Follow-up

- [ ] Signed, expiring video links once video hosting is decided (needs its own `/architect`); the play endpoint is the single place to change.
- [ ] Offline Downloads (scope feature 10) should reuse `hasPremiumAccess` rather than re-implementing the rule.
- [ ] `docs/api-reference.md` still says episodes carry `videoUrl`; update it when this ships (or let `/sync` flag it).
- [ ] `POST /watch-history/add` still accepts progress for episodes the user can't play. Not a leak (no link is returned), so left alone here.
- [ ] Other series routes still turn a malformed id into a `500` (a Mongoose cast error). This spec fixes it only on the play route; a shared id pipe would fix the rest.
