import { loadModule, createEngine } from './wasm-api.js';

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

// ids match cubiomes' enum StructureType (+ Seed Finder's Abandoned_Camp = 25)
const STRUCTS = [
  { id: 5,  name: 'Village',          color: '#e3b04b', g: 'V' },
  { id: 1,  name: 'Desert Pyramid',   color: '#ead68c', g: 'P' },
  { id: 2,  name: 'Jungle Temple',    color: '#5aa846', g: 'J' },
  { id: 3,  name: 'Swamp Hut',        color: '#6f8a4c', g: 'H' },
  { id: 4,  name: 'Igloo',            color: '#d4ecf7', g: 'I' },
  { id: 10, name: 'Pillager Outpost', color: '#9c8b78', g: 'O' },
  { id: 9,  name: 'Woodland Mansion', color: '#8d5a36', g: 'M' },
  { id: 8,  name: 'Ocean Monument',   color: '#43c0c0', g: 'Mo' },
  { id: 6,  name: 'Ocean Ruin',       color: '#5b8bb3', g: 'R' },
  { id: 7,  name: 'Shipwreck',        color: '#a8743d', g: 'S' },
  { id: 14, name: 'Buried Treasure',  color: '#f0c419', g: '$', maxScale: 16 },
  { id: 11, name: 'Ruined Portal',    color: '#a54fd6', g: 'Rp' },
  { id: 13, name: 'Ancient City',     color: '#1f6070', g: 'A' },
  { id: 23, name: 'Trail Ruins',      color: '#c28b62', g: 'T' },
  { id: 24, name: 'Trial Chambers',   color: '#d47c2f', g: 'C' },
  { id: 25, name: 'Abandoned Camp',   color: '#7f9a46', g: 'Ac' },
  { id: 12, name: 'Ruined Portal',    color: '#a54fd6', g: 'Rp' },
  { id: 18, name: 'Nether Fortress',  color: '#b23a3a', g: 'F' },
  { id: 19, name: 'Bastion Remnant',  color: '#4a4a4f', g: 'B' },
  { id: 20, name: 'End City',         color: '#d9c9f2', g: 'E' },
];
const END_CITY_SHIP = 100;
const STRUCT_BY_ID = Object.fromEntries(STRUCTS.map((s) => [s.id, s]));
const DIM_NAMES = { 0: 'Overworld', '-1': 'Nether', 1: 'End' };
const TILE = 64;
const STORE_KEY = 'seedfinder:v2';

// cubiomes biome ids for 1.14+ village variants
const VILLAGE_TYPES = [[0, 'any type'], [1, 'Plains'], [2, 'Desert'], [35, 'Savanna'], [5, 'Taiga'], [12, 'Snowy']];
const LAYERS = { surface: [15, 'surface'], caves: [0, 'caves (y≈0)'], deep: [-10, 'deep caves (y≈-40)'] };

const VERSION_LABELS = {
  '26.3': '26.3', '26.2': '26.2', '1.21.9': '1.21.9 – 26.1.2', '1.21.5': '1.21.5 – 1.21.8',
  '1.21 WD': '1.21.4', '1.21.3': '1.21.2 – 1.21.3', '1.21.1': '1.21 – 1.21.1', '1.20': '1.20 – 1.20.6',
  '1.19': '1.19.3 – 1.19.4', '1.19.2': '1.19 – 1.19.2', '1.16': '1.16.2 – 1.16.5', '1.16.1': '1.16 – 1.16.1',
};

// Biome groups for the picker: [label, test(name)]
const BIOME_GROUPS = [
  ['All oceans', (n) => /ocean/.test(n)],
  ['Deep oceans', (n) => /^deep_.*ocean/.test(n)],
  ['Warm & lukewarm oceans', (n) => /(warm|lukewarm)_ocean/.test(n)],
  ['Land (not ocean or river)', (n) => !/ocean|river/.test(n)],
  ['Rivers', (n) => /river/.test(n)],
  ['Beaches & shores', (n) => /beach|shore/.test(n)],
  ['Forests', (n) => /forest|garden|cherry/.test(n)],
  ['Taigas', (n) => /taiga/.test(n)],
  ['Jungles', (n) => /jungle/.test(n)],
  ['Snowy & frozen', (n) => /snow|frozen|ice|grove|jagged/.test(n)],
  ['Mountains & peaks', (n) => /peaks|slopes|windswept|meadow|grove/.test(n)],
  ['Badlands', (n) => /badlands/.test(n)],
  ['Savannas', (n) => /savanna/.test(n)],
  ['Swamps', (n) => /swamp/.test(n)],
  ['Cave biomes', (n) => /caves|deep_dark/.test(n)],
];

const FILTER_KINDS = [
  ['Spawn', [
    ['spawnBiome', 'Spawn biome is / is not…'],
    ['spawnDist', 'Spawn distance from 0,0'],
    ['spawnHeight', 'Spawn height (approx.)'],
  ]],
  ['Biomes', [
    ['biome', 'Biomes near center (any / none / all / % area)'],
  ]],
  ['Structures', [
    ['struct', 'Structure count near center'],
    ['cluster', 'Structure cluster (e.g. double witch huts)'],
    ['stronghold', 'Strongholds near center'],
    ['slime', 'Slime chunks near center'],
  ]],
];

// Presets reference biomes by name; resolved for the current version.
const PRESETS = [
  ['Speedrun: village, portal, fortress & bastion', { center: 1, filters: [
    { type: 'struct', st: 5, radius: 200, min: 1 },
    { type: 'struct', st: 11, radius: 160, min: 1 },
    { type: 'struct', st: 18, radius: 120, min: 1 },
    { type: 'struct', st: 19, radius: 120, min: 1 },
  ] }],
  ['Mushroom island spawn', { center: 1, filters: [{ type: 'spawnBiome', biomeNames: ['mushroom_fields'] }] }],
  ['Cherry grove spawn with a village', { center: 1, filters: [
    { type: 'spawnBiome', biomeNames: ['cherry_grove'] }, { type: 'struct', st: 5, radius: 300, min: 1 },
  ] }],
  ['Survival island (mostly ocean)', { center: 1, filters: [
    { type: 'biome', dim: 0, mode: 'cover', group: 'All oceans', radius: 600, min: 85, max: 100 },
  ] }],
  ['No ocean within 500 blocks', { center: 1, filters: [{ type: 'biome', dim: 0, mode: 'none', group: 'All oceans', radius: 500 }] }],
  ['Elytra early: End City with ship', { center: 1, filters: [{ type: 'struct', st: END_CITY_SHIP, radius: 1500, min: 1 }] }],
  ['Double witch huts (farm)', { center: 0, filters: [{ type: 'cluster', st: 3, count: 2, size: 150, radius: 2500 }] }],
  ['Monument + mansion nearby', { center: 1, filters: [
    { type: 'struct', st: 8, radius: 800, min: 1 }, { type: 'struct', st: 9, radius: 2500, min: 1 },
  ] }],
  ['Ancient city under spawn', { center: 1, filters: [{ type: 'struct', st: 13, radius: 350, min: 1 }] }],
  ['Zombie village near spawn', { center: 1, filters: [{ type: 'struct', st: 5, radius: 600, min: 1, zombie: 'only' }] }],
  ['Lush caves under spawn', { center: 1, filters: [{ type: 'biome', dim: 0, mode: 'any', layer: 'caves', biomeNames: ['lush_caves'], radius: 100 }] }],
  ['26.3: Dappled forest + abandoned camps', { center: 1, filters: [
    { type: 'biome', dim: 0, mode: 'any', biomeNames: ['dappled_forest'], radius: 400 },
    { type: 'struct', st: 25, radius: 600, min: 2 },
  ] }],
  ['26.2: Sulfur caves under spawn', { center: 1, filters: [{ type: 'biome', dim: 0, mode: 'any', layer: 'caves', biomeNames: ['sulfur_caves'], radius: 200 }] }],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
const fmt = (n) => Math.round(n).toLocaleString();
const prettyBiome = (n) => (n || '?').split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}
function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied ' + text), () => toast(text));
}

