// Verifies tools/rtree.mjs against cubiomes' own 1.21.4 tree.
import fs from 'fs';
import path from 'path';
import { buildTree, leafFromEntry, search } from './rtree.mjs';
import { createEngine } from '../web/wasm-api.js';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const dir = process.argv[2], N = +(process.argv[3] || 200000);

const src = fs.readFileSync(path.join(here, '../cubiomes/tables/btree21wd.h'), 'utf8');
const steps = src.match(/steps\[\] = \{([^}]*)\}/)[1].split(',').map(Number);
const params = [...src.match(/_param\[\]\[2\] =\s*\{([\s\S]*?)\};/)[1].matchAll(/\{\s*(-?\d+),\s*(-?\d+)\}/g)].map((m) => [+m[1], +m[2]]);
const nodesB = [...src.match(/_nodes\[\] =\s*\{([\s\S]*?)\};/)[1].matchAll(/0x([0-9A-Fa-f]{16})/g)].map((m) => BigInt('0x' + m[1]));
const nodes = nodesB.map((n) => ({ p: [0,1,2,3,4,5].map((i) => params[Number((n >> BigInt(8*i)) & 0xFFn)]), hi: Number(n >> 48n) & 0xFFFF }));
const len = nodes.length;
const cdist = (idx, t) => { let s = 0; const nd = nodes[idx]; for (let i = 0; i < 6; i++) { const a = t[i] - nd.p[i][1], b = nd.p[i][0] - t[i]; const d = a > 0 ? a : b > 0 ? b : 0; s += d * d; } return s; };
function cres(t, idx, alt, ds, depth) {
  if (steps[depth] === 0) return idx;
  let step; do { step = steps[depth]; depth++; } while (idx + step >= len);
  let inner = nodes[idx].hi, leaf = alt;
  for (let i = 0; i < 6; i++) {
    const di = cdist(inner, t);
    if (di < ds) { const l2 = cres(t, inner, leaf, ds, depth); const dl = inner === l2 ? di : cdist(l2, t); if (dl < ds) { ds = dl; leaf = l2; } }
    inner += step; if (inner >= len) break;
  }
  return leaf;
}
const cBiome = (idx) => nodes[idx].hi & 0xFF;

const mod = await WebAssembly.compile(fs.readFileSync(path.join(here, '../web/engine.wasm')));
const eng = await createEngine(mod); eng.world(28, false, 0n);
const nameToId = {}; for (let i = 0; i < 256; i++) { const n = eng.biomeName(i); if (n && !(n in nameToId)) nameToId[n] = i; }
const list = JSON.parse(fs.readFileSync(path.join(dir, '1.21.4-dimension.json'))).overworld.generator.biome_source.biomes;
const root = buildTree(list.map((e) => leafFromEntry(e, nameToId[e.biome.slice(10)])));

const bounds = [...new Set(params.flat())];
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = () => { const r = rnd(); if (r < 0.5) return Math.round((rnd() * 2.4 - 1.2) * 10000); const b = bounds[Math.floor(rnd() * bounds.length)]; return b + [-1, 0, 0, 1][Math.floor(rnd() * 4)]; };
let mismatch = 0, warmMismatch = 0, candM = null, candC = 0;
for (let k = 0; k < N; k++) {
  const t = [pick(), pick(), pick(), pick(), pick(), pick()];
  const a = search(root, t, null).biome;
  const b = cBiome(cres(t, 0, 0, Infinity, 0));
  if (a !== b && mismatch++ < 5) console.log('cold mismatch', t, eng.biomeName(a), eng.biomeName(b));
  // warm start chains
  candM = search(root, t, candM);
  const ds = cdist(candC, t);
  candC = cres(t, 0, candC, ds, 0);
  if (candM.biome !== cBiome(candC) && warmMismatch++ < 5) console.log('warm mismatch', t, eng.biomeName(candM.biome), eng.biomeName(cBiome(candC)));
}
console.log(`checked ${N} points: cold mismatches ${mismatch}, warm-start mismatches ${warmMismatch}`);
