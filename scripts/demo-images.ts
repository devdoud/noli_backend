import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { createHash } from 'crypto';

// Self hosted placeholder images for the demo data (scope feature 19).
// Each image is an SVG drawn here (a colour per series and its title),
// uploaded once to Cloudinary as a JPEG under noli/demo/. The public ids
// are deterministic, so the dev and production databases share the same
// files and running a script twice uploads nothing new. noli/demo/ sits
// outside the per owner folders the app deletes from (SAFE_PREFIX in
// src/media/media.service.ts), so replacing a demo image in the app never
// deletes the shared file.

export type DemoImageKind = 'cover' | 'banner' | 'thumb' | 'category';

export interface DemoImageRequest {
  kind: DemoImageKind;
  // Path below noli/demo/, e.g. "series/cotonou-express/cover".
  path: string;
  // Drives the colour, so a series and its episodes share one palette.
  colorKey: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
}

const SIZES: Record<DemoImageKind, [number, number]> = {
  cover: [1000, 1500],
  banner: [1920, 1080],
  thumb: [1280, 720],
  category: [800, 800],
};

export function configureCloudinary(): void {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error(
      'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be set to host the demo images',
    );
  }
  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
}

// Uploads the image if it is not there yet and returns its delivery URL,
// in the same f_auto,q_auto shape as the app's own uploads.
export async function ensureDemoImage(req: DemoImageRequest): Promise<string> {
  const publicId = `noli/demo/${req.path}`;
  const svg = renderSvg(req);
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          public_id: publicId,
          resource_type: 'image',
          format: 'jpg',
          overwrite: false,
          unique_filename: false,
        },
        (err, res) => (err || !res ? reject(err ?? new Error('empty upload result')) : resolve(res)),
      )
      .end(Buffer.from(svg, 'utf8'));
  });
  return result.secure_url.replace('/image/upload/', '/image/upload/f_auto,q_auto/');
}

// Runs the requests a few at a time; returns URLs in request order.
export async function ensureDemoImages(
  reqs: DemoImageRequest[],
  concurrency = 6,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const urls: string[] = new Array(reqs.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, reqs.length) }, async () => {
      while (next < reqs.length) {
        const i = next++;
        urls[i] = await withRetry(() => ensureDemoImage(reqs[i]));
        onProgress?.(++done, reqs.length);
      }
    }),
  );
  return urls;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

function renderSvg(req: DemoImageRequest): string {
  const [w, h] = SIZES[req.kind];
  const hue = hueOf(req.colorKey);
  const top = hsl(hue, 0.55, 0.42);
  const bottom = hsl((hue + 35) % 360, 0.6, 0.12);
  const glow = hsl((hue + 330) % 360, 0.7, 0.6);

  const short = Math.min(w, h);
  const titleSize = Math.round(
    req.kind === 'cover' ? w * 0.1 : req.kind === 'category' ? w * 0.11 : short * 0.11,
  );
  const lines = wrap(req.title, Math.max(8, Math.floor((w * 0.84) / (titleSize * 0.56))), 4);
  const lineHeight = titleSize * 1.15;
  const blockHeight = lines.length * lineHeight;
  const centerY =
    req.kind === 'cover' ? h * 0.68 : req.kind === 'category' ? h * 0.5 : h * 0.55;
  const firstBaseline = centerY - blockHeight / 2 + titleSize * 0.85;
  const anchor = req.kind === 'banner' ? 'start' : 'middle';
  const x = req.kind === 'banner' ? w * 0.07 : w / 2;

  const title = lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${(firstBaseline + i * lineHeight).toFixed(1)}" font-size="${titleSize}" font-weight="700" text-anchor="${anchor}">${esc(line)}</text>`,
    )
    .join('');
  const smallSize = Math.round(titleSize * 0.42);
  const eyebrow = req.eyebrow
    ? `<text x="${x}" y="${(firstBaseline - titleSize * 1.1).toFixed(1)}" font-size="${smallSize}" font-weight="700" letter-spacing="${(smallSize * 0.15).toFixed(1)}" fill-opacity="0.85" text-anchor="${anchor}">${esc(req.eyebrow.toUpperCase())}</text>`
    : '';
  const subtitle = req.subtitle
    ? `<text x="${x}" y="${(firstBaseline + (lines.length - 1) * lineHeight + titleSize * 0.95).toFixed(1)}" font-size="${smallSize}" fill-opacity="0.8" text-anchor="${anchor}">${esc(req.subtitle)}</text>`
    : '';
  const brandSize = Math.round(short * 0.045);
  const brand = `<text x="${w - short * 0.05}" y="${(short * 0.05 + brandSize).toFixed(1)}" font-size="${brandSize}" font-weight="700" letter-spacing="${(brandSize * 0.2).toFixed(1)}" fill-opacity="0.7" text-anchor="end">NOLI</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
<radialGradient id="glow" cx="0.8" cy="0.15" r="0.7"><stop offset="0" stop-color="${glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/>
<rect width="${w}" height="${h}" fill="url(#glow)"/>
<g font-family="DejaVu Sans, Arial, Helvetica, sans-serif" fill="#ffffff">${brand}${eyebrow}${title}${subtitle}</g>
</svg>`;
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  }
  return lines;
}

function hueOf(key: string): number {
  return createHash('sha1').update(key).digest().readUInt16BE(0) % 360;
}

function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The image set for one demo series, keyed so the seed and the fix script
// build exactly the same requests.
export function seriesImageRequests(
  key: string,
  title: string,
  meta: string,
): { cover: DemoImageRequest; banner: DemoImageRequest } {
  return {
    cover: { kind: 'cover', path: `series/${key}/cover`, colorKey: key, title, subtitle: meta },
    banner: { kind: 'banner', path: `series/${key}/banner`, colorKey: key, title, subtitle: meta, eyebrow: 'Série Noli' },
  };
}

export function episodeImageRequest(
  key: string,
  seriesTitle: string,
  season: number,
  episode: number,
  episodeTitle: string,
): DemoImageRequest {
  return {
    kind: 'thumb',
    path: `series/${key}/s${season}e${episode}`,
    colorKey: key,
    title: `S${season} · É${episode}`,
    subtitle: episodeTitle,
    eyebrow: seriesTitle,
  };
}

export function categoryImageRequest(key: string, name: string): DemoImageRequest {
  return { kind: 'category', path: `categories/${key}`, colorKey: `cat-${key}`, title: name, eyebrow: 'Catégorie' };
}
