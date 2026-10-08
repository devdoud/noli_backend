# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Image uploads, stored on Cloudinary (see spec 0005). Each image slot has a `PUT` route to upload or replace and a `DELETE` route to remove: `/series/:id/cover`, `/series/:id/banner`, `/series/:id/episodes/:seasonNumber/:episodeNumber/thumbnail`, `/categories/:id/image` (admins only), and `/users/me/avatar` (any signed in user, own account only). Send the file as multipart form data in the field `file`.
- Uploaded images are cropped to their slot's shape (cover 2:3, banner and thumbnail 16:9, category image and avatar square, avatars centered on the face), and every URL asks Cloudinary for the best format and quality per device, to keep mobile data use low.
- Upload checks run on the file's own bytes: JPEG, PNG, or WebP only, no animated images, 5 MB at most (`413`), a minimum size per slot, at most 25 megapixels, and no shape more stretched than 5:1. A wrong type answers `415`; the other refusals answer `400`.
- A rate limit on all image routes together: 10 calls per user every 10 minutes, then `429`.
- Episodes now return a `thumbnail` field (`null` until one is uploaded).
- New environment variables `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Without them the API still starts and every other route works; image uploads answer `503`.
- Premium content (see spec 0002). A series is free or premium (`isPremium`), and a premium series can leave its first `freeEpisodeCount` episodes free as a teaser, counted in (season, episode) order. Both fields appear on every series in every response, and each episode carries a computed `isFree`.
- `GET /series/:id/episodes/:seasonNumber/:episodeNumber/play` (signed in) is the only route that returns an episode's `videoUrl`. A free episode plays for anyone signed in; any other episode needs an active premium subscription and otherwise answers `403` with `{ statusCode: 403, code: 'PREMIUM_REQUIRED', message: 'Premium subscription required' }`, which the app can use to show an upgrade prompt.
- `PATCH /series/:id/access` (admins only) changes `isPremium` and `freeEpisodeCount`; both can also be set when creating a series. The count must be a whole number of 0 or more.
- `npm run db:backfill-series-access` marks every series created before this change as free (`isPremium: false`, `freeEpisodeCount: 0`). Safe to run again; run it once in each environment that already has series.
- Categories managed by admins (see spec 0003), replacing free text genres. A category has a name, a stable URL `slug` derived from the name (accents removed), an optional description and image, a display order, and a visible or hidden switch.
- Public category routes: `GET /categories` (visible ones, in display order), `GET /categories/:slug`, and `GET /categories/:slug/series` (paginated with `page`, `limit` up to 50, and `sort` set to `newest` or `rating`). A hidden or unknown category answers `404`.
- Admin category routes: `POST /categories`, `PATCH /categories/:id`, `PUT /categories/order` (send every category id, in the new order), `DELETE /categories/:id`, and `GET /categories/all` (hidden ones included). Names that differ only by case or accents are refused as duplicates (`409`); renaming keeps the slug unless a new `slug` is sent.
- `GET /recommendations/category/:slug` returns the best rated series of a visible category.
- `npm run db:migrate-genres-to-categories` turns existing `genres` into categories and links each series to them. Safe to run again; run it once in each environment that has series with genres.
- Series and episode management for admins (see spec 0004). `PATCH /series/:id` edits every series detail in one call: title, description, images, languages, country, release year, status, categories, and premium settings. `rating`, `votes`, `totalEpisodes`, and `episodes` can't be changed this way and are ignored if sent.
- `PATCH /series/:id/episodes/:seasonNumber/:episodeNumber` edits an episode's title, description, duration, and release date, and `DELETE` on the same path removes it. Season and episode numbers never change, since they identify the episode in links, playback, and watch history.
- Renaming an episode also updates its title in every user's watch history.

### Changed
- Replacing or removing an uploaded image now deletes the old file on Cloudinary. Setting a pasted URL through `PATCH /series/:id` or `PATCH /categories/:id` also deletes the uploaded file it replaces. Pasted URLs keep working and are never deleted.
- Deleting a series, an episode, or a category now also deletes its images on Cloudinary (best effort: a cleanup failure is logged and never fails the delete).
- `GET /users/:id` returns `avatar: null` when a user has no avatar, instead of leaving the field out.
- Episodes are now always listed in (season, episode) order, in series details and in `GET /series/:id/episodes`.
- Premium access is checked at the moment of each play request: a subscription counts until its `endDate` plus a 1 day grace period, and an admin always has access.
- Creating a series now requires `categoryIds` (at least one existing category id; an unknown id answers `400` naming it). `PATCH /series/:id` can change them too.
- Every series response now carries `categories: [{ _id, name, slug }]` (visible categories only) instead of `genres` and the raw `categoryIds`.
- `GET /recommendations/for-me` recommends series sharing a category with everything the user watched, finished episodes included, and falls back to popular series when there is nothing to match. `GET /recommendations/similar/:id` also matches on categories.
- A category still used by series can't be deleted: `DELETE /categories/:id` answers `409` with `code: 'CATEGORY_IN_USE'` and the number of series (`seriesCount`).
- Deleting an episode or a series also removes it from every user's watch history. A deleted episode keeps the series' `freeEpisodeCount`, so the free teaser moves to the next episodes. Repeating a delete answers `404` and still finishes any cleanup a failed attempt left behind.
- A series title must be unique: creating or renaming a series with a title already in use answers `409`. Titles are trimmed, and a blank title answers `400`.
- Adding an episode now rejects a duplicate season and episode pair with `400`, keeps `totalEpisodes` exact even when several episodes are added at the same moment, accepts an ISO `releaseDate`, and requires whole numbers of 1 or more for the season, the episode, and the duration.
- `PATCH /series/:id/access` is now a shortcut for the premium fields of `PATCH /series/:id`; an empty body still answers `400`.

### Removed
- `genres` on series, and the routes `GET /series/genre/:genre` and `GET /recommendations/genre/:genre` (they now answer `404`). Use categories and `GET /categories/:slug/series` or `GET /recommendations/category/:slug` instead.

### Security
- Episode video links no longer leak from the catalog. `videoUrl` was removed from every series, episode, rating, and recommendation response (including admin ones), so a premium episode's link can only be obtained through the gated `/play` route.