function random64() {
  const a = new BigInt64Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

// Same rules Minecraft uses for the "Seed for the World Generator" box.
function parseSeed(text) {
  const s = text.trim();
  if (!s) return null;
  if (/^[-+]?\d+$/.test(s)) {
    const b = BigInt(s);
    if (b >= -(2n ** 63n) && b < 2n ** 63n) return b;
  }
  let hsh = 0;
  for (let i = 0; i < s.length; i++) hsh = (Math.imul(31, hsh) + s.charCodeAt(i)) | 0;
  return BigInt(hsh);
}

const floorDiv = (a, b) => Math.floor(a / b);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } })();
const cores = navigator.hardwareConcurrency || 4;

const state = {
  mc: saved.mc ?? null,
  large: !!saved.large,
  center: saved.center ?? 1,
  cx: saved.cx ?? 0,
  cz: saved.cz ?? 0,
  filters: saved.filters ?? [{ type: 'struct', st: 5, radius: 300, min: 1 }],
  mode: saved.mode ?? 'random',
  startSeed: saved.startSeed ?? '0',
  threads: Math.min(saved.threads ?? Math.max(1, cores - 2), cores),
  maxResults: saved.maxResults ?? 25,
  seed: saved.seed != null ? BigInt(saved.seed) : random64(),
  dim: 0,
  views: { 0: { x: 0, z: 0, bpp: 2 }, '-1': { x: 0, z: 0, bpp: 1 }, 1: { x: 0, z: 0, bpp: 4 } },
  hidden: new Set(saved.hidden ?? ['slime']),
  legendOpen: false,
};

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    mc: state.mc, large: state.large, center: state.center, cx: state.cx, cz: state.cz,
    filters: state.filters, mode: state.mode, startSeed: state.startSeed, threads: state.threads,
    maxResults: state.maxResults, seed: String(state.seed), hidden: [...state.hidden],
  }));
}

let wasmModule, meta, colors;
let biomes = { 0: [], '-1': [], 1: [] }; // per dimension: [{id, key, name}]
let biomeIdByKey = {};
let structAvail = new Map(); // id -> dim (only available ones)

// ---------------------------------------------------------------------------
// Worker pool (map tiles + world info)
// ---------------------------------------------------------------------------

class Pool {
  constructor(n) {
    this.workers = [];
    this.queue = new Map(); // key -> {msg, prio, cb}
    this.inflight = new Set();
    this.cbs = new Map();
    this.nextId = 1;
    for (let i = 0; i < n; i++) {
      const w = new Worker('./worker.js', { type: 'module' });
      w.ready = false; w.busy = false;
      w.onmessage = (e) => {
        if (e.data.type === 'ready') { w.ready = true; this.pump(); return; }
        const job = this.cbs.get(e.data.id);
        this.cbs.delete(e.data.id);
        w.busy = false;
        if (job) { this.inflight.delete(job.key); job.cb(e.data); }
        this.pump();
      };
      w.postMessage({ type: 'init', module: wasmModule });
      this.workers.push(w);
    }
  }
  has(key) { return this.queue.has(key) || this.inflight.has(key); }
  enqueue(key, msg, prio, cb) {
    const q = this.queue.get(key);
    if (q) { q.prio = prio; return; }
    if (this.inflight.has(key)) return;
    this.queue.set(key, { msg, prio, cb });
    this.pump();
  }
  prune(keep) {
    for (const k of this.queue.keys()) if (!keep.has(k)) this.queue.delete(k);
  }
  clear() { this.queue.clear(); }
  pump() {
    for (const w of this.workers) {
      if (!w.ready || w.busy || !this.queue.size) continue;
      let bestK = null, best = null;
      for (const [k, j] of this.queue) if (!best || j.prio < best.prio) { best = j; bestK = k; }
      this.queue.delete(bestK);
      const id = this.nextId++;
      this.cbs.set(id, { key: bestK, cb: best.cb });
      this.inflight.add(bestK);
      w.busy = true;
      w.postMessage({ ...best.msg, id });
    }
  }
}

let pool;

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

const canvas = $('map');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
const tiles = new Map(); // key -> {img, ids, structs, slime}
let info = null; // {spawn, strongholds, full}
let worldKey = '';
let drawQueued = false;
let hover = null; // {px, pz}
let iconHits = [];

const view = () => state.views[state.dim];
const worldMsg = () => ({ mc: state.mc, large: state.large, seed: state.seed });

function resetWorld() {
  worldKey = `${state.mc}|${state.large ? 1 : 0}|${state.seed}`;
  tiles.clear();
  pool.clear();
  info = null;
  const key = worldKey;
  pool.enqueue('info|' + key, { type: 'info', ...worldMsg() }, -Infinity, (r) => {
    if (key !== worldKey || !r.ok) return;
    info = { spawn: r.spawn, strongholds: r.strongholds, height: r.height, full: false };
    requestDraw();
    // the remaining strongholds are slow (biome checks); load them last
    pool.enqueue('sh|' + key, { type: 'info', ...worldMsg(), full: true }, 1e15, (r2) => {
      if (key !== worldKey || !r2.ok || !info) return;
      info.strongholds = r2.strongholds; info.full = true;
      requestDraw();
    });
  });
  $('seedInput').value = String(state.seed);
  persist();
  requestDraw();
}

function pickScale(bpp) {
  let s = 4;
  for (const c of [16, 64, 256]) if (c <= bpp * 6) s = c;
  return s;
}

function tileKey(dim, s, tx, tz) { return `${worldKey}|${dim}|${s}|${tx}|${tz}`; }

function makeTileImage(ids) {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const cx = c.getContext('2d');
  const img = cx.createImageData(TILE, TILE);
  const d = img.data;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === 255) { d[i * 4 + 3] = 255; continue; }
    d[i * 4] = colors[id * 3]; d[i * 4 + 1] = colors[id * 3 + 1]; d[i * 4 + 2] = colors[id * 3 + 2]; d[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return c;
}

function requestTile(dim, s, tx, tz, prio) {
  const key = tileKey(dim, s, tx, tz);
  if (tiles.has(key) || pool.has(key)) return key;
  const structTypes = [...structAvail]
    .filter(([id, d]) => d === dim && s <= (STRUCT_BY_ID[id]?.maxScale ?? 64))
    .map(([id]) => id);
  const wk = worldKey;
  pool.enqueue(key, { type: 'tile', ...worldMsg(), dim, scale: s, tx, tz, size: TILE, structTypes, slime: dim === 0 && s === 4 }, prio, (r) => {
    if (wk !== worldKey || !r.ok || !r.ids) return;
    tiles.set(key, { img: makeTileImage(r.ids), ids: r.ids, structs: r.structs, slime: r.slime });
    if (tiles.size > 2500) tiles.delete(tiles.keys().next().value);
    requestDraw();
  });
  return key;
}

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

