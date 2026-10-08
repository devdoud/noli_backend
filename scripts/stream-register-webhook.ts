import 'dotenv/config';

// Registers the Cloudflare Stream webhook (spec 0006) and prints its secret.
// Cloudflare allows ONE notification URL per account: register production
// only. In development, leave the secret empty and use the refresh route.
// Usage: npm run stream:register-webhook -- https://api.example.com
async function registerWebhook() {
  const host = process.argv[2]?.trim().replace(/\/+$/, '');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!host || !/^https:\/\//.test(host)) {
    console.error(
      'Usage: npm run stream:register-webhook -- https://<public host of the API>',
    );
    process.exit(1);
  }
  if (!accountId || !token) {
    console.error(
      'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN in .env first.',
    );
    process.exit(1);
  }

  const notificationUrl = `${host}/webhooks/cloudflare-stream`;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/webhook`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notificationUrl }),
    },
  );
  const json = (await res.json()) as {
    success?: boolean;
    result?: { secret?: string; notificationUrl?: string };
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || !json.success || !json.result?.secret) {
    console.error(
      `Cloudflare refused: ${json.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`}`,
    );
    process.exit(1);
  }

  console.log(
    `Webhook registered: ${json.result.notificationUrl ?? notificationUrl}`,
  );
  console.log(
    'Add this line to the .env of THAT environment (keep it secret):\n',
  );
  console.log(`CLOUDFLARE_STREAM_WEBHOOK_SECRET=${json.result.secret}`);
}

registerWebhook().catch((err) => {
  console.error(err);
  process.exit(1);
});
