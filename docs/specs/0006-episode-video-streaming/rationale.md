# 0006. Episode video upload and streaming: rationale

## Context

Noli is a series streaming API for a francophone West African audience, mostly on phones and mobile data. Today an episode's video is a `videoUrl` pasted by an admin, pointing wherever the file happens to be hosted. The API returns it only from the `/play` route, after the premium check of spec 0002, but as a permanent public link: anyone who copies it can watch a premium episode for free and share it indefinitely. The file is also served as a single quality, so a weak connection buffers.

Episode files are large (hundreds of MB to a few GB for long episodes) and admins often work over unreliable connections. The API runs as a single NestJS service with no file storage, and the hosting target is still open, so storing or transcoding video on the server itself is not realistic. Admins have no dashboard yet; they work through Swagger and tools like Postman. The mobile app is the only player.

The forces: protect premium content for real (links that expire), adapt quality to the network, keep video bytes off the API server, survive dropped uploads, keep costs predictable for a young product, avoid breaking the episodes that already play from pasted links, and keep the catalog honest (no episode shown that can't play). Without a decision, premium gating stays bypassable and every new episode depends on hosting arranged by hand.

## Options considered

### Option 1: Keep pasted links

Admins host videos elsewhere and paste the link, as today.

**Pros**:
- Nothing to build, no new cost.

**Cons**:
- Premium links can be shared forever; single quality; no upload from the product; depends on hosting arranged by hand.

### Option 2: Cloudflare Stream, direct uploads, signed HLS, webhook (chosen)

Cloudflare encodes to adaptive HLS, stores and delivers it; the API issues one time upload links and signed playback tokens and tracks state through a signed webhook.

**Pros**:
- Managed encoding into several qualities, global CDN, resumable direct uploads up to 30 GB, import from URL.
- Signed tokens are generated locally (no API call per play), so `/play` stays fast.
- Simple, usage based pricing (about $5 per 1,000 minutes stored and $1 per 1,000 minutes watched); MP4 downloads available later for feature 10.

**Cons**:
- Paid from the first minute, no free tier; a second external provider next to Cloudinary.
- Some API details (TUS headers, webhook format) must be confirmed at build time.
- Presence of Cloudflare data centers in West Africa could not be confirmed during the design check.

### Option 3: Mux

The same shape (direct uploads, signed playback, webhooks) on Mux.

**Pros**:
- The best developer experience and built in viewer analytics.

**Cons**:
- Higher cost per minute watched, which dominates for a streaming catalog.

### Option 4: Build it yourself (object storage + an encoding job + CDN)

Store originals in object storage, encode to HLS with a transcoding service or `ffmpeg` workers, serve through a CDN with signed cookies or URLs.

**Pros**:
- Full control and potentially the lowest cost at very large scale.

**Cons**:
- Several pieces to build and operate (encoding queue, failure handling, storage lifecycle, CDN signing) for a small team, before the first episode plays.

Cloudinary (already used for images) was also weighed in the design conversation: it would reuse the account and SDK, but video consumes its credits quickly and strict signed delivery needs a paid plan, so it is the costly path for a streaming catalog.

## Rationale

The heaviest forces are protecting premium content and serving weak mobile networks, and Cloudflare Stream answers both with configuration: every video requires a signed token, and HLS adapts quality per viewer. Its per minute pricing is the most predictable of the managed options for a catalog that will be watched far more than it is uploaded, which is where Mux becomes expensive. Building it yourself would give control but means operating an encoding pipeline before shipping a single episode, the wrong trade for this team today.

Direct uploads keep video bytes off the API entirely, which matters on an unknown host and for admins on unstable connections (TUS resumes after a drop). Importing from a URL turns the move of existing pasted videos into one call each. Tracking a current and a pending slot per episode lets a replacement process in the background while the old video keeps playing, and a webhook with an admin refresh route avoids both polling costs and a stuck episode when a webhook is missed or the developer works locally.

The playback link lasts twice the episode's length plus an hour because HLS players keep requesting chunks with the same token: a short fixed lifetime would cut viewers off mid episode, while a long fixed one would let a shared link live for hours. The engineer chose "length plus 1 hour"; the cross check showed that a pause or a rewind would kill such a link mid episode, so the engineer accepted doubling the length, with the app fetching a new link when the player is refused or resumes. Signing free episodes too keeps one rule for all videos, protects the streaming bill from embedding, and lets an episode move between free and premium without touching Cloudflare. Hiding episodes until their video is ready keeps the catalog honest and keeps the teaser count meaningful. Keeping pasted links playable avoids a breaking migration; their lack of protection is accepted until each is moved.

The engineer's answers in the design conversation are fixed requirements: Cloudflare Stream, direct uploads, import from URL, hidden until ready, link life of length plus 1 hour, every video signed, legacy links kept, webhook plus refresh, replacement without downtime, a 3 hour maximum, downloads left to feature 10, built in `fetch` plus `@nestjs/jwt`, `videoUrl` kept in `/play` with `type` and `expiresAt`, and 6 hour upload links. Decisions made while writing: the 200 MB threshold between a basic and a resumable upload (Cloudflare's own limit for the basic form), an admin read route (`GET /series/:id/admin`) since public routes now hide unplayable episodes, a `DELETE .../video` route to take a video down, the 5 minute webhook replay window, `rawBody` enabled globally (the cheapest way to verify signatures in NestJS), and `https` only imports. After the cross check, the engineer also accepted: hiding unplayable episodes only on the three routes that actually return episodes (series lists carry none), playable counts for `total` and `totalEpisodes`, an admin response shape for every admin write, removing `videoUrl` from `PATCH`, a short lookup retry for webhooks that arrive before the pending uid is saved, expiring unused upload links, switching only on `state: ready`, registering the account's single webhook only in production with an environment marker in each video's `meta`, deleting Cloudflare videos before the episode or series row so a retried delete still knows them, per feature gating when variables are missing, and the shared rate limit of spec 0005 on video routes.

## References

**Project sources**:
- `AGENTS.md`: the inline admin check, Swagger in French, Jest with mocked models.
- Spec 0002 (content gating): the `/play` route, `freeEpisodeCount`, `PREMIUM_REQUIRED`.
- Spec 0004 (series and episode management): frozen episode numbers, retry safe cascades.
- Spec 0005 (image upload): the compare and set pattern, best effort deletes, `503` without keys.
- The installed `cloudflare` agent skill (`.agents/skills/cloudflare/references/stream/`): its official doc pointers for video webhooks, webhook authenticity, signed tokens, and processing error codes, to confirm the unverified details at build time.

**Practices & standards**:
- HLS adaptive bitrate streaming.
- Signed, expiring media URLs (RS256 JWT).
- HMAC webhook signatures verified on the raw body, with a replay window.
- Resumable uploads (the TUS protocol).
- Compare and set writes for concurrent updates.

**Links** (web verified during the design check on 2026-10-01):
- Stream direct upload API: https://developers.cloudflare.com/api/resources/stream/subresources/direct_upload/methods/create/
- Upload via link: https://developers.cloudflare.com/stream/uploading-videos/upload-via-link/
- Securing your Stream (signed URLs): https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
- Stream pricing: https://developers.cloudflare.com/stream/pricing/
