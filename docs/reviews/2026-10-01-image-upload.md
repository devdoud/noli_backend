# Review, master (no commits yet), 2026-10-01

**Reviewed by**: Claude Sonnet 5.5 (fresh reviewer; author model not stated)
**Scope**: about 30 files (7 new source files, 14 modified, 8 test files), uncommitted, read in full (no commits, so no diff)
**Verdict**: Approve with nits

## Summary
Spec 0005 is implemented faithfully: one slot table builds every Cloudinary path, a shared `replaceImage`/`removeImage` flow does validate, upload, compare and set, then best effort delete, and every cascade goes through a prefix guard. I traced the race paths (lost compare and set, failed save, pasted URL over an upload, retry deletes) and found no correctness or security defect that blocks merge. The remaining findings are edge cases on admin-only pasted URLs, a missing spec-required test, and small maintainability points.

## Minor
### 🟡 A pasted URL can alias another owner's or slot's uploaded file, `src/media/media.service.ts:309` and `src/series/series.service.ts:170`
**Problem**: Pasting is unrestricted (`coverImage`, `bannerImage`, `imageUrl` accept any URL). An admin can paste the URL of series A's uploaded cover into series B's cover, or a banner URL into the cover field. `ownedPublicId` is checked against the slot being replaced, so B never owns the file, but A does.
**Why it matters**: Replacing or deleting A's cover (or deleting series A, which prefix-deletes its whole folder) silently breaks B's image. The invariant "never delete outside the owner's own slot" holds, but the reverse (a live URL is never left dangling) does not. Admin only and unlikely, hence Minor.
**Suggested fix**: Accept it as a documented limit in the spec, or reject pasted URLs that are Cloudinary URLs of this cloud under `noli/` (they should be set through the upload routes).

### 🟡 No test that the throttler guard resolves inside the real `UsersModule`, `src/media/upload-throttler.guard.spec.ts:46`
**Problem**: The spec's Feature design explicitly asks for a test that the guard resolves inside `UsersModule`. The test uses a synthetic `HostModule` that imports `MediaModule`; the controller specs override the guard. The live run proved it works, but nothing in the suite would catch a regression in `UsersModule`'s imports.
**Why it matters**: Guard resolution failures only show at boot of that module; the only protection today is the manual verify.
**Suggested fix**: Add a small Test.createTestingModule that imports the real `UsersModule` (Mongoose model mocked) and calls `moduleRef.get(UploadThrottlerGuard)`, or boots `AppModule` with a mocked connection.

### 🟡 Cleanup is tied to the current `NODE_ENV` only, `src/media/image-slots.ts:72` and `src/media/media.service.ts:149`
**Problem**: Every path embeds `envSegment(NODE_ENV)`. If an environment's `NODE_ENV` value is ever renamed (`prod` to `production`), files uploaded earlier no longer match any owner prefix, so replace, remove, and cascade delete leave them behind permanently and with no log line.
**Why it matters**: Silent quota leak, and a remove then just clears the URL. This is a known tradeoff of spec AC-14, so low severity.
**Suggested fix**: Log at warn when `ownedPublicId` rejects a URL that is a Cloudinary upload URL of this cloud under `noli/` (it signals an env mismatch or alias), and mention the rename caveat in the media notes.

### 🟡 `destroy` ignores a non-`ok` result, `src/media/media.service.ts:264`
**Problem**: `cloudinary.uploader.destroy` resolves with `{ result: 'not found' }` (or other values) for a missing id instead of rejecting. The code only logs on a thrown error.
**Why it matters**: The spec says delete failures are logged so a sweeper can be decided on; a wrong id (for example the CDN URL parsing drifting again, as the `?_a=` bug did) would produce zero log output.
**Suggested fix**: Read the result and log a warning when it is not `ok`, still never throwing.

## Nits
- ⚪ `src/series/series.service.ts:312` and `:336`, `loadForImage`/`setSeriesImage` populate categories on the pre-read, then the compare and set populates again; a `.select()` without populate on the pre-read would save a query per upload (spec check order step 6 suggests the lean select).
- ⚪ `src/media/media.service.ts:137`, the 409 message is French while the rest of the series and category exception messages are English (`Series not found`); pick one.
- ⚪ `src/series/series.controller.ts:436`, `:451`, `:474`, `:489`, `:522`, `:549` and several other changed files fail `prettier --check` (long lines); `npx prettier --write` on the touched files. Some failures (`create-user.dto.ts`, `login.dto.ts`) predate this change.
- ⚪ `src/users/users.controller.ts:116`, `GET /users/:id` lets any signed in user read any other user's email and subscription; pre existing, now it also returns `avatar`. Worth a follow up, not part of this change.

## Strengths
- Single source of truth for paths (`image-slots.ts`), plus a second guard (`SAFE_PREFIX`) before any prefix delete and a `ownedPublicId` that requires the cloud name, `image/upload`, a version, and the exact owner slot prefix (trailing hyphen prevents `s1e2-` matching `s1e20-`).
- Compare and set with `null` matching a missing field, correct `$elemMatch` plus positional update for episodes, and the lose path destroys the freshly uploaded file then distinguishes 404 from 409.
- Validation is on file bytes (magic bytes, APNG/WebP animation chunk scan bounded by buffer length, header size with EXIF rotation, pixel cap) and runs before any Cloudinary call; Cloudinary 400 maps to 400 and everything else to 503.
- Throttler keyed per user with a shared counter across routes, ordered after JWT so 401 precedes 429; the HTTP test proves the 11th call across different routes is 429.
- `toPublicEpisodes` always emits `thumbnail: null`, and `UpdateEpisodeDto` correctly does not accept a thumbnail.

## Test coverage
Configured (Jest, 273 passing). Coverage is strong: validate-image (each refusal and EXIF), `MediaService` (replace, remove, lost race, 503 without keys, partial prefix loop, prefix refusal, pasted URL never deleted), service blocks for series, categories, and users, controller 401/403/413/400 through real Multer in `series-images.http.spec.ts`, and the shared 429 counter. Gaps: the guard resolving in the real `UsersModule` (spec requirement, see Minor), and no HTTP level multipart test for the category and avatar routes (they rely on the same decorators, so low risk). Pasted-URL cascade for categories is covered in `categories.service.spec.ts`.
