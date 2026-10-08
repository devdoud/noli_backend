# Rationale: 0002 Content gating for premium

## Context

> Premise note: the scope row says "a free user can play free series but is blocked on premium ones", which assumes a play step exists. It does not. Every episode's `videoUrl` is returned by `GET /series/:id`, `GET /series/:id/episodes`, all seven `/recommendations/*` routes (full series documents, episodes included), and `POST /series/:id/rate` (any signed in user; it returns the saved series with all episodes). The admin routes `POST /series` and `POST /series/:id/episodes` return it too. A gate added anywhere else would be bypassed by any of these. This spec therefore removes `videoUrl` from every catalog response and adds a gated play endpoint, which is a breaking change to the response shape (see Consequences).

Spec 0001 made the subscription real: `User.subscription` (`plan`, `isActive`, `endDate`) is now kept correct by the KkiaPay webhook and a daily downgrade cron with a 1 day grace period. Nothing reads it yet. This feature is the first consumer, and Offline Downloads (scope feature 10) will be the second.

The `videoUrl` values are plain strings set by an admin when adding an episode. No video hosting or CDN has been decided, so a link, once handed out, can be shared. Protecting the link itself (signed, expiring URLs) needs that hosting decision first and is out of scope here.

## Options considered

### Option 1: Gated play endpoint, videoUrl removed from the catalog (chosen)
The catalog stays public and user independent, minus `videoUrl`. A new signed in endpoint returns one episode's link after checking the series flags and the caller's subscription.

**Pros**: one choke point, so one place to audit and later swap for signed URLs; catalog responses stay cacheable because they don't depend on the caller; the subscription check is live.
**Cons**: breaking change to the episode shape; one extra request per play.

### Option 2: Filter videoUrl per user inside the existing responses
Public catalog routes read an optional token and include `videoUrl` only on episodes the caller may play.

**Pros**: no new endpoint, fewer requests.
**Cons**: nine routes each need optional auth and per user filtering, so nine places to get wrong; every response becomes user specific; a single missed route reopens the leak.

### Option 3: Signed, expiring links now
Option 1 plus short lived signed links, so a shared link stops working.

**Pros**: the only option that protects the link itself.
**Cons**: needs a video hosting and signing decision that hasn't been made; blocks this feature on it.

## Rationale

The leak is spread across nine public routes, so a design that has to be correct in each of them (Option 2) is the one most likely to regress; one choke point is the only shape that stays correct as routes are added. It also keeps the catalog independent of the caller, which Home Feed (scope feature 9) will want. Signed links (Option 3) are the right end state, but they depend on where the videos live, which is undecided. Option 1 puts the single swap point in place so that change later touches one endpoint.

Deciding "is this episode free" by position rather than a stored flag means adding or reordering episodes can never leave a stale flag behind. Checking `endDate` plus grace at request time, instead of trusting `isActive` alone, removes up to a day of extra access between a lapse and the midnight cron, while counting the grace day keeps the rule identical to spec 0001's.

