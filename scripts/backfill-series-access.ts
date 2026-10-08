import 'dotenv/config';
import mongoose from 'mongoose';

// Spec 0002 AC-8: every series that predates content gating becomes free.
// Written as real fields because .lean() reads skip schema defaults.
// Safe to run again: only touches series still missing the fields.
async function backfill() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  await mongoose.connect(uri);
  const series = mongoose.connection.collection('series');

  const premium = await series.updateMany(
    { isPremium: { $exists: false } },
    { $set: { isPremium: false } },
  );
  const count = await series.updateMany(
    { freeEpisodeCount: { $exists: false } },
    { $set: { freeEpisodeCount: 0 } },
  );
  const stillMissing = await series.countDocuments({
    $or: [
      { isPremium: { $exists: false } },
      { freeEpisodeCount: { $exists: false } },
    ],
  });

  console.log(
    `Backfill done: isPremium set on ${premium.modifiedCount}, freeEpisodeCount set on ${count.modifiedCount}, still missing: ${stillMissing}`,
  );
  await mongoose.disconnect();
  process.exit(stillMissing === 0 ? 0 : 1);
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