// Overworld centre used by the search (spawn / 0,0 / custom)
function overworldCenter() {
  if (state.center === 1) return info ? info.spawn : null;
  if (state.center === 2) return { x: state.cx, z: state.cz };
  return { x: 0, z: 0 };
}
function centerFor(dim) {
  const o = overworldCenter();
  if (dim === 0) return o;
  if (dim === -1) return o ? { x: floorDiv(o.x, 8), z: floorDiv(o.z, 8) } : null;
  return { x: 0, z: 0 };
}

const iconCache = new Map();
function icon(color, glyph, shape = 'circle') {
  const k = color + glyph + shape;
  if (iconCache.has(k)) return iconCache.get(k);
  const dpr = window.devicePixelRatio || 1;
  const size = 20;
  const c = document.createElement('canvas');
  c.width = c.height = size * dpr;
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  x.beginPath();
  if (shape === 'diamond') { x.moveTo(10, 1); x.lineTo(19, 10); x.lineTo(10, 19); x.lineTo(1, 10); x.closePath(); }
  else if (shape === 'square') x.rect(2, 2, 16, 16);
  else x.arc(10, 10, 8.5, 0, Math.PI * 2);
  x.fillStyle = color; x.fill();
  x.lineWidth = 1.5; x.strokeStyle = 'rgba(0,0,0,.75)'; x.stroke();
  const rgb = parseInt(color.slice(1), 16);
  const lum = ((rgb >> 16) * 0.3 + ((rgb >> 8) & 255) * 0.59 + (rgb & 255) * 0.11);
  x.fillStyle = lum > 140 ? '#111' : '#fff';
  x.font = `bold ${glyph.length > 1 ? 8 : 10}px system-ui, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(glyph, 10, 10.5);
  iconCache.set(k, c);
  return c;
}

function structDimOf(st) { return structAvail.get(st === END_CITY_SHIP ? 20 : st); }
function structLabel(st) { return st === END_CITY_SHIP ? 'End City w/ ship' : STRUCT_BY_ID[st]?.name ?? '?'; }

// Circles drawn on the map for each filter: [{dim, center, r, label}]
function filterCircles() {
  const out = [];
  const add = (dim, r, label, center) => out.push({ dim, r, label, center: center || centerFor(dim) });
  for (const f of state.filters) {
    const bl = (f.biomes || []).length === 1 ? prettyBiome(meta.biomeName(f.biomes[0])) : 'biomes';
    if (f.type === 'biome') add(f.dim, f.radius, `${bl} (${f.mode})`);
    if (f.type === 'struct' && structDimOf(f.st) !== undefined) add(structDimOf(f.st), f.radius, structLabel(f.st));
    if (f.type === 'cluster' && structDimOf(f.st) !== undefined) add(structDimOf(f.st), f.radius, `${structLabel(f.st)} cluster`);
    if (f.type === 'stronghold') add(0, f.radius, 'Stronghold');
    if (f.type === 'slime') add(0, f.radius, 'Slime chunks');
    if (f.type === 'spawnDist') add(0, f.max, 'Spawn max distance', { x: 0, z: 0 });
  }
  return out;
}

function draw() {
  const v = view();
  const dim = state.dim;
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  ctx.fillStyle = '#141418';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;

  const bx0 = v.x - (W / 2) * v.bpp, bz0 = v.z - (H / 2) * v.bpp;
  const toPx = (bx) => (bx - bx0) / v.bpp;
  const toPz = (bz) => (bz - bz0) / v.bpp;
  const s = pickScale(v.bpp);
  const wanted = new Set();
  if (info === null) wanted.add('info|' + worldKey);
  else if (!info.full) wanted.add('sh|' + worldKey);

  const drawLevel = (sc, prioBase, request) => {
    const span = TILE * sc;
    const tx0 = Math.floor(bx0 / span), tx1 = Math.floor((bx0 + W * v.bpp) / span);
    const tz0 = Math.floor(bz0 / span), tz1 = Math.floor((bz0 + H * v.bpp) / span);
    const out = [];
    for (let tz = tz0; tz <= tz1; tz++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = tileKey(dim, sc, tx, tz);
        const t = tiles.get(key);
        if (t) {
          const x0 = Math.floor(toPx(tx * span)), x1 = Math.floor(toPx((tx + 1) * span));
          const z0 = Math.floor(toPz(tz * span)), z1 = Math.floor(toPz((tz + 1) * span));
          ctx.drawImage(t.img, x0, z0, x1 - x0, z1 - z0);
          out.push(t);
        } else if (request) {
          const cx = (tx + 0.5) * span - v.x, cz = (tz + 0.5) * span - v.z;
          wanted.add(requestTile(dim, sc, tx, tz, prioBase + Math.hypot(cx, cz)));
        }
      }
    return out;
  };

  // coarse fallback first so the screen fills quickly, then full detail
  if (s < 256) drawLevel(s * 4, -1e12, true);
  const drawn = drawLevel(s, 0, true);
  pool.prune(wanted);

  iconHits = [];
  const hidden = state.hidden;

  // slime chunks
  if (dim === 0 && !hidden.has('slime') && s === 4) {
    ctx.fillStyle = 'rgba(80, 220, 90, .38)';
    for (const t of drawn) for (let i = 0; t.slime && i < t.slime.length; i += 2) {
      const x0 = toPx(t.slime[i] * 16), z0 = toPz(t.slime[i + 1] * 16);
      ctx.fillRect(x0, z0, 16 / v.bpp, 16 / v.bpp);
    }
  }

  // grid
  if (!hidden.has('grid')) {
    const target = 120 * v.bpp;
    const step = [16, 64, 128, 256, 512, 1000, 2000, 5000, 10000, 20000, 50000, 100000].find((x) => x >= target) || 200000;
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '10px system-ui'; ctx.textBaseline = 'top';
    ctx.beginPath();
    for (let gx = Math.ceil(bx0 / step) * step; gx < bx0 + W * v.bpp; gx += step) {
      const px = Math.round(toPx(gx)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, H);
    }
    for (let gz = Math.ceil(bz0 / step) * step; gz < bz0 + H * v.bpp; gz += step) {
      const pz = Math.round(toPz(gz)) + 0.5; ctx.moveTo(0, pz); ctx.lineTo(W, pz);
    }
    ctx.stroke();
    for (let gx = Math.ceil(bx0 / step) * step; gx < bx0 + W * v.bpp; gx += step) ctx.fillText(String(gx), toPx(gx) + 3, 44);
    ctx.textBaseline = 'middle';
    for (let gz = Math.ceil(bz0 / step) * step; gz < bz0 + H * v.bpp; gz += step) ctx.fillText(String(gz), 3, toPz(gz) - 6);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.moveTo(Math.round(toPx(0)) + 0.5, 0); ctx.lineTo(Math.round(toPx(0)) + 0.5, H);
    ctx.moveTo(0, Math.round(toPz(0)) + 0.5); ctx.lineTo(W, Math.round(toPz(0)) + 0.5);
    ctx.stroke();
  }

  // filter radius circles
  if (!hidden.has('radius')) {
    ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
    const labelSlots = new Map(); // stack labels of identical circles
    for (const c of filterCircles()) {
      if (c.dim !== dim || !c.center || !(c.r > 0)) continue;
      const rr = c.r / v.bpp;
      const slotKey = `${c.center.x},${c.center.z},${c.r}`;
      const slot = labelSlots.get(slotKey) || 0;
      labelSlots.set(slotKey, slot + 1);
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      if (slot === 0) { ctx.beginPath(); ctx.arc(toPx(c.center.x), toPz(c.center.z), rr, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '11px system-ui'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${c.label} · ${c.r}`, toPx(c.center.x) + rr * 0.72 + 4, toPz(c.center.z) - rr * 0.72 - slot * 13);
    }
    ctx.setLineDash([]);
  }

  const placeIcon = (img, bx, bz, title, sub) => {
    const px = toPx(bx), pz = toPz(bz);
    if (px < -20 || pz < -20 || px > W + 20 || pz > H + 20) return;
    ctx.drawImage(img, px - 10, pz - 10, 20, 20);
    iconHits.push({ px, pz, title, sub, x: bx, z: bz });
  };

  for (const t of drawn) for (const st of t.structs) {
    if (hidden.has('st' + st.t)) continue;
    const d = STRUCT_BY_ID[st.t];
    if (!d) continue;
    let title = d.name;
    if (st.t === 20 && st.ship) title += ' (with ship)';
    if (st.t === 5 && st.ship) {
      const vt = VILLAGE_TYPES.find(([id]) => id === (st.ship & 0xFFFF));
      title = `${vt ? vt[1] : ''} village${st.ship >> 16 ? ' (zombie)' : ''}`.trim();
      title = title[0].toUpperCase() + title.slice(1);
    }
    placeIcon(icon(d.color, d.g), st.x, st.z, title, `${st.x}, ${st.z}`);
  }
  if (dim === 0 && info) {
    if (!hidden.has('sh')) for (const p of info.strongholds) placeIcon(icon('#5b3fa8', 'Sh'), p.x, p.z, 'Stronghold', `${p.x}, ${p.z} (±8)`);
    if (!hidden.has('spawn')) placeIcon(icon('#ffffff', '★', 'diamond'), info.spawn.x, info.spawn.z, 'World spawn', `${info.spawn.x}, ${info.spawn.z}`);
  }
  if (dim === -1 && info && !hidden.has('spawn')) {
    const p = { x: floorDiv(info.spawn.x, 8), z: floorDiv(info.spawn.z, 8) };
    placeIcon(icon('#ffffff', '★', 'diamond'), p.x, p.z, 'Spawn ÷ 8 (portal link)', `${p.x}, ${p.z}`);
  }
  if (dim === 1 && !hidden.has('spawn')) placeIcon(icon('#222222', '◎'), 0, 0, 'Exit portal / dragon island', '0, 0');

  if (s > 64 && dim !== 1) {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(W / 2 - 120, H - 34, 240, 22);
    ctx.fillStyle = '#ccc'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Zoom in to see structures', W / 2, H - 23); ctx.textAlign = 'start';
  }

  updateReadout();
}

