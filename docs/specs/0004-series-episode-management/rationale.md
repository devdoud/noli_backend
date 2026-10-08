# Rationale: 0004 Series and episode management

## Context

The admin API can create series, add episodes, and delete a series, but it can't edit a series, and it can't edit or delete an episode. Fixing a typo or a wrong video link today means editing the database by hand.

Three existing facts constrain the design. First, episodes are embedded in the series document and identified everywhere by (season, episode) numbers: the play route (spec 0002), the teaser rule (the first `freeEpisodeCount` episodes in that order are free), and watch history. Second, watch history is one document per user with an `episodes` array that stores `seriesId` as a string plus the numbers and a copy of the episode title, so it can drift from the catalog. Third, deleting a series already leaves those history entries behind, so "continue watching" can show items that return `404` when played.

## Options considered

### Option 1: In place edits, hard deletes, cascading history clean up, frozen numbers (chosen)
Edit series and episodes in place; delete episodes for real; after each delete or rename, update every affected history document.

**Pros**: history stays truthful; simple data model with no "deleted" flags; numbers stay a stable identity.
**Cons**: deletes are permanent; each delete or rename writes to many user documents; no transaction between the series write and the history write.

### Option 2: Soft delete episodes (a `deletedAt` flag)
Mark episodes deleted and filter them out everywhere.

**Pros**: reversible; history entries could keep pointing at something.
**Cons**: every episode read (lists, play, teaser position, recommendations) must filter the flag, and the teaser rule would have to ignore deleted episodes; ghost data accumulates; the classic source of bugs where one query forgets the filter.

### Option 3: Leave history alone, let the app handle missing episodes
Edit and delete without touching watch history.

**Pros**: no cross collection writes.
**Cons**: users see episodes that no longer exist and stale titles; every client has to handle the `404` gracefully; the existing series delete problem stays.

## Rationale

The engineer chose to remove deleted episodes from history and to update renamed titles, which rules out Option 3. Option 2's reversibility isn't worth making every read path filter a flag, especially with the position based teaser rule, where a hidden but still counted episode would silently change which episodes are free. Freezing episode numbers keeps the play URL, history, and teaser position stable; renumbering is rare and can be done by deleting and re-adding.

The lack of transactions is handled by ordering and idempotence instead: the series write happens first (a failed history write can't delete history for content that still exists), and the history clean up runs on every `DELETE` call, even when the content is already gone, so retrying the same call repairs a partial failure. Merging the premium fields into the main edit route follows the engineer's preference for one admin form, while keeping `/access` as an alias avoids breaking anything built against spec 0002.
