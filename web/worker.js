// Worker: owns one engine instance. Handles map tiles, world info, and
// seed-search batches. Every job carries its own world (mc/large/seed), so
// workers are interchangeable and stateless from the main thread's view.
import { createEngine } from './wasm-api.js';

let eng = null;
let pending = [];

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    eng = await createEngine(msg.module);
    self.postMessage({ type: 'ready' });
    for (const m of pending) handle(m);
    pending = [];
    return;
  }
  if (!eng) { pending.push(msg); return; }
  handle(msg);
};

function handle(msg) {
  try {
    const out = run(msg);
    self.postMessage({ id: msg.id, ok: true, ...out.data }, out.transfer || []);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
  }
}

function run(msg) {
  switch (msg.type) {
    case 'tile': {
      const { mc, large, seed, dim, scale, tx, tz, size, structTypes } = msg;
      eng.world(mc, large, seed);
      const ids = eng.map(dim, scale, tx * size, tz * size, size, size);
      const slime = msg.slime ? eng.slime(tx * size * scale / 16, tz * size * scale / 16, size * scale / 16, size * scale / 16) : null;
      let structs = [];
      if (structTypes && structTypes.length) {
        const span = size * scale;
        const x0 = tx * span, z0 = tz * span;
        for (const st of structTypes) structs = structs.concat(eng.structs(st, x0, z0, x0 + span - 1, z0 + span - 1));
      }
      return { data: { ids, structs, slime }, transfer: ids ? [ids.buffer] : [] };
    }
    case 'info': {
      const { mc, large, seed } = msg;
      eng.world(mc, large, seed);
      if (msg.full) return { data: { strongholds: eng.strongholds(128) } };
      const spawn = eng.spawn();
      const strongholds = eng.strongholds(3);
      return { data: { spawn, strongholds, height: eng.spawnHeight() } };
    }
    case 'search': {
      const { mc, large, filters, base, count, random } = msg;
      eng.world(mc, large, 0n);
      eng.setFilters(filters);
      const t0 = performance.now();
      const found = eng.search(base, count, random);
      return { data: { found, tested: count, ms: performance.now() - t0 } };
    }
  }
  throw new Error('unknown job ' + msg.type);
}