function blockAt(px, pz) {
  const v = view();
  return { x: Math.floor(v.x + (px - W / 2) * v.bpp), z: Math.floor(v.z + (pz - H / 2) * v.bpp) };
}

function biomeAtBlock(bx, bz) {
  const v = view();
  let s = pickScale(v.bpp);
  for (; s <= 256; s *= 4) {
    const cx = Math.floor(bx / s), cz = Math.floor(bz / s);
    const tx = Math.floor(cx / TILE), tz = Math.floor(cz / TILE);
    const t = tiles.get(tileKey(state.dim, s, tx, tz));
    if (t) return t.ids[(cz - tz * TILE) * TILE + (cx - tx * TILE)];
  }
  return null;
}

function nearestIcon(px, pz) {
  let best = null, bd = 12;
  for (const ic of iconHits) {
    const d = Math.hypot(ic.px - px, ic.pz - pz);
    if (d < bd) { bd = d; best = ic; }
  }
  return best;
}

function updateReadout() {
  const tip = $('tooltip');
  if (!hover) { $('readout').textContent = ''; tip.hidden = true; return; }
  const b = blockAt(hover.px, hover.pz);
  const id = biomeAtBlock(b.x, b.z);
  const name = id == null ? '…' : id === 255 ? '—' : prettyBiome(meta.biomeName(id));
  let other = '';
  if (state.dim === 0) other = ` · Nether ${floorDiv(b.x, 8)}, ${floorDiv(b.z, 8)}`;
  if (state.dim === -1) other = ` · Overworld ${b.x * 8}, ${b.z * 8}`;
  $('readout').innerHTML = `<b>${name}</b> &nbsp; X ${b.x} &nbsp; Z ${b.z}<span style="color:var(--muted)">${other}</span>`;
  const ic = nearestIcon(hover.px, hover.pz);
  if (ic) {
    tip.hidden = false;
    tip.innerHTML = `<div>${ic.title}</div><div class="sub" style="color:var(--muted)">${ic.sub} · click to copy</div>`;
    tip.style.left = Math.min(ic.px + 14, W - 220) + 'px';
    tip.style.top = (ic.pz + 12) + 'px';
  } else tip.hidden = true;
}

function setupMapInput() {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.offsetX, z: e.offsetY, vx: view().x, vz: view().z, moved: false };
    canvas.classList.add('drag');
  });
  canvas.addEventListener('pointermove', (e) => {
    hover = { px: e.offsetX, pz: e.offsetY };
    if (drag) {
      const dx = e.offsetX - drag.x, dz = e.offsetY - drag.z;
      if (Math.abs(dx) + Math.abs(dz) > 3) drag.moved = true;
      view().x = drag.vx - dx * view().bpp;
      view().z = drag.vz - dz * view().bpp;
      requestDraw();
    } else updateReadout();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved) {
      const ic = nearestIcon(e.offsetX, e.offsetY);
      if (ic) copy(`${ic.x} ~ ${ic.z}`);
    }
    drag = null; canvas.classList.remove('drag');
  });
  canvas.addEventListener('pointerleave', () => { hover = null; updateReadout(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.offsetX, e.offsetY, e.deltaY > 0 ? 1.25 : 0.8);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => zoomAt(e.offsetX, e.offsetY, 0.5));

  $('zoomIn').onclick = () => zoomAt(W / 2, H / 2, 0.5);
  $('zoomOut').onclick = () => zoomAt(W / 2, H / 2, 2);
  $('goOrigin').onclick = () => { view().x = 0; view().z = 0; requestDraw(); };
  $('goSpawn').onclick = () => {
    let p = { x: 0, z: 0 };
    if (info && state.dim === 0) p = info.spawn;
    if (info && state.dim === -1) p = { x: floorDiv(info.spawn.x, 8), z: floorDiv(info.spawn.z, 8) };
    view().x = p.x; view().z = p.z; requestDraw();
  };
  $('gotoForm').onsubmit = (e) => {
    e.preventDefault();
    const m = $('gotoInput').value.match(/(-?\d+)[\s,]+(?:(?:-?\d+|~)[\s,]+)?(-?\d+)/);
    if (!m) return toast('Enter coordinates like: 120, -340');
    view().x = +m[1]; view().z = +m[2]; requestDraw();
  };

  new ResizeObserver(() => {
    const r = $('mapWrap').getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    requestDraw();
  }).observe($('mapWrap'));
}

