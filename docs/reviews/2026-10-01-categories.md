# Review, categories (spec 0003), 2026-10-01

**Reviewed by**: Sonnet 5.5 (author on unknown)
**Scope**: 23 files, uncommitted (no commits yet, files read in full)
**Verdict**: Changes requested

## Summary
Admin managed categories with slugs, visibility, ordering, browsing and category based recommendations. The code follows the spec closely: race safe duplicate handling, static routes declared first, populate with a visible-only match on every read and write, and a mapper that never leaks categoryIds or genres. One real behavior bug sits in personalized recommendations: it only falls back to popular when watch history is missing, not when it yields no categories. A few smaller resilience and contract issues follow.

## Major
### 🟠 Personalized recommendations return an empty list when the watched categories set is empty, `src/recommendations/recommendations.service.ts:20`
**Problem**: The popular fallback only runs in the `catch` (line 58), which fires when `getContinueWatching` throws because no history document exists. `getContinueWatching` also drops completed episodes. A user whose history exists but has no in progress episodes (all completed), whose watched series were deleted, or whose watched series have no categories gets `categoryIds = []`, so the query is `categoryIds: { $in: [] }` and matches nothing. The result is `data: []`, with no fallback.
**Why it matters**: `GET /recommendations/for-me` (the app's home rail) is empty for exactly the engaged users who finished what they started. The inline comment and spec AC-8 describe a fallback that only half exists. Separately, the blanket `catch` also swallows genuine errors (DB down, bugs) and hides them behind popular results.
**Suggested fix**: After computing `categoryIds`, return `getPopularSeries(limit)` when it is empty. Narrow the `catch` to the NotFoundException from missing history and let other errors propagate. Add tests for "history exists, all completed" and "watched series have no categories".

## Minor
### 🟡 Admin views hide hidden categories on a series, `src/series/content-access.ts:225`
**Problem**: `toAdminSeries` goes through `toPublicSeries`, and every admin write and `GET /series/:id/admin` populates with `match: { isVisible: true }`. An admin editing a series cannot see which hidden categories it belongs to, and the series can look uncategorised (`categories: []`) while `categoryIds` is non empty.
**Why it matters**: This is what AC-8 literally says, but it is a trap for the admin app: a client that rebuilds `categoryIds` from the response on the next PATCH silently drops the hidden ones.
**Suggested fix**: Decide whether admin shapes should populate without the `match` (or expose `categoryIds` and a `hidden` flag), and document it in the spec if it stays as is.

### 🟡 Migration exits 0 with orphans and can abort half way, `scripts/migrate-genres-to-categories.ts:106`
**Problem**: Exit code only reflects leftover `genres`. Series ending with no categories (empty or unusable genres, skipped reserved genres) are only logged, yet the schema validator then rejects any `.save()` on them (for example rating). `insertOne` throws on a slug collision (another category with that custom slug) and aborts the run mid way, with no clear message.
**Why it matters**: A deploy script reporting success while leaving unsavable series.
**Suggested fix**: Exit non zero when orphans exist, catch the duplicate key per genre and report it. The script is idempotent so a rerun is safe.

### 🟡 Delete and create race leaves a dangling or single dangling category, `src/categories/categories.service.ts:235`
**Problem**: `remove` counts series then deletes without a guard, and `validateCategoryIds` (`series.service.ts:1035`) checks existence then writes. A series whose only category is deleted in between passes the `≥ 1` validator but displays `categories: []`.
**Why it matters**: Accepted in the spec (Consequences) and admin only, so Minor. Noted for completeness.
**Suggested fix**: Optional: re check the count after delete and surface it, or leave as documented.

### 🟡 Name creates a slug collision reported as a name problem, `src/categories/categories.service.ts:79`
**Problem**: `create` checks `nameKey` only. If another category has a custom slug equal to the new nameKey, the insert fails on the slug index and the 409 says "this slug already exists" for a request that sent only a name. Rename (`update`) can cause the same.
**Why it matters**: Confusing message, still correct status.
**Suggested fix**: Phrase the message to mention the derived slug, or check `slug` in the pre check.

### 🟡 Image upload buffered before the admin check, `src/categories/categories.controller.ts:215`
**Problem**: `PUT /categories/:id/image` runs Multer (up to 5 MB, memory) before `assertAdmin`; any authenticated user can make the server buffer files before the 403. Rate limited by `UploadThrottlerGuard` (10 per 10 min). Spec 0005 extension, noted only.
**Suggested fix**: Accept as designed, or check the role in a guard before the interceptor.

### 🟡 `getSimilarSeries` with a malformed id returns 500, `src/recommendations/recommendations.service.ts:75`
**Problem**: `findById('not-an-id')` throws a CastError that is not mapped.
**Suggested fix**: `isValidObjectId` check, then NotFoundException (the same pattern used elsewhere in this change).

## Nits
- ⚪ `src/categories/categories.service.ts:318`, `mapDuplicateKey` defaults to "name" when `keyPattern` is missing; fine, but a comment would help.
- ⚪ `src/categories/categories.service.ts:44`, public lists return lean documents including `nameKey`, `__v`, timestamps; consider projecting.
- ⚪ `src/categories/slugify.ts:10`, the regex range `[̀-ͯ]` is an invisible combining character range in source; use `̀-ͯ` for readability.
- ⚪ `src/series/series.service.ts:1036`, ids are deduplicated as strings, so upper and lower case hex of the same id are not merged (the ObjectId list could hold duplicates).

## Strengths
- Duplicate key races mapped to 409 with the colliding field named; reorder validates the full set before a single `bulkWrite` and documents why there are no transactions.
- `toPublicCategories` fails closed (drops unpopulated ObjectIds), and category mapping sits before the episodes branch so list items work. Hidden category names never reach series cards.
- Admin check, Swagger decorators and DTO validation (null vs undefined handled with `ValidateIf`) follow AGENTS.md; `categories.http.spec.ts` verifies route order, 401/403 and validation through the real pipe.
- Migration reads native collections and is idempotent.

## Test coverage
Strong: 408 passing, service specs cover create, update, reorder rejections, remove 409, image flows, browsing and pagination, plus the HTTP spec and content-access mapper. Gaps: personalized recommendations with an empty category set or all completed history (the Major above), `getSimilarSeries` malformed id, `PATCH` slug collision on create, and no test at all for the migration script.
