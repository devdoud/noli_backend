import 'dotenv/config';
import mongoose from 'mongoose';

// Promotes an existing account to admin. A script, not an API route, on
// purpose: it needs the database credentials, so no HTTP caller can grant
// itself admin. Usage: npm run db:make-admin -- someone@example.com
async function makeAdmin() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run db:make-admin -- <email>');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  await mongoose.connect(uri);

  const result = await mongoose.connection
    .collection('users')
    .updateOne({ email }, { $set: { role: 'admin' } });

  await mongoose.disconnect();

  if (result.matchedCount === 0) {
    console.error(`No account found for ${email}. Sign up first, then run this again.`);
    process.exit(1);
  }
  console.log(
    result.modifiedCount === 1
      ? `${email} is now admin. It applies on the next request (the role is read from the database each time).`
      : `${email} was already admin. Nothing changed.`,
  );
  process.exit(0);
}

makeAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