function zoomAt(px, pz, factor) {
  const v = view();
  const b = { x: v.x + (px - W / 2) * v.bpp, z: v.z + (pz - H / 2) * v.bpp };
  v.bpp = Math.min(512, Math.max(0.25, v.bpp * factor));
  v.x = b.x - (px - W / 2) * v.bpp;
  v.z = b.z - (pz - H / 2) * v.bpp;
  requestDraw();
}

function renderLegend() {
  const el = $('legend');
  el.innerHTML = '';
  el.append(h('div', { class: 'li lhead', onclick: () => { state.legendOpen = !state.legendOpen; renderLegend(); } },
    (state.legendOpen ? '▾ ' : '▸ ') + 'Map layers'));
  if (!state.legendOpen) return;
  const item = (key, img, label) => {
    const c = h('canvas', { width: 20, height: 20 });
    if (img) c.getContext('2d').drawImage(img, 0, 0, 20, 20);
    const li = h('div', { class: 'li' + (state.hidden.has(key) ? ' off' : ''), onclick: () => {
      state.hidden.has(key) ? state.hidden.delete(key) : state.hidden.add(key);
      persist(); renderLegend(); requestDraw();
    } }, c, label);
    el.append(li);
  };
  const dim = state.dim;
  if (dim === 0) {
    item('spawn', icon('#ffffff', '★', 'diamond'), 'World spawn');
    item('sh', icon('#5b3fa8', 'Sh'), 'Stronghold');
    item('slime', icon('#50dc5a', '', 'square'), 'Slime chunks (zoomed in)');
  }
  const seen = new Set();
  for (const s of STRUCTS) {
    if (structAvail.get(s.id) !== dim || seen.has(s.name)) continue;
    seen.add(s.name);
    item('st' + s.id, icon(s.color, s.g), s.name + (s.maxScale ? ' (zoomed in)' : ''));
  }
  item('radius', null, 'Filter radius');
  item('grid', null, 'Grid');
}

// ---------------------------------------------------------------------------
// Version + metadata
// ---------------------------------------------------------------------------

function loadVersionMeta() {
  meta.world(state.mc, state.large, 0n);
  biomes = { 0: [], '-1': [], 1: [] };
  biomeIdByKey = {};
  for (let id = 0; id < 256; id++) {
    const d = meta.biomeDim(id);
    if (d === 99) continue;
    const key = meta.biomeName(id);
    biomeIdByKey[key] = id;
    biomes[d].push({ id, key, name: prettyBiome(key) });
  }
  for (const k in biomes) biomes[k].sort((a, b) => a.name.localeCompare(b.name));
  structAvail = new Map();
  for (const s of STRUCTS) {
    const d = meta.structDim(s.id);
    if (d !== 99) structAvail.set(s.id, d);
  }
}

function setupVersions() {
  const sel = $('version');
  const newest = meta.newest();
  const MC_1_0 = 3;
  for (let mc = newest; mc >= MC_1_0; mc--) {
    const name = meta.mcName(mc);
    if (!name || name === '?') continue;
    let label = 'Java ' + (VERSION_LABELS[name] || name);
    if (mc === newest) label += ' (newest)';
    sel.append(h('option', { value: mc, textContent: label }));
  }
  if (state.mc == null || state.mc > newest || state.mc < MC_1_0) state.mc = newest;
  sel.value = state.mc;
  sel.onchange = () => {
    state.mc = +sel.value;
    stopSearch();
    loadVersionMeta();
    renderFilters(); renderLegend(); resetWorld();
  };
  $('large').checked = state.large;
  $('large').onchange = () => { state.large = $('large').checked; stopSearch(); loadVersionMeta(); resetWorld(); };

  const center = $('center');
  center.value = state.center;
  const syncCenter = () => { $('customCenter').hidden = state.center !== 2; };
  syncCenter();
  center.onchange = () => { state.center = +center.value; syncCenter(); persist(); renderFilters(); requestDraw(); };
  $('cx').value = state.cx; $('cz').value = state.cz;
  $('cx').oninput = (e) => { state.cx = parseInt(e.target.value) || 0; changed(); };
  $('cz').oninput = (e) => { state.cz = parseInt(e.target.value) || 0; changed(); };
}

// ---------------------------------------------------------------------------
// Filters UI
// ---------------------------------------------------------------------------

function newFilter(type) {
  switch (type) {
    case 'spawnBiome': return { type, biomes: [], exclude: false };
    case 'spawnDist': return { type, max: 200, min: 0 };
    case 'spawnHeight': return { type, min: 90, max: 320 };
    case 'biome': return { type, dim: 0, mode: 'any', layer: 'surface', biomes: [], radius: 500, min: 30, max: 100 };
    case 'struct': return { type, st: 5, radius: 500, min: 1, max: '', variant: 0, zombie: 'any' };
    case 'cluster': return { type, st: 3, count: 2, size: 150, radius: 2500 };
    case 'stronghold': return { type, radius: 1500, min: 1 };
    case 'slime': return { type, radius: 64, min: 4 };
  }
}

// Turn preset biome names / group names into ids for the current version.
function resolvePreset(f) {
  const out = { ...newFilter(f.type), ...f };
  if (f.biomeNames) out.biomes = f.biomeNames.map((n) => biomeIdByKey[n]).filter((x) => x !== undefined);
  if (f.group) {
    const g = BIOME_GROUPS.find(([l]) => l === f.group);
    out.biomes = biomes[f.dim ?? 0].filter((b) => g[1](b.key)).map((b) => b.id);
  }
  delete out.biomeNames; delete out.group;
  return out;
}

function biomePicker(f, dim) {
  const chips = h('div', { class: 'chips' });
  for (const id of f.biomes) {
    const sw = h('i');
    sw.style.background = `rgb(${colors[id * 3]},${colors[id * 3 + 1]},${colors[id * 3 + 2]})`;
    chips.append(h('span', { class: 'chip' }, sw, prettyBiome(meta.biomeName(id)),
      h('button', { textContent: '×', title: 'Remove', onclick: () => { f.biomes = f.biomes.filter((b) => b !== id); changed(); renderFilters(); } })));
  }
  const sel = h('select', {}, h('option', { value: '', textContent: f.biomes.length ? '+ Add another biome or group…' : 'Choose biome or group…' }));
  if (dim === 0) {
    const grp = h('optgroup', { label: 'Groups' });
    for (const [label, test] of BIOME_GROUPS) {
      const ids = biomes[0].filter((b) => test(b.key)).map((b) => b.id);
      if (ids.length) grp.append(h('option', { value: 'g:' + label, textContent: `${label} (${ids.length})` }));
    }
    sel.append(grp);
  }
  const one = h('optgroup', { label: 'Biomes' });
  for (const b of biomes[dim]) if (!f.biomes.includes(b.id)) one.append(h('option', { value: b.id, textContent: b.name }));
  sel.append(one);
  sel.onchange = () => {
    const v = sel.value;
    if (v === '') return;
    if (v.startsWith('g:')) {
      const test = BIOME_GROUPS.find(([l]) => l === v.slice(2))[1];
      for (const b of biomes[0]) if (test(b.key) && !f.biomes.includes(b.id)) f.biomes.push(b.id);
    } else f.biomes.push(+v);
    changed(); renderFilters();
  };
  const clear = f.biomes.length > 1 ? h('button', { class: 'mini', textContent: 'Clear', onclick: () => { f.biomes = []; changed(); renderFilters(); } }) : null;
  return h('div', {}, chips, h('div', { class: 'inline', style: 'margin-top:4px' }, sel, clear));
}

