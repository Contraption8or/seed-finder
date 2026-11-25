// Ground-truth check: runs an official Minecraft server headless for a seed,
// force-generates areas in all three dimensions, then compares the saved
// region files (exact biomes + structure starts), the world spawn and the
// nearest stronghold against the Seed Finder engine.
//
// usage: node tools/verify-server.mjs <server.jar> <mcEnum> <seed> <workDir> [chunkRadius]
// (running the server requires accepting the Minecraft EULA)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawn } from 'child_process';
import { createEngine } from '../web/wasm-api.js';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const [jar, mcArg, seedArg, work, radArg, wtArg = 'default'] = process.argv.slice(2);
// world type: server level-type + engine world type (single biome = plains, the server default)
const WT = { default: ['minecraft:normal', 0, -1], large: ['minecraft:large_biomes', 1, -1], amplified: ['minecraft:amplified', 2, -1],
  flat: ['minecraft:flat', 3, -1], single: ['minecraft:single_biome_surface', 4, 1] }[wtArg];
if (!WT) throw new Error('world type must be default|large|amplified|flat|single');
const MC = +mcArg, SEED = BigInt(seedArg), R = +(radArg || 12);
const JAVA = process.env.JAVA || 'java';

// ---------------------------------------------------------------- NBT ----
function readNbt(buf) {
  let o = 0;
  const u8 = () => buf[o++];
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const i64 = () => { const v = buf.readBigInt64BE(o); o += 8; return v; };
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: return (buf.readInt8(o++));
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = i32(); const v = buf.subarray(o, o + n); o += n; return v; }
      case 8: return str();
      case 9: { const et = u8(); const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
      case 10: { const obj = {}; for (;;) { const tt = u8(); if (tt === 0) break; const k = str(); obj[k] = payload(tt); } return obj; }
      case 11: { const n = i32(); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i32(); return a; }
      case 12: { const n = i32(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i64(); return a; }
    }
    throw new Error('bad nbt tag ' + t);
  };
  const t = u8(); str(); return payload(t);
}

function readRegion(file) {
  const buf = fs.readFileSync(file);
  const chunks = [];
  if (buf.length < 8192) return chunks; // empty / still being written
  for (let i = 0; i < 1024; i++) {
    const off = buf.readUIntBE(i * 4, 3), cnt = buf[i * 4 + 3];
    if (!off || !cnt) continue;
    const p = off * 4096;
    if (p + 5 > buf.length) continue;
    const len = buf.readInt32BE(p), comp = buf[p + 4];
    if (p + 4 + len > buf.length) continue;
    const data = buf.subarray(p + 5, p + 4 + len);
    let raw;
    if (comp === 1) raw = zlib.gunzipSync(data);
    else if (comp === 2) raw = zlib.inflateSync(data);
    else if (comp === 3) raw = data;
    else throw new Error(`unsupported chunk compression ${comp} in ${file}`);
    chunks.push(readNbt(raw));
  }
  return chunks;
}

function sectionBiomes(sec) {
  const b = sec.biomes;
  if (!b) return null;
  const pal = b.palette;
  const out = new Array(64);
  if (pal.length === 1 || !b.data) { out.fill(pal[0]); return out; }
  const bits = Math.max(1, Math.ceil(Math.log2(pal.length)));
  const per = Math.floor(64 / bits);
  const mask = (1n << BigInt(bits)) - 1n;
  for (let i = 0; i < 64; i++) {
    const L = BigInt.asUintN(64, b.data[Math.floor(i / per)]);
    out[i] = pal[Number((L >> BigInt((i % per) * bits)) & mask)];
  }
  return out; // index (y*4 + z)*4 + x
}

