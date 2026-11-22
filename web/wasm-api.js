// Shared loader for engine.wasm, used by the main thread (metadata) and by
// every worker (map tiles + seed search). One instance = one world state.

const wasiStub = new Proxy({}, {
  get: (_, name) => (...args) => {
    if (name === 'proc_exit') throw new Error('engine exited with code ' + args[0]);
    return 52; // ENOSYS: the engine never needs real I/O
  },
});

export async function loadModule(url = './engine.wasm') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load ' + url);
  return WebAssembly.compile(await res.arrayBuffer());
}

export async function createEngine(module) {
  const inst = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasiStub });
  const ex = inst.exports;
  if (ex._initialize) ex._initialize();

  const i32 = (ptr, n) => new Int32Array(ex.memory.buffer, ptr, n);
  const str = (ptr) => {
    if (!ptr) return null;
    const u8 = new Uint8Array(ex.memory.buffer);
    let end = ptr;
    while (u8[end]) end++;
    return new TextDecoder().decode(u8.subarray(ptr, end));
  };

  let cur = { mc: -1, large: -1, seed: null };

  const api = {
    ex,
    newest: () => ex.eng_newest(),
    mcName: (mc) => str(ex.eng_mc_name(mc)),
    biomeName: (id) => str(ex.eng_biome_name(id)),
    biomeDim: (id) => ex.eng_biome_dim(id),
    structDim: (st) => ex.eng_struct_dim(st),
    colors: () => new Uint8Array(ex.memory.buffer, ex.eng_colors(), 768).slice(),

    // Only re-applies state that actually changed (applySeed is not free).
    world(mc, large, seed) {
      if (mc !== cur.mc || large !== cur.large) {
        ex.eng_setup(mc, large ? 1 : 0);
        cur.mc = mc; cur.large = large; cur.seed = null;
      }
      if (seed !== cur.seed) {
        ex.eng_seed(BigInt.asIntN(64, seed));
        cur.seed = seed;
      }
    },

    map(dim, scale, x, z, w, h) {
      const p = ex.eng_map(dim, scale, x, z, w, h);
      if (!p) return null;
      const ids = i32(p, w * h);
      const out = new Uint8Array(w * h);
      for (let i = 0; i < ids.length; i++) out[i] = ids[i] < 0 ? 255 : ids[i];
      return out;
    },

    structs(st, x0, z0, x1, z1, max = 2048) {
      const n = ex.eng_structs(st, x0, z0, x1, z1, max);
      const o = i32(ex.eng_out(), n * 3);
      const res = [];
      for (let i = 0; i < n; i++) res.push({ t: st, x: o[i * 3], z: o[i * 3 + 1], ship: o[i * 3 + 2] });
      return res;
    },

    slime(cx0, cz0, w, h) {
      const n = ex.eng_slime(cx0, cz0, w, h);
      return Int32Array.from(i32(ex.eng_out(), n * 2));
    },

    spawnHeight: () => ex.eng_spawn_height(),

    spawn() {
      const o = i32(ex.eng_spawn(), 2);
      return { x: o[0], z: o[1] };
    },

    strongholds(count) {
      const n = ex.eng_strongholds(count);
      const o = i32(ex.eng_out(), n * 3);
      const res = [];
      for (let i = 0; i < n; i++) res.push({ x: o[i * 3], z: o[i * 3 + 1] });
      return res;
    },

    setFilters(int32s) {
      const f = i32(ex.eng_filters(), int32s.length);
      f.set(int32s);
    },

    search(base, count, random) {
      const n = ex.eng_search(BigInt.asIntN(64, base), count, random ? 1 : 0);
      return Array.from(new BigInt64Array(ex.memory.buffer, ex.eng_found(), n));
    },
  };
  return api;
}
