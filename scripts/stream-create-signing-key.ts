import 'dotenv/config';

// Creates a Cloudflare Stream signing key once (spec 0006) and prints the
// two values to put in .env. Playback tokens are then signed locally, with
// no Cloudflare call per play.
// Usage: npm run stream:create-signing-key
async function createSigningKey() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!accountId || !token) {
    console.error(
      'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN in .env first.',
    );
    process.exit(1);
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/keys`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  );
  const json = (await res.json()) as {
    success?: boolean;
    result?: { id?: string; pem?: string };
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || !json.success || !json.result?.id || !json.result.pem) {
    console.error(
      `Cloudflare refused: ${json.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`}`,
    );
    process.exit(1);
  }

  // pem comes back base64 encoded: stored as is, decoded by the API.
  console.log('Add these two lines to your .env (keep them secret):\n');
  console.log(`CLOUDFLARE_STREAM_SIGNING_KEY_ID=${json.result.id}`);
  console.log(`CLOUDFLARE_STREAM_SIGNING_KEY_PEM=${json.result.pem}`);
}

createSigningKey().catch((err) => {
  console.error(err);
  process.exit(1);
});