// ------------------------------------------------------------- server ----
function runServer() {
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'eula.txt'), 'eula=true\n');
  fs.writeFileSync(path.join(work, 'server.properties'), [
    `level-seed=${SEED}`, `level-type=${WT[0]}`, 'online-mode=false', 'server-port=25611', 'view-distance=3',
    'simulation-distance=3', 'spawn-protection=0', 'generate-structures=true', 'level-name=world',
    'pause-when-empty-seconds=-1', 'sync-chunk-writes=false', 'max-tick-time=-1', 'motd=verify',
  ].join('\n') + '\n');
  return new Promise((resolve, reject) => {
    const p = spawn(JAVA, ['-Xmx4G', '-jar', path.resolve(jar), 'nogui'], { cwd: work });
    let log = '', phase = 'boot', quietTimer = null, located = null;
    const send = (c) => p.stdin.write(c + '\n');
    const lastOutput = () => { clearTimeout(quietTimer); quietTimer = setTimeout(onQuiet, 20000); };
    const onQuiet = () => {
      if (phase === 'gen') { phase = 'save'; send('save-all flush'); }
    };
    p.stdout.on('data', (d) => {
      const s = d.toString(); log += s;
      if (phase === 'boot' && /Done \(/.test(s)) {
        phase = 'gen';
        const fl = (dim, cx0, cz0, cx1, cz1) => {
          for (let x = cx0; x <= cx1; x += 16) for (let z = cz0; z <= cz1; z += 16) {
            const x1 = Math.min(x + 15, cx1), z1 = Math.min(z + 15, cz1);
            send(`execute in minecraft:${dim} run forceload add ${x * 16} ${z * 16} ${x1 * 16} ${z1 * 16}`);
          }
        };
        fl('overworld', -R, -R, R - 1, R - 1);
        fl('the_nether', -8, -8, 7, 7);
        fl('the_end', -4, -4, 3, 3);
        fl('the_end', 64, -8, 79, 7);
        send('locate structure minecraft:stronghold');
        // LOCATE_AT="x,z;x,z": extra stronghold lookups from those points (debugging)
        for (const pt of (process.env.LOCATE_AT || '').split(';').filter(Boolean)) {
          const [lx, lz] = pt.split(',');
          send(`execute positioned ${lx} 64 ${lz} run locate structure minecraft:stronghold`);
        }
      }
      const m = s.match(/nearest minecraft:stronghold is at \[(-?\d+), [^,]+, (-?\d+)\]/);
      if (m) located = { x: +m[1], z: +m[2] };
      if (phase === 'save' && /Saved the game/.test(s)) { phase = 'stop'; send('stop'); }
      lastOutput();
    });
    p.stderr.on('data', (d) => { log += d.toString(); });
    p.on('exit', (code) => {
      clearTimeout(quietTimer);
      fs.writeFileSync(path.join(work, 'verify-server.log'), log);
      if (phase !== 'stop') reject(new Error(`server exited early (code ${code}); see verify-server.log`));
      else resolve({ located });
    });
    lastOutput();
  });
}

// ---------------------------------------------------------------- main ----
const STRUCT_IDS = (id) => {
  const n = id.replace('minecraft:', '');
  if (n.startsWith('village_')) return 5;
  if (n.startsWith('abandoned_camp')) return 25;
  if (n === 'ruined_portal_nether') return 12;
  if (n.startsWith('ruined_portal')) return 11;
  if (n.startsWith('ocean_ruin')) return 6;
  if (n.startsWith('shipwreck')) return 7;
  return { desert_pyramid: 1, jungle_pyramid: 2, swamp_hut: 3, igloo: 4, monument: 8, mansion: 9,
    pillager_outpost: 10, ancient_city: 13, trail_ruins: 23, trial_chambers: 24, fortress: 18,
    bastion_remnant: 19, end_city: 20 }[n];
};
const DIM_OF = (file) => /DIM-1|the_nether/.test(file) ? -1 : /DIM1|the_end/.test(file) ? 1 : 0;