function numInput(f, key, { min = -100000, max = 1e7, step = 1, blank = false, width } = {}) {
  const el = h('input', {
    type: 'number', value: f[key] ?? '', min, max, step, placeholder: blank ? 'none' : '',
    oninput: (e) => {
      const raw = e.target.value;
      if (blank && raw === '') f[key] = '';
      else f[key] = Math.min(max, Math.max(min, parseInt(raw) || 0));
      changed();
    },
  });
  if (width) el.style.width = width;
  return el;
}

function selectInput(options, value, onchange) {
  const s = h('select', { onchange: (e) => onchange(e.target.value) });
  for (const [v, label] of options) s.append(h('option', { value: v, textContent: label, selected: String(v) === String(value) }));
  return s;
}

function structSelect(f, allowShip = true) {
  const sel = h('select', { onchange: (e) => { f.st = +e.target.value; changed(); renderFilters(); } });
  for (const d of [0, -1, 1]) {
    const grp = h('optgroup', { label: DIM_NAMES[d] });
    for (const s of STRUCTS) if (structAvail.get(s.id) === d) grp.append(h('option', { value: s.id, textContent: s.name, selected: f.st === s.id }));
    if (allowShip && d === 1 && structAvail.has(20)) grp.append(h('option', { value: END_CITY_SHIP, textContent: 'End City with ship (elytra)', selected: f.st === END_CITY_SHIP }));
    if (grp.children.length) sel.append(grp);
  }
  return sel;
}

const span = (t) => h('span', {}, t);
const centerText = (dim = 0) => {
  if (dim === 1) return 'End 0, 0';
  const base = state.center === 1 ? 'spawn' : state.center === 2 ? `${state.cx}, ${state.cz}` : '0, 0';
  return dim === -1 ? `Nether (${base} ÷ 8)` : base;
};

function renderFilters() {
  const box = $('filters');
  box.innerHTML = '';
  $('noFilters').hidden = state.filters.length > 0;
  state.filters.forEach((f, i) => {
    const tools = h('div', { class: 'ftools' },
      h('button', { textContent: '⧉', title: 'Duplicate', onclick: () => { state.filters.splice(i + 1, 0, JSON.parse(JSON.stringify(f))); changed(); renderFilters(); } }),
      h('button', { textContent: '×', title: 'Remove', onclick: () => { state.filters.splice(i, 1); changed(); renderFilters(); } }));
    let title = '', body = [];
    const warn = (msg) => h('div', { class: 'hint warn' }, msg);

    if (f.type === 'spawnBiome') {
      title = 'Spawn biome';
      body = [
        h('div', { class: 'inline' }, 'Spawn', selectInput([['0', 'is in'], ['1', 'is NOT in']], f.exclude ? 1 : 0, (v) => { f.exclude = v === '1'; changed(); }), 'any of:'),
        biomePicker(f, 0),
      ];
    } else if (f.type === 'spawnDist') {
      title = 'Spawn distance from 0,0';
      body = [h('div', { class: 'inline' }, 'between', numInput(f, 'min', { min: 0 }), 'and', numInput(f, 'max', { min: 0 }), 'blocks')];
    } else if (f.type === 'spawnHeight') {
      title = 'Spawn height';
      body = [h('div', { class: 'inline' }, 'surface Y between', numInput(f, 'min'), 'and', numInput(f, 'max')),
        h('div', { class: 'hint' }, 'Approximate (±5 blocks). Good for "spawn on a mountain" or "spawn low".')];
    } else if (f.type === 'biome') {
      title = 'Biomes near center';
      const dimSel = selectInput([0, -1, 1].filter((d) => biomes[d].length).map((d) => [d, DIM_NAMES[d]]), f.dim, (v) => { f.dim = +v; f.biomes = []; changed(); renderFilters(); });
      const modeSel = selectInput([['any', 'Any of these present'], ['none', 'NONE of these present'], ['all', 'ALL of these present'], ['cover', 'These cover % of area']], f.mode, (v) => { f.mode = v; changed(); renderFilters(); });
      const layerSel = f.dim === 0 ? selectInput(Object.entries(LAYERS).map(([k, [, l]]) => [k, l]), f.layer || 'surface', (v) => { f.layer = v; changed(); }) : null;
      body = [
        h('div', { class: 'inline' }, dimSel, layerSel),
        h('div', { class: 'inline' }, modeSel),
        biomePicker(f, f.dim),
        f.mode === 'cover' ? h('div', { class: 'inline' }, 'covering', numInput(f, 'min', { min: 0, max: 100 }), '–', numInput(f, 'max', { min: 0, max: 100 }), '% of the area') : null,
        h('div', { class: 'inline' }, 'within', numInput(f, 'radius', { min: 8, step: 50 }), 'blocks of', span(centerText(f.dim))),
      ];
    } else if (f.type === 'struct') {
      title = 'Structure count';
      const sd = structDimOf(f.st);
      body = [
        h('div', { class: 'inline' }, structSelect(f)),
        h('div', { class: 'inline' }, 'at least', numInput(f, 'min', { min: 0, width: '60px' }), 'at most', numInput(f, 'max', { min: 0, blank: true, width: '64px' })),
        h('div', { class: 'inline' }, 'within', numInput(f, 'radius', { min: 16, step: 50 }), 'blocks of', span(centerText(sd ?? 0))),
      ];
      if (f.st === 5 && state.mc >= 17) { // 1.14+: village types & zombie villages
        body.push(h('div', { class: 'inline' }, 'Village',
          selectInput(VILLAGE_TYPES, f.variant || 0, (v) => { f.variant = +v; changed(); }),
          selectInput([['any', 'zombie or normal'], ['only', 'zombie only'], ['no', 'no zombie villages']], f.zombie || 'any', (v) => { f.zombie = v; changed(); })));
      }
      if (sd === undefined) body.push(warn('Not available in this version.'));
      if (f.min === 0 && f.max === 0) body.push(h('div', { class: 'hint' }, 'Requires there to be none.'));
    } else if (f.type === 'cluster') {
      title = 'Structure cluster';
      const sd = structDimOf(f.st);
      body = [
        h('div', { class: 'inline' }, numInput(f, 'count', { min: 2, max: 8, width: '56px' }), structSelect(f, false)),
        h('div', { class: 'inline' }, 'all within', numInput(f, 'size', { min: 16, step: 10 }), 'blocks of one of them'),
        h('div', { class: 'inline' }, 'somewhere within', numInput(f, 'radius', { min: 16, step: 100 }), 'of', span(centerText(sd ?? 0))),
        h('div', { class: 'hint' }, 'Swamp huts ×2–4 within ~150 blocks make witch farms; also works for outposts, monuments, etc.'),
      ];
      if (sd === undefined) body.push(warn('Not available in this version.'));
    } else if (f.type === 'stronghold') {
      title = 'Strongholds';
      body = [h('div', { class: 'inline' }, 'at least', numInput(f, 'min', { min: 1, max: 128, width: '56px' }), 'within', numInput(f, 'radius', { min: 16, step: 100 }), 'blocks of', span(centerText(0))),
        h('div', { class: 'hint' }, 'The first ring of 3 strongholds is ~1280–2816 blocks from 0,0.')];
    } else if (f.type === 'slime') {
      title = 'Slime chunks';
      body = [h('div', { class: 'inline' }, 'at least', numInput(f, 'min', { min: 1, width: '56px' }), 'within', numInput(f, 'radius', { min: 8, step: 16 }), 'blocks of', span(centerText(0)))];
    }
    box.append(h('div', { class: 'filter' }, h('div', { class: 'ftitle' }, title, tools), ...body));
  });
}

