import { createHmac } from 'crypto';
import { verifyStreamSignature } from './stream-webhook.verifier';

const SECRET = 'whsec_test';
const NOW = 1_790_000_000;
const body = Buffer.from('{"uid":"abc","status":{"state":"ready"}}');

function sign(time: number, raw: Buffer = body, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(`${time}.`)
    .update(raw)
    .digest('hex');
}

describe('verifyStreamSignature (spec 0006 AC-5)', () => {
  it('accepts a valid signature over the raw body', () => {
    const header = `time=${NOW},sig1=${sign(NOW)}`;
    expect(verifyStreamSignature(header, body, SECRET, NOW)).toBe(true);
  });

  it('accepts any of several sig1 values (secret rotation)', () => {
    const header = `time=${NOW},sig1=${'0'.repeat(64)},sig1=${sign(NOW)}`;
    expect(verifyStreamSignature(header, body, SECRET, NOW)).toBe(true);
  });

  it('refuses a signature made with another secret', () => {
    const header = `time=${NOW},sig1=${sign(NOW, body, 'other')}`;
    expect(verifyStreamSignature(header, body, SECRET, NOW)).toBe(false);
  });

  it('refuses a body changed after signing (even one byte)', () => {
    const header = `time=${NOW},sig1=${sign(NOW)}`;
    const tampered = Buffer.from(body.toString().replace('ready', 'reaDy'));
    expect(verifyStreamSignature(header, tampered, SECRET, NOW)).toBe(false);
  });

  it('refuses a timestamp more than 5 minutes away (replay)', () => {
    const old = NOW - 301;
    expect(
      verifyStreamSignature(`time=${old},sig1=${sign(old)}`, body, SECRET, NOW),
    ).toBe(false);
    const edge = NOW - 300;
    expect(
      verifyStreamSignature(
        `time=${edge},sig1=${sign(edge)}`,
        body,
        SECRET,
        NOW,
      ),
    ).toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['no time', `sig1=${'a'.repeat(64)}`],
    ['no sig1', `time=${NOW}`],
    ['a non numeric time', `time=abc,sig1=${'a'.repeat(64)}`],
    ['a non hex signature', `time=${NOW},sig1=zz`],
  ])('refuses %s', (_label, header) => {
    expect(verifyStreamSignature(header, body, SECRET, NOW)).toBe(false);
  });

  it('refuses when the raw body or the secret is missing', () => {
    const header = `time=${NOW},sig1=${sign(NOW)}`;
    expect(verifyStreamSignature(header, undefined, SECRET, NOW)).toBe(false);
    expect(verifyStreamSignature(header, body, '', NOW)).toBe(false);
  });
});
