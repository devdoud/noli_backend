import 'dotenv/config';
import mongoose from 'mongoose';
import { writeFileSync } from 'fs';
import { slugify } from '../src/categories/slugify';
import {
  DemoImageRequest,
  categoryImageRequest,
  configureCloudinary,
  ensureDemoImages,
  episodeImageRequest,
  seriesImageRequests,
} from './demo-images';

// One shot repair (2026-11-13): the demo seed first stored picsum.photos
// links, and picsum stopped answering, so the app showed no images. This
// swaps every picsum link in categories and series (cover, banner, episode
// thumbnails) for a self hosted demo image (scripts/demo-images.ts). Links
// on any other host, such as real Cloudinary uploads, are never touched.
//
//   npm run db:fix-demo-images               replace the links
//   npm run db:fix-demo-images -- --dry-run  only count what would change
//
// The old values are written to a JSON backup next to the working directory
// before anything is changed.

const isBroken = (url: unknown): url is string =>
  typeof url === 'string' && /^https?:\/\/([a-z0-9-]+\.)*picsum\.photos\//i.test(url);

interface Change {
  collection: 'categories' | 'series';
  id: mongoose.Types.ObjectId;
  field: 'imageUrl' | 'coverImage' | 'bannerImage' | 'thumbnail';
  season?: number;
  episode?: number;
  oldUrl: string;
  request: DemoImageRequest;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  console.log(`Database: ${db.databaseName}${dryRun ? ' (dry run)' : ''}`);

  const changes: Change[] = [];
  for (const c of await db.collection('categories').find().toArray()) {
    if (isBroken(c.imageUrl)) {
      changes.push({
        collection: 'categories',
        id: c._id as any,
        field: 'imageUrl',
        oldUrl: c.imageUrl,
        request: categoryImageRequest(slugify(c.name), c.name),
      });
    }
  }
  for (const s of await db.collection('series').find().toArray()) {
    const key = slugify(s.title);
    const meta = [s.country, s.releaseYear].filter(Boolean).join(' · ');
    const reqs = seriesImageRequests(key, s.title, meta);
    if (isBroken(s.coverImage)) {
      changes.push({ collection: 'series', id: s._id as any, field: 'coverImage', oldUrl: s.coverImage, request: reqs.cover });
    }
    if (isBroken(s.bannerImage)) {
      changes.push({ collection: 'series', id: s._id as any, field: 'bannerImage', oldUrl: s.bannerImage, request: reqs.banner });
    }
    for (const ep of s.episodes ?? []) {
      if (isBroken(ep.thumbnail)) {
        changes.push({
          collection: 'series',
          id: s._id as any,
          field: 'thumbnail',
          season: ep.seasonNumber,
          episode: ep.episodeNumber,
          oldUrl: ep.thumbnail,
          request: episodeImageRequest(key, s.title, ep.seasonNumber, ep.episodeNumber, ep.title ?? `Épisode ${ep.episodeNumber}`),
        });
      }
    }
  }

  const byField = changes.reduce<Record<string, number>>((acc, c) => {
    acc[c.field] = (acc[c.field] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Broken picsum links: ${changes.length}`, byField);
  if (dryRun || changes.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const backup = `demo-images-backup-${db.databaseName}-${Date.now()}.json`;
  writeFileSync(backup, JSON.stringify(changes.map(({ request, ...c }) => c), null, 2));
  console.log(`Old values saved to ${backup}`);

  configureCloudinary();
  const urls = await ensureDemoImages(
    changes.map((c) => c.request),
    6,
    (done, total) => {
      if (done % 20 === 0 || done === total) console.log(`  images ready: ${done}/${total}`);
    },
  );

  // Compare and set: a link changed since it was read stays untouched.
  let updated = 0;
  for (const [i, c] of changes.entries()) {
    const url = urls[i];
    const res =
      c.field === 'thumbnail'
        ? await db.collection('series').updateOne(
            { _id: c.id },
            { $set: { 'episodes.$[e].thumbnail': url } },
            { arrayFilters: [{ 'e.seasonNumber': c.season, 'e.episodeNumber': c.episode, 'e.thumbnail': c.oldUrl }] },
          )
        : await db.collection(c.collection).updateOne({ _id: c.id, [c.field]: c.oldUrl }, { $set: { [c.field]: url } });
    updated += res.modifiedCount;
  }
  console.log(`Updated ${updated} of ${changes.length} links.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
