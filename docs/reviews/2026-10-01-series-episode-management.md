# Review, series-episode-management (spec 0004), 2026-10-01

**Reviewed by**: Sonnet 5.5 (author model not stated)
**Scope**: 17 files, uncommitted (no commits yet, files read in full)
**Verdict**: Approve with nits

## Summary
Spec 0004 is implemented faithfully: one PATCH for series, atomic episode add/delete (`$push`+`$inc`, `$pull`+`$inc` with `$elemMatch` filters), episode edit via the positional operator, and watch-history cascades that run even on the 404 path so a retried DELETE repairs a failed cleanup. Error mapping (11000 to 409, Validation/Cast to 400), the `ValidateIf` null rules, and the id/empty-body ordering all match the spec and AGENTS.md. No blockers or majors; the findings are ordering/robustness details and test gaps on failure paths. The 0005/0006 extensions (pasted image cleanup, Cloudflare deletes first) do not break 0004 behaviour.

## Minor
### 🟡 Body validation runs before the admin check, `src/series/series.controller.ts:314`
**Problem**: The global ValidationPipe runs before the handler, so a non-admin sending an invalid body to PATCH series, PATCH episode, POST episode gets 400 (with field details) instead of 403. The inline `role !== 'admin'` check only runs for valid bodies.
**Why it matters**: AC-9 says non-admins get 403; this lets a viewer probe DTO rules and the admin routes' shapes. The HTTP spec only tests a valid body for the 403 case.
**Suggested fix**: Accept as a project-wide limitation (no RolesGuard) and document it, or add an admin guard that runs before pipes. At least add an HTTP test pinning the chosen behaviour.

### 🟡 A swallowed Cloudflare failure permanently orphans the video, `src/series/series.service.ts:783`
**Problem**: `deleteEpisode`/`deleteSeries` delete Cloudflare videos first, but `StreamClient.deleteVideo` never throws. If Cloudflare fails, the database delete still proceeds and the uid is gone from the database, so a retry cannot find it. The comment "a retry still knows their ids" only holds when the later database write fails.
**Why it matters**: Silent storage leak, and the opposite case (video deleted, database write fails) leaves a live episode with a dead video until retried.
**Suggested fix**: Decide the intended trade-off explicitly: either treat a failed delete as an error (so the database keeps the uid), or log the uid at error level for manual cleanup. Reword the comment.

### 🟡 Sequential Cloudflare calls inside deleteSeries, `src/series/series.service.ts:955`
**Problem**: Two awaited HTTP calls per episode in a loop, before the database delete.
**Why it matters**: A long series can exceed request timeouts, leaving a partially deleted video set and a client error.
**Suggested fix**: Collect the uids and delete with bounded concurrency; skip null uids before calling.

### 🟡 Rename cascade is unconditional and its failure leaves a 500 after a committed write, `src/series/series.service.ts:752`
**Problem**: `renameEpisodeEverywhere` runs whenever `title` is in the body, even if it equals the current title, scanning every affected user's document. If it throws, the series update is already applied but the admin gets a 500.
**Why it matters**: Wasted writes at audience scale. The retry is idempotent so this is safe, but unlike deletes (AC-8) it is not stated or tested.
**Suggested fix**: Skip the cascade when the title is unchanged (compare with the pre-update value, or only run when modified). Note the retry behaviour in a comment.

### 🟡 Test gaps on failure and auth paths, `src/series/series-management.http.spec.ts:75`
**Problem**: Nothing tests: a cascade method rejecting (the error propagating after the database change), `mapWriteError` for `addEpisode`/`updateEpisode`/`createSeries`, a 401 without a token on any new route, or an HTTP-level 403 for the episode PATCH/DELETE and POST (only series PATCH/DELETE have it; the controller spec covers the role check at unit level). Service tests only assert mock call shapes, so the real update-operator semantics (positional `$`, `$push` validators) rest on the manual live verification.
**Why it matters**: AC-8's retry guarantee and AC-9's 401/403 are the security and consistency promises of this feature.
**Suggested fix**: Add a service test where `removeEpisodeEverywhere` rejects after a successful pull and a retry returns 404 but re-runs the cleanup; add 401 and 403 cases for the episode routes in the HTTP spec.

## Nits
- ⚪ `src/series/series.service.ts:1029`, `mapWriteError` returns the raw Mongoose `err.message` (schema paths) to the client; use a generic or field-only message.
- ⚪ `src/series/schemas/series.schema.ts:195`, `SeriesSchema.index({ title: 1 })` duplicates the `unique: true` index (known follow-up, still produces the boot warning).
- ⚪ `src/series/dto/update-episode.dto.ts:13`, spec 0004 AC-4 still lists `videoUrl` as editable; spec 0006 removed it deliberately. Mark the spec as superseded so the doc and code agree.
- ⚪ `src/series/series.service.ts:945`, `isValidObjectId` also accepts any 12 character string; harmless here (404 / SAFE_PREFIX refuses) but `isObjectIdOrHexString` would be stricter.

## Strengths
- Atomic add and delete: the duplicate refusal lives in the filter and `$inc` rides with `$push`/`$pull`, closing the lost-update race on `totalEpisodes`; the 404 vs duplicate split via `exists` is correct.
- Retry safe deletes: cascades run on the not-found path, matching AC-8, with tests for both the series and episode cases.
- DTOs: `ValidateIf` plus `Trim` correctly makes null/blank a 400 at the pipe; `EDITABLE_*_FIELDS` allowlists mean rating, votes, episodes and frozen numbers can never be written; watch-history cascades use the indexed `episodes.seriesId`, `arrayFilters`, and `timestamps: false` as designed.
- Good HTTP-level test of whitelist stripping and trimming through the real ValidationPipe.

## Test coverage
Configured (Jest, 439 passing). Covered: updateSeries (fields, categories, 409 pre-check and race, 400 mapping, empty body, 404), updateEpisode, deleteEpisode and deleteSeries (including the 404 plus cleanup retry and malformed id), addEpisode atomic query, the three cascade queries, DTO validation over HTTP. Not covered: cascade failure propagation, `mapWriteError` on episode and create paths, 401, HTTP 403 for episode routes, and real MongoDB operator behaviour (relied on the live verify run, 12/12).