const t0 = Date.now();
let located = null;
if (!process.env.SKIP_SERVER) ({ located } = await runServer());
console.log(`server done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const eng = await createEngine(await WebAssembly.compile(fs.readFileSync(path.join(here, '../web/engine.wasm'))));
eng.world(MC, WT[1], SEED, WT[2]);
const nameToId = {}; for (let i = 0; i < 256; i++) { const n = eng.biomeName(i); if (n && !(n in nameToId)) nameToId[n] = i; }

const regionFiles = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.mca')) regionFiles.push(p); } };
walk(path.join(work, 'world'));

const report = { biome: {}, struct: {}, spawn: null, stronghold: null };
const LAYERS = { 0: [15, 0, -10], '-1': [8], 1: [16] };
const present = { 0: new Set(), '-1': new Set(), 1: new Set() };
const starts = { 0: [], '-1': [], 1: [] };
const mismatchSamples = [];

for (const file of regionFiles) {
  const dim = DIM_OF(file);
  for (const c of readRegion(file)) {
    const cx = c.xPos, cz = c.zPos;
    if (cx === undefined) continue;
    present[dim].add(cx + ',' + cz);
    for (const [k, s] of Object.entries(c.structures?.starts || {})) {
      if (s.id === 'INVALID') continue;
      const st = STRUCT_IDS(k);
      if (st !== undefined) starts[dim].push({ st, cx: s.ChunkX ?? cx, cz: s.ChunkZ ?? cz, id: k });
    }
    const status = String(c.Status || '').replace('minecraft:', '');
    if (status !== 'full') continue;
    for (const qy of LAYERS[dim]) {
      const secY = Math.floor(qy / 4);
      const sec = (c.sections || []).find((s) => s.Y === secY);
      const truth = sec && sectionBiomes(sec);
      if (!truth) continue;
      const p = eng.ex.eng_map_y(dim, cx * 4, cz * 4, 4, 4, qy);
      const ids = new Int32Array(eng.ex.memory.buffer, p, 16);
      const key = `${dim}@${qy}`;
      const r = report.biome[key] || (report.biome[key] = { cells: 0, bad: 0, pairs: {} });
      for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
        const want = truth[((qy - secY * 4) * 4 + z) * 4 + x].replace('minecraft:', '');
        const got = eng.biomeName(ids[z * 4 + x]);
        r.cells++;
        if (want !== got) {
          r.bad++;
          const pk = `${want} (game) vs ${got} (engine)`;
          r.pairs[pk] = (r.pairs[pk] || 0) + 1;
          if (mismatchSamples.length < 8) mismatchSamples.push({ dim, qy, x: cx * 4 + x, z: cz * 4 + z, want, got });
        }
      }
    }
  }
}

// structures: compare inside the set of chunks the game saved
for (const dim of [0, -1, 1]) {
  const types = [...new Set([...starts[dim].map((s) => s.st), ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 18, 19, 20, 23, 24, 25].filter((st) => eng.structDim(st) === dim)])];
  const xs = [...present[dim]].map((k) => k.split(',').map(Number));
  if (!xs.length) continue;
  const minX = Math.min(...xs.map((a) => a[0])), maxX = Math.max(...xs.map((a) => a[0]));
  const minZ = Math.min(...xs.map((a) => a[1])), maxZ = Math.max(...xs.map((a) => a[1]));
  for (const st of types) {
    const game = new Set(starts[dim].filter((s) => s.st === st).map((s) => s.cx + ',' + s.cz));
    const mine = new Set(eng.structs(st, minX * 16, minZ * 16, maxX * 16 + 15, maxZ * 16 + 15)
      .map((s) => (s.x >> 4) + ',' + (s.z >> 4)).filter((k) => present[dim].has(k)));
    const both = [...game].filter((k) => mine.has(k)).length;
    report.struct[`${dim}:${st}`] = { game: game.size, engine: mine.size, both,
      missed: [...game].filter((k) => !mine.has(k)), extra: [...mine].filter((k) => !game.has(k)) };
  }
}

// spawn + stronghold
const level = readNbt(zlib.gunzipSync(fs.readFileSync(path.join(work, 'world', 'level.dat'))));
const data = level.Data || level;
let gameSpawn = null;
if (data.spawn?.pos) gameSpawn = { x: data.spawn.pos[0], z: data.spawn.pos[2] };
else if (data.SpawnX !== undefined) gameSpawn = { x: data.SpawnX, z: data.SpawnZ };
const engSpawn = eng.spawn();
report.spawn = { game: gameSpawn, engine: engSpawn, dist: gameSpawn ? Math.hypot(gameSpawn.x - engSpawn.x, gameSpawn.z - engSpawn.z) : null };
if (located) {
  const sh = eng.strongholds(128);
  const from = gameSpawn || { x: 0, z: 0 };
  const near = sh.reduce((a, b) => (Math.hypot(b.x - from.x, b.z - from.z) < Math.hypot(a.x - from.x, a.z - from.z) ? b : a));
  report.stronghold = { game: located, engineNearest: near, dist: Math.hypot(located.x - near.x, located.z - near.z) };
}

console.log(`\n=== seed ${SEED}, engine version ${eng.mcName(MC)} ===`);
for (const [k, r] of Object.entries(report.biome)) {
  console.log(`biomes ${k.padEnd(8)} ${r.cells} cells, ${r.bad} mismatched (${(100 * (1 - r.bad / r.cells)).toFixed(3)}% exact)`);
  for (const [p, n] of Object.entries(r.pairs).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`     ${n} × ${p}`);
}
for (const s of mismatchSamples) console.log('   sample', JSON.stringify(s));
for (const [k, s] of Object.entries(report.struct)) {
  if (!s.game && !s.engine) continue;
  const [dim, st] = k.split(':');
  console.log(`struct ${String(eng.ex.eng_struct_name ? '' : '')}${dim}:${st}`.padEnd(14), `game ${s.game}  engine ${s.engine}  agree ${s.both}` +
    (s.missed.length ? `  missed ${s.missed.slice(0, 4).join(' ')}` : '') + (s.extra.length ? `  extra ${s.extra.slice(0, 4).join(' ')}` : ''));
}
console.log('spawn', JSON.stringify(report.spawn));
console.log('stronghold', JSON.stringify(report.stronghold));
fs.writeFileSync(path.join(work, 'verify-report.json'), JSON.stringify(report, null, 1));
