# Review, content gating for premium (spec 0002, with spec 0006 extensions), 2026-10-01

**Reviewed by**: Sonnet 5.5 fresh-context reviewer (author on unknown model)
**Scope**: 17 source files plus 5 spec files, uncommitted (repo has no commits; files read in full)
**Verdict**: Approve with nits

## Summary
The change makes `GET .../play` the only route that returns a video link, decides access in one pure module (position based `isEpisodeFree`, live `hasPremiumAccess` with grace, fail closed), and routes every series response through `toPublicSeries` or `toAdminSeries`. I traced every route listed in the scope and found no gating bypass: all viewer shapes drop the video fields, the unplayable-episode 404 comes before the 403, and every `toAdminSeries` site is behind an admin check. Remaining findings are minor hardening and consistency items.

## Minor
### 🟡 Malformed series id returns 500 on public and rate routes, `src/series/series.service.ts:627`
**Problem**: `getSeriesById`, `getEpisodes` (line 831) and `rateSeries` (line 990) call `findById` with no `isValidObjectId` check, as does `getSimilarSeries` in recommendations. A bad id raises a Mongoose CastError, surfaced as 500. Only `/play` was fixed (the spec follow-up acknowledges the rest).
**Why it matters**: unauthenticated callers can trigger 500s and noisy error logs; clients get no 404.
**Suggested fix**: add the same `isValidObjectId` to 404 guard on these paths, ideally via a shared pipe.

### 🟡 Unvalidated `page` and `limit` on viewer routes, `src/series/series.controller.ts:229`
**Problem**: `page`/`limit` are bare `@Query` numbers. `getEpisodes` slices with them directly: a negative `page` gives a negative `skip`, so `slice` returns an unrelated window; a huge `limit` is unbounded, and `getAllSeries`/`searchSeries` pass NaN straight to Mongo (500).
**Why it matters**: wrong teaser windows, 500s, and no cap on page size for a public catalog.
**Suggested fix**: validate with a query DTO (`@IsInt @Min(1)`, `@Max` on limit), as the recommendations routes already do.

### 🟡 `rateSeries` accepts a missing or non numeric rating, `src/series/series.service.ts:985`
**Problem**: the body is an untyped `{ rating: number }`, so `undefined` or a string slips past `< 0 || > 10` (comparisons with NaN are false), then NaN is saved and Mongoose throws a cast error (500). Swagger says max 5, the service allows 10. Ratings are also unlimited per user and non atomic (read, compute, save).
**Why it matters**: a signed in user can 500 the route; the contract is inconsistent. Not a gating issue, but this route was in scope as a former leak.
**Suggested fix**: add a DTO with `@IsNumber @Min(0) @Max(5)` (or 10; pick one and align Swagger); consider an atomic update.

### 🟡 `totalEpisodes` differs between list and detail, `src/series/content-access.ts:257`
**Problem**: with `playableOnly`, `GET /series/:id` overwrites `totalEpisodes` with the playable count, while list, search, trending and recommendations return the stored count (which `addEpisode` increments for episodes without a video).
**Why it matters**: a card can say 10 episodes while the detail page lists 6, and the free teaser counts only playable ones, so the numbers visibly disagree.
**Suggested fix**: pick one meaning for viewers (playable count) and apply it to list shapes, or document the difference.

### 🟡 `isPremium`/`freeEpisodeCount` are not defaulted in responses, `src/series/content-access.ts:249`
**Problem**: AC-6 says every series carries both fields, but `toPublicSeries` echoes whatever `.lean()` returned. A series created outside the app, or a deploy that skips the backfill, omits them (data `isEpisodeFree` already treats as free).
**Why it matters**: clients get `undefined` instead of `false`/`0`; gating itself stays correct.
**Suggested fix**: default both in `toPublicSeries` so the response contract does not depend on the backfill having run.

### 🟡 `freeEpisodeCount` has no upper bound, `src/series/dto/update-series-access.dto.ts:24`
**Problem**: `@IsInt @Min(0)` only. A typo like 10000000 silently makes the whole series free (the spec allows exceeding the episode count).
**Why it matters**: an admin typo can unlock premium content; low likelihood.
**Suggested fix**: add a sane `@Max` (for example 1000) on the create, access and update DTOs.

### 🟡 JWT strategy logs payload and email on every request, `src/auth/strategies/jwt.strategy.ts:32`
**Problem**: `console.log` of the token payload and user email runs on every authenticated call, including `/play`.
**Why it matters**: PII in logs and noise at play volume. Pre-existing and outside the changed files, but on the gating path.
**Suggested fix**: remove it or move it to a debug level logger.

### 🟡 Test gaps for AC-5 and AC-7 over HTTP, `src/series/content-gating.http.spec.ts`
**Problem**: no spec for `RecommendationsController` (the seven `toPublicSeriesList` mappings are untested; only the service `.select('-episodes')` is), no HTTP test that `POST /series`, `POST /series/:id/episodes` and `POST /series/:id/rate` omit `videoUrl` (the controller spec covers rate and add episode with mocks), no DTO level 400 test for an invalid `freeEpisodeCount` or an empty PATCH body, and no `createSeries` test that persists `isPremium`/`freeEpisodeCount`.
**Why it matters**: the recommendations leak guard rests on two layers, neither exercised end to end.
**Suggested fix**: add a recommendations controller or HTTP spec asserting no `episodes`/`videoUrl`, and validation tests for the access DTO.

## Nits
- ⚪ `src/series/content-access.ts:142`, `playable.indexOf(ep)` makes the episode map O(n squared); build a position map once.
- ⚪ `src/series/series.service.ts:853`, `getPlayableEpisode(user: any)` and `getEpisodes` return `any[]`; the `UserLike` type could be exported and used.
- ⚪ `scripts/backfill-series-access.ts:16`, `$exists: false` skips fields explicitly set to null.
- ⚪ `src/recommendations/recommendations.service.ts:58`, the bare `catch` in `getRecommendations` hides real database errors behind the popular fallback.

## Strengths
- The access rule lives in one pure module with an injectable clock, fail closed `endDate` handling, grace imported from billing, and admin handling; it is evaluated live so access ends at the real expiry, not at the cron run.
- Check order in `/play` is right: an unplayable episode returns 404 before the premium 403, so nothing about locked content leaks, and the exact `PREMIUM_REQUIRED` body is asserted over HTTP.
- `isFree` is derived, never stored, and computed over the full playable list before pagination; the HTTP test checks that page 3 / limit 1 lands on the locked episode.
- `toPublicSeries` converts hydrated documents first and strips every video field, and `toAdminSeries` exposes only a status object (`hasPastedUrl`), so even admins never receive `videoUrl` outside `/play`.
- `ValidateIf` instead of `IsOptional` on the access DTO makes `null` a 400 rather than reaching a required field.

## Test coverage
TESTS = configured (365 passing). Well covered: `content-access` unit tests (ordering, teaser boundary, grace, missing endDate/subscription, admin, hydrated doc, playable only), the HTTP spec for `/play` (AC-1 to AC-4), read route leak checks, PATCH access (admin and non admin), service tests for `getPlayableEpisode`, `getEpisodes`, `updateAccess`, and recommendation query shapes. Gaps are in the last Minor finding: recommendations controller mapping, DTO 400 paths, create series premium fields, and the backfill script (acceptable to leave to the live check in verify.md).
