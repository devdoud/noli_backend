import { createHmac, timingSafeEqual } from 'crypto';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

// Verifies a Cloudflare Stream webhook (spec 0006 AC-5). The header reads
// `time=<unix seconds>,sig1=<hex>` and sig1 is HMAC SHA256 of
// `<time>.<raw body>` with the webhook secret. Several sig1 values are
// accepted (secret rotation); a timestamp more than 5 minutes away from now
// is refused, so a captured request can't be replayed later.
export function verifyStreamSignature(
  header: string | undefined,
  rawBody: Buffer | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !rawBody || !secret) {
    return false;
  }
  let time: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, ...rest] = part.trim().split('=');
    const value = rest.join('=');
    if (key === 'time') time = value;
    if (key === 'sig1' && value) signatures.push(value);
  }
  if (!time || !/^\d+$/.test(time) || signatures.length === 0) {
    return false;
  }
  if (Math.abs(nowSeconds - Number(time)) > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(`${time}.`)
    .update(rawBody)
    .digest();
  return signatures.some((sig) => {
    if (!/^[a-f0-9]+$/i.test(sig)) return false;
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
