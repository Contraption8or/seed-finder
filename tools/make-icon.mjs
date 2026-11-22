// Draws build/icon.png (512x512): rounded green tile with a diamond, matching
// the in-app logo. No dependencies: hand-rolled PNG encoder.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const N = 512;
const px = Buffer.alloc(N * N * 4);
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(1, v));

for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const u = (x + 0.5) / N, v = (y + 0.5) / N;
  // rounded square, radius 0.2, with 1px antialiasing
  const r = 0.2, m = 0.04;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0);
  const sd = Math.hypot(qx, qy) - r;
  const alpha = clamp(0.5 - sd * N);
  // diagonal gradient #5fbf6a -> #2e7d6b
  const t = (u + v) / 2;
  let R = mix(0x5f, 0x2e, t), G = mix(0xbf, 0x7d, t), B = mix(0x6a, 0x6b, t);
  // diamond (L1 distance from centre)
  const d = Math.abs(u - 0.5) + Math.abs(v - 0.5);
  const outer = clamp((0.30 - d) * N + 0.5), inner = clamp((0.17 - d) * N + 0.5);
  const dark = [0x0d, 0x1f, 0x12], light = [0xe9, 0xf7, 0xe6];
  R = mix(R, dark[0], outer); G = mix(G, dark[1], outer); B = mix(B, dark[2], outer);
  // facet highlight on the upper-left half of the inner diamond
  const facet = (u + v < 1) ? 1 : 0.72;
  R = mix(R, light[0] * facet, inner); G = mix(G, light[1] * facet, inner); B = mix(B, light[2] * facet, inner);
  const i = (y * N + x) * 4;
  px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = Math.round(alpha * 255);
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

const out = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