function changed() { persist(); requestDraw(); }

const FILTER_CODES = { spawnBiome: 1, biome: 2, struct: 3, stronghold: 4, slime: 5, cluster: 6, spawnDist: 7, spawnHeight: 8 };

function encodeFilters() {
  const HDR = 4, REC = 16;
  const arr = new Int32Array(HDR + REC * 32);
  arr[0] = state.center; arr[2] = state.cx; arr[3] = state.cz;
  let n = 0;
  const problems = [];
  for (const f of state.filters) {
    if (n >= 32) { problems.push('At most 32 filters.'); break; }
    const b = HDR + n * REC;
    if ((f.type === 'spawnBiome' || f.type === 'biome') && !f.biomes.length) { problems.push('A biome filter has no biome selected.'); continue; }
    if ((f.type === 'struct' || f.type === 'cluster') && structDimOf(f.st) === undefined) { problems.push(`${structLabel(f.st)} does not exist in this version.`); continue; }
    arr[b] = FILTER_CODES[f.type];
    switch (f.type) {
      case 'spawnBiome': arr[b + 1] = f.exclude ? 1 : 0; break;
      case 'spawnDist': arr[b + 2] = f.max; arr[b + 3] = f.min || 0; break;
      case 'spawnHeight': arr[b + 2] = f.min; arr[b + 3] = f.max; break;
      case 'biome': {
        const qy = f.dim === 0 ? LAYERS[f.layer || 'surface'][0] : f.dim === -1 ? 8 : 16;
        arr[b + 1] = f.dim; arr[b + 2] = f.radius; arr[b + 3] = { any: 0, none: 1, all: 2, cover: 3 }[f.mode] ?? 0;
        arr[b + 4] = qy; arr[b + 5] = f.min ?? 0; arr[b + 6] = f.max ?? 100;
        break;
      }
      case 'struct':
        arr[b + 1] = f.st; arr[b + 2] = f.radius; arr[b + 3] = f.min ?? 1;
        arr[b + 4] = f.max === '' || f.max == null ? -1 : f.max;
        arr[b + 5] = f.st === 5 ? (f.variant || 0) : 0;
        arr[b + 6] = f.st === 5 ? ({ any: 0, only: 1, no: 2 }[f.zombie || 'any']) : 0;
        if (arr[b + 4] >= 0 && arr[b + 4] < arr[b + 3]) problems.push(`${structLabel(f.st)}: "at most" is less than "at least".`);
        break;
      case 'cluster': arr[b + 1] = f.st; arr[b + 2] = f.radius; arr[b + 3] = f.size; arr[b + 4] = f.count; break;
      case 'stronghold': arr[b + 2] = f.radius; arr[b + 3] = f.min || 1; arr[b + 4] = -1; break;
      case 'slime': arr[b + 2] = f.radius; arr[b + 3] = f.min || 1; break;
    }
    for (const id of f.biomes || []) arr[b + 8 + (id >> 5)] |= 1 << (id & 31);
    n++;
  }
  arr[1] = n;
  return { arr, problems };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

let search = null;

function startSearch() {
  const { arr, problems } = encodeFilters();
  if (problems.length) { toast(problems[0]); return; }
  let next = 0n;
  if (state.mode === 'seq') {
    const p = parseSeed(state.startSeed);
    if (p == null) { toast('Enter a start seed'); return; }
    next = p;
  }
  clearResultList();
  const s = {
    workers: [], tested: 0, found: [], seen: new Set(), t0: performance.now(),
    mc: state.mc, large: state.large, filters: arr, random: state.mode === 'random', next,
    max: state.maxResults, firstShown: false,
  };
  search = s;
  const nextJob = (count) => {
    let base;
    if (s.random) base = random64();
    else { base = s.next; s.next = BigInt.asIntN(64, s.next + BigInt(count)); }
    return { type: 'search', mc: s.mc, large: s.large, filters: s.filters, base, count, random: s.random };
  };
  for (let i = 0; i < state.threads; i++) {
    const w = new Worker('./worker.js', { type: 'module' });
    let count = 32;
    w.onmessage = (e) => {
      if (search !== s) return;
      const d = e.data;
      if (d.type === 'ready') { w.postMessage({ ...nextJob(count), id: 1 }); return; }
      if (!d.ok) { toast('Search error: ' + d.error); stopSearch(); return; }
      s.tested += d.tested;
      for (const seed of d.found) addResult(s, seed);
      if (s.found.length >= s.max) { stopSearch(); return; }
      count = Math.max(8, Math.min(200000, Math.round(count * (250 / Math.max(1, d.ms)))));
      w.postMessage({ ...nextJob(count), id: 1 });
    };
    w.postMessage({ type: 'init', module: wasmModule });
    s.workers.push(w);
  }
  s.timer = setInterval(() => updateStats(s), 250);
  setSearchButton(true);
  updateStats(s);
}

function stopSearch() {
  const s = search;
  if (!s) return;
  search = null;
  for (const w of s.workers) w.terminate();
  clearInterval(s.timer);
  updateStats(s, true);
  setSearchButton(false);
}

const ico = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;

function setSearchButton(running) {
  const b = $('searchBtn');
  b.innerHTML = running ? `${ico('stop')}Stop search` : `${ico('play')}Start search`;
  b.classList.toggle('stop', running);
  $('clearResults').disabled = running;
}

function updateResultCount(n = document.querySelectorAll('.result').length) {
  $('resultCount').textContent = `${n}/${search ? search.max : state.maxResults}`;
  $('noResults').hidden = n > 0;
  $('results').hidden = n === 0;
}

function clearResultList() {
  $('results').innerHTML = '';
  $('stats').textContent = '';
  updateResultCount(0);
}

function updateStats(s, done = false) {
  const secs = (performance.now() - s.t0) / 1000;
  const rate = s.tested / Math.max(0.001, secs);
  const rarity = s.found.length ? ` · ≈1 in ${fmt(s.tested / s.found.length)}` : '';
  $('stats').textContent = `${done ? 'Stopped · ' : 'Searching · '}${fmt(s.tested)} checked · ${fmt(rate)}/s${rarity}`;
  updateResultCount(s.found.length);
}

function addResult(s, seed) {
  if (s.found.length >= s.max) return;
  const key = String(seed);
  if (s.seen.has(key)) return;
  s.seen.add(key);
  s.found.push(seed);
  const box = h('span', { class: 'box' }); box.innerHTML = ico('check');
  const copyBtn = h('button', { class: 'copy', title: 'Copy seed', onclick: (e) => { e.stopPropagation(); copy(key); } });
  copyBtn.innerHTML = ico('copy');
  const meta = `Match #${s.found.length} · after ${fmt(s.tested)} seeds`;
  const row = h('div', { class: 'result', onclick: () => showSeed(seed), title: 'Open on the map' },
    box, h('div', { class: 'body' }, h('div', { class: 'title', textContent: key }), h('div', { class: 'meta', textContent: meta })), copyBtn);
  row.dataset.seed = key;
  $('results').append(row);
  updateResultCount(s.found.length);
  if (!s.firstShown) { s.firstShown = true; showSeed(seed); }
}

function showSeed(seed) {
  state.seed = seed;
  for (const k of Object.keys(state.views)) { state.views[k].x = 0; state.views[k].z = 0; }
  for (const r of document.querySelectorAll('.result')) r.classList.toggle('active', r.dataset.seed === String(seed));
  resetWorld();
}

function setupSearchUi() {
  const mode = $('mode');
  mode.value = state.mode;
  $('startWrap').hidden = state.mode !== 'seq';
  mode.onchange = () => { state.mode = mode.value; $('startWrap').hidden = state.mode !== 'seq'; persist(); };
  $('startSeed').value = state.startSeed;
  $('startSeed').oninput = (e) => { state.startSeed = e.target.value; persist(); };
  const th = $('threads');
  th.max = cores; th.value = state.threads; $('threadsVal').textContent = state.threads;
  th.oninput = () => { state.threads = +th.value; $('threadsVal').textContent = th.value; persist(); };
  $('maxResults').value = state.maxResults;
  $('maxResults').oninput = (e) => { state.maxResults = Math.max(1, parseInt(e.target.value) || 1); persist(); if (!search) updateResultCount(); };
  setSearchButton(false);
  updateResultCount(0);
  $('clearResults').onclick = () => { if (!search) clearResultList(); };
  const hist = $('history'), tog = $('historyToggle');
  const setCollapsed = (c) => {
    hist.classList.toggle('collapsed', c);
    tog.title = c ? 'Show results' : 'Hide results';
    localStorage.setItem('seedfinder:resultsHidden', c ? '1' : '');
  };
  setCollapsed(localStorage.getItem('seedfinder:resultsHidden') === '1');
  tog.onclick = () => setCollapsed(!hist.classList.contains('collapsed'));
  $('searchBtn').onclick = () => (search ? stopSearch() : startSearch());

  const add = $('addFilter');
  add.append(h('option', { value: '', textContent: '+ Add filter…' }));
  for (const [grp, items] of FILTER_KINDS) {
    const og = h('optgroup', { label: grp });
    for (const [v, label] of items) og.append(h('option', { value: v, textContent: label }));
    add.append(og);
  }
  add.onchange = (e) => {
    if (!e.target.value) return;
    state.filters.push(newFilter(e.target.value));
    e.target.value = '';
    changed(); renderFilters();
  };

  const pre = $('presets');
  pre.append(h('option', { value: '', textContent: 'Presets…' }));
  PRESETS.forEach(([label], i) => pre.append(h('option', { value: i, textContent: label })));
  pre.onchange = (e) => {
    if (e.target.value === '') return;
    const [label, p] = PRESETS[+e.target.value];
    e.target.value = '';
    stopSearch();
    state.center = p.center; $('center').value = p.center; $('customCenter').hidden = true;
    state.filters = p.filters.map(resolvePreset);
    const missing = state.filters.filter((f) => (f.type === 'biome' || f.type === 'spawnBiome') && !f.biomes.length);
    changed(); renderFilters();
    toast(missing.length ? `Loaded "${label}" — some biomes don't exist in this version` : `Loaded "${label}"`);
  };
  $('clearFilters').onclick = () => { state.filters = []; changed(); renderFilters(); };

  const go = () => {
    const s = parseSeed($('seedInput').value);
    if (s == null) return toast('Type a seed (number or text)');
    showSeed(s);
  };
  $('seedGo').onclick = go;
  $('seedInput').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('seedRandom').onclick = () => showSeed(random64());
  $('seedCopy').onclick = () => copy(String(state.seed));

  for (const b of $('dimTabs').children) {
    b.onclick = () => {
      state.dim = +b.dataset.dim;
      for (const o of $('dimTabs').children) o.classList.toggle('on', o === b);
      renderLegend(); requestDraw();
    };
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function setupResizer() {
  const side = $('side'), bar = $('resizer');
  const apply = (w) => document.documentElement.style.setProperty('--side-w', w + 'px');
  const savedW = +localStorage.getItem('seedfinder:sideW');
  if (savedW) apply(savedW);
  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('drag'); document.body.classList.add('resizing');
    const move = (ev) => apply(Math.max(360, Math.min(window.innerWidth * 0.7, ev.clientX)));
    const up = () => {
      bar.classList.remove('drag'); document.body.classList.remove('resizing');
      bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up);
      localStorage.setItem('seedfinder:sideW', Math.round(side.getBoundingClientRect().width));
    };
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', () => { apply(470); localStorage.removeItem('seedfinder:sideW'); });
}

// Desktop app only: version + update status (window.seedFinderApp comes from electron/preload.cjs)
function setupAppStatus() {
  const api = window.seedFinderApp;
  if (!api) return;
  const el = $('appStatus');
  el.hidden = false;
  let version = '';
  const render = (s) => {
    el.innerHTML = '';
    const ver = h('span', { class: 'ver' }, version ? 'v' + version : '');
    let msg, action = null, cls = '';
    switch (s.state) {
      case 'checking': msg = 'Checking for updates…'; break;
      case 'latest': msg = 'Up to date ✓'; cls = 'ok'; action = ['Check again', () => api.checkForUpdates()]; break;
      case 'downloading': msg = `Downloading v${s.version || '?'}${s.percent ? ' (' + s.percent + '%)' : ''}…`; break;
      case 'ready': msg = `v${s.version} ready`; cls = 'ok'; action = ['Restart to update', () => api.installUpdate()]; break;
      case 'error': msg = "Couldn't check for updates"; cls = 'bad'; action = ['Retry', () => api.checkForUpdates()]; el.title = s.message || ''; break;
      case 'dev': msg = 'Development build (updates off)'; break;
      default: msg = '';
    }
    el.className = cls;
    el.append(ver, h('span', {}, msg));
    if (action) el.append(h('button', { class: 'mini', textContent: action[0], onclick: action[1] }));
  };
  let last = { state: 'idle' };
  api.version().then((v) => { version = v; render(last); });
  api.onUpdate((s) => { last = s || last; render(last); });
}

async function boot() {
  setupResizer();
  setupAppStatus();
  $('loading').hidden = false;
  try {
    wasmModule = await loadModule();
    meta = await createEngine(wasmModule);
  } catch (err) {
    $('loading').textContent = 'Failed to load engine: ' + err.message + ' (open this through start.bat / npm start, not as a file)';
    return;
  }
  colors = meta.colors();
  setupVersions();
  loadVersionMeta();
  pool = new Pool(Math.max(2, Math.min(6, cores - 1)));
  setupMapInput();
  setupSearchUi();
  renderFilters();
  renderLegend();
  resetWorld();
  $('loading').hidden = true;
  console.info('SEEDFINDER_READY');
}

boot();
