import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import { RESERVED_SLUGS, slugify } from '../src/categories/slugify';

// Spec 0003 AC-10. Uses the native collections: the Series schema no longer
// declares `genres`, so Mongoose would strip it from reads and from $unset.
// Safe to run again: only series that still have a `genres` field are touched.
async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  await mongoose.connect(uri);
  const db = mongoose.connection;
  const series = db.collection('series');
  const categories = db.collection('categories');

  const withGenres = await series
    .find({ genres: { $exists: true } }, { projection: { genres: 1, categoryIds: 1 } })
    .toArray();

  const distinctGenres = [
    ...new Set(
      withGenres.flatMap((s) =>
        (Array.isArray(s.genres) ? (s.genres as unknown[]) : [])
          .filter((g): g is string => typeof g === 'string')
          .map((g) => g.trim()),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const idByKey = new Map<string, Types.ObjectId>();
  const skipped: string[] = [];
  let created = 0;

  for (const genre of distinctGenres) {
    const key = slugify(genre);
    if (!key || RESERVED_SLUGS.includes(key)) {
      skipped.push(genre);
      continue;
    }
    if (idByKey.has(key)) {
      continue;
    }
    const existing = await categories.findOne({ nameKey: key }, { projection: { _id: 1 } });
    if (existing) {
      idByKey.set(key, existing._id as Types.ObjectId);
      continue;
    }
    const last = await categories.find().sort({ displayOrder: -1 }).limit(1).next();
    const now = new Date();
    const result = await categories.insertOne({
      name: genre,
      nameKey: key,
      slug: key,
      description: null,
      imageUrl: null,
      displayOrder: last ? (last.displayOrder as number) + 1 : 0,
      isVisible: true,
      createdAt: now,
      updatedAt: now,
    });
    idByKey.set(key, result.insertedId as Types.ObjectId);
    created++;
  }

  let migrated = 0;
  for (const s of withGenres) {
    const fromGenres = (Array.isArray(s.genres) ? (s.genres as unknown[]) : [])
      .filter((g): g is string => typeof g === 'string')
      .map((g) => idByKey.get(slugify(g)))
      .filter((id): id is Types.ObjectId => !!id);
    const current = Array.isArray(s.categoryIds) ? (s.categoryIds as Types.ObjectId[]) : [];
    const merged = [...new Map([...current, ...fromGenres].map((id) => [String(id), id])).values()];

    await series.updateOne(
      { _id: s._id },
      { $set: { categoryIds: merged }, $unset: { genres: '' } },
    );
    migrated++;
  }

  const orphans = await series
    .find(
      { $or: [{ categoryIds: { $exists: false } }, { categoryIds: { $size: 0 } }] },
      { projection: { _id: 1, title: 1 } },
    )
    .toArray();
  const stillWithGenres = await series.countDocuments({ genres: { $exists: true } });

  console.log(
    `Migration done: ${created} categories created, ${migrated} series migrated, ${stillWithGenres} series still with genres.`,
  );
  if (skipped.length > 0) {
    console.log(`Genres skipped (no usable slug or reserved): ${skipped.join(', ')}`);
  }
  if (orphans.length > 0) {
    console.log(
      `Series without any category (fix by hand): ${orphans
        .map((o) => `${String(o._id)} (${String(o.title)})`)
        .join(', ')}`,
    );
  }

  await mongoose.disconnect();
  process.exit(stillWithGenres === 0 ? 0 : 1);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
