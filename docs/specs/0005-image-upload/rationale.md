# 0005. Image upload: rationale

## Context

The catalog already has image fields (`Series.coverImage`, `Series.bannerImage`, `Category.imageUrl`, `User.avatar`), but they only hold links pasted by hand. That forces whoever manages content to host pictures somewhere else first, gives no control over size or shape, and lets a 5 MB photo travel as is to phones on mobile data. For a streaming app aimed at francophone West Africa, where data is expensive and networks vary, image weight is a real cost to users, not a cosmetic detail.

The backend is a single NestJS 11 API on MongoDB (Atlas), with no file storage of any kind today, and the hosting target is not fixed yet. Many common hosts wipe the local disk on every redeploy, so files cannot simply live next to the code. Admins work through Swagger for now (a dashboard is deferred), and the mobile app is the only reader. Profile Editing (feature 6) will need avatars on the same plumbing, and episodes have no thumbnail field yet.

The forces: keep the data light on phones, keep the operational load low for a small team, reuse the existing conventions (inline admin check, class validator, Swagger in French, retry safe cascades from spec 0004), avoid orphan files eating a storage quota, and never let a partial failure leave the database pointing at a missing picture. Without a decision, admins keep pasting links from random hosts that can break at any time, and the app ships inconsistent, heavy artwork.

## Options considered

### Option 1: Keep pasted URLs, add nothing

Admins host images wherever they like and paste the link, as today.

**Pros**:
- Zero work, zero new dependency, zero cost.

**Cons**:
- Links break when the external host changes; no control over size, shape, or format; heavy images on mobile data; no avatar upload for users at all.

### Option 2: Upload through the API to Cloudinary, one route per slot (chosen)

The API receives the file, validates it, uploads it to Cloudinary with a crop per slot, stores the URL with a compare and set write, and deletes old files best effort.

**Pros**:
- Cloudinary crops and serves the best format per device (`f_auto,q_auto`), which cuts data use without extra code; built in CDN; free tier to start.
- All validation stays on the server, works from Swagger, and matches the existing controller style.
- Dedicated routes make the replace and cleanup atomic per slot, so no orphan from an abandoned two step flow.

**Cons**:
- A new external service that can be down, with plan limits.
- Files pass through the server's memory.
- Ten new routes to maintain.

### Option 3: Cloudflare R2 (or S3) with direct signed uploads from the client

The API hands out a short lived signed permission, the client uploads straight to object storage, then the API records the key.

**Pros**:
- No file bytes through the server; R2 has no download fees; scales further.

**Cons**:
- No automatic resizing or format choice: you would generate sizes yourself (a worker or `sharp`) or add a paid image product, which is more infrastructure than this team needs now.
- Validation moves to a second step after the upload, so bad files cost storage before being refused, and abandoned uploads become orphans.
- A harder flow to test from Swagger.

### Option 4: Local disk or MongoDB GridFS

Store files on the server's disk or inside MongoDB and serve them from the API.

**Pros**:
- No new account, no external dependency.

**Cons**:
- Local disk vanishes on most managed hosts at redeploy; GridFS makes the database serve images, with no CDN and no resizing, which is the worst option for mobile data in the target market.

## Rationale

Option 2 wins because the heaviest force here is data weight on phones, and Cloudinary's crop at upload plus `f_auto,q_auto` at delivery answers it with configuration rather than infrastructure. R2 is the stronger choice for large media (it is a good candidate for video later), but for images it would mean building a resizing pipeline this team does not need to operate yet. Local disk is ruled out by the unknown host, and GridFS by the lack of a CDN.

Going through the API rather than direct signed uploads keeps every check (type by content, weight, pixel size) before any quota is spent, and it works in Swagger, which is the only admin tool today. Images are small (5 MB cap), so the memory cost is acceptable at this scale. Dedicated routes per slot were chosen over a generic upload plus `PATCH`, because they let one request own the whole replace: upload, atomic swap, delete the old file. A generic upload leaves files nobody attached.

The first draft stored the Cloudinary id in a hidden field next to each URL. The cross check pointed out a simpler path, which the engineer accepted: the id can be read back from the URL this feature builds, and a file is deleted only when that id sits inside the owner's own slot folder in the current environment. That removes five hidden fields, the risk of leaking them in a response, and the special handling of pasted URLs (a pasted URL simply never matches the folder), while the app keeps reading the same URL fields. The compare and set on the old URL handles two admins uploading at once without locks, and best effort deletes after the write follow the same rule as spec 0004's history cleanup: the database is the truth, a stray file is harmless, a broken image is not. Rate limiting per user id rather than IP follows the market reality of shared mobile IPs; `@nestjs/throttler` is the official NestJS answer and reusable later for login. `image-size` was picked over `sharp` because the server only needs to read dimensions, not transform pixels; Cloudinary does the transforming.

The engineer's calls in the design conversation (all five slots including avatar and thumbnail, 5 MB, JPEG PNG WebP, crop to shape with minimums, keep pasted URLs, folders per `NODE_ENV`, `503` without keys, `null` thumbnails, full resource responses, 10 per 10 minutes) are taken as fixed requirements. Decisions made while writing: status codes `413` for weight and `415` for type (they tell the client exactly what to fix), a 25 megapixel ceiling (Cloudinary's free plan refuses larger images, as of my knowledge; verify on your plan), prefix deletes for cascades (one call per series, and retry safe without reading the deleted record), and `auto:face` gravity for avatars versus `auto` elsewhere. After the cross check, the engineer also accepted: a rate limit counter shared across all image routes, minimums on both sides with EXIF rotation and a 5:1 shape cap, refusing animated images, `404` for bad ids to match the existing routes, keeping the inline admin check even though Multer reads the file first (the rate limit caps the cost), and `returnDocument: 'before'` so a pasted URL replacement reads the old value in the same atomic write.
