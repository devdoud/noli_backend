# Rationale: 0003 Categories

## Context

Series are classified today by `genres`, a free text string array set when a series is created. Nothing stops "Drama", "drama", and "Drame" from coexisting as three separate genres, and there is no list of genres to show, order, illustrate, or hide. The mobile app needs browsable categories with names, images, and a chosen order.

Genres are read in two routes (`GET /series/genre/:genre`, `GET /recommendations/genre/:genre`) and in the recommendation logic (personalized picks share a genre with watched series; similar series share a genre with the source series). The `series` collection is empty in the current database and no frontend consumes these routes yet, so changing the model now costs almost nothing, while changing it after launch would mean migrating live data and breaking app releases.

## Options considered

### Option 1: Managed Category collection referenced by id, replacing genres (chosen)
A `Category` document per category; series store `categoryIds`.

**Pros**: one source of truth for names, images, order, and visibility; renames happen in one place; stable slugs for URLs; uniqueness enforced by the database.
**Cons**: every series response needs a populate to show names; breaking change to the series shape.

### Option 2: Keep genres, add a distinct genres endpoint
Leave free text genres and add `GET /series/genres` returning the distinct values in use.

**Pros**: no schema change, very quick.
**Cons**: typos and near duplicates stay; no images, order, or hiding; a rename means rewriting every series.

### Option 3: Categories stored by name on the series (denormalized)
A `Category` collection for the list, but series store category names, not ids.

**Pros**: no populate needed to display names.
**Cons**: renaming a category means rewriting every series that uses it; names and the list drift apart over time.

## Rationale

The engineer's goal was a managed list without typos or duplicates, with admin control over naming, order, and visibility; only Option 1 gives a single place where a category is defined. The populate cost is one indexed query per list and is bounded by the page size, which is a better trade than Option 3's rename fan-out. Replacing genres outright, rather than running both systems, avoids two classifications drifting apart, and the empty collection plus the absence of a frontend make this the one moment the breaking change is free.

Several smaller calls were made at design time: hidden categories are left out of series cards (a seasonal category shouldn't show out of season); admins get a separate `GET /categories/all` route instead of a query flag that behaves differently per caller; duplicate ids in `categoryIds` are merged rather than rejected (harmless input); `displayOrder` has no unique index because a reorder would violate it mid-write, so ties are broken by `createdAt` and only the reorder call rewrites the full sequence; slugs come from a ten line helper rather than a new dependency.
