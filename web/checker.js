// Finds filter combinations that can never (or almost never) match, so the
// search doesn't run forever. Errors block the search; warnings don't.
//
// ctx = {
//   wt, fixed,                    world type (0 default,1 large,2 amplified,3 flat,4 single) + fixed biome
//   center, cx, cz,               search centre (0 = 0,0, 1 = spawn, 2 = custom)
//   name(id),                     pretty biome name
//   biomeExists(id, dim),         does the biome exist in this version
//   structInfo(st),               { regionSize, chunkRange, dim, available }
//   allowedBiomes(st, variant),   Set of overworld biome ids the structure's biome check accepts
//   label(st),                    structure name
// }

const SHIP = 100;
// Structures whose biome check happens underground (cave biomes) or never.
const NOT_SURFACE_CHECKED = new Set([11, 12, 13, 24]); // ruined portals, ancient city, trial chambers
const CHEST_STRUCTS = [1, 2, 4, 14, 7, 11, 10];

const list = (ids, name, max = 4) => {
  const n = [...ids].map(name);
  return n.length <= max ? n.join(', ') : n.slice(0, max).join(', ') + ` and ${n.length - max} more`;
};
const isSubset = (a, b) => [...a].every((x) => b.has(x));
const inter = (a, b) => new Set([...a].filter((x) => b.has(x)));

// Upper bound on how many structures of one type can sit within D blocks of
// one of them (regions hold at most one, and neighbours are >= separation apart).
export function clusterBound(info, D) {
  if (!info.available || !info.regionSize) return 0;
  const rs = info.regionSize, cr = info.chunkRange;
  let n = 0;
  const gap = (i) => (i === 0 ? 0 : ((Math.abs(i) - 1) * rs + rs - cr + 1) * 16);
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) if (Math.hypot(gap(i), gap(j)) <= D) n++;
  return n;
}

export function analyze(filters, ctx) {
  const errors = [], warnings = [];
  const err = (msg, ...idx) => errors.push({ msg, idx });
  const warn = (msg, ...idx) => warnings.push({ msg, idx });
  const F = filters.map((f, i) => ({ ...f, i }));
  const single = ctx.wt === 3 || ctx.wt === 4 ? ctx.fixed : -1;
  const singleName = single >= 0 ? ctx.name(single) : '';
  const worldLabel = ctx.wt === 3 ? 'Superflat world (all Plains)' : `Single Biome world (${singleName})`;
  const atSpawn = ctx.center === 1;
  const layerOf = (f) => (f.dim === 0 ? f.layer || 'surface' : 'n/a');

  // --- per-filter checks -------------------------------------------------
  for (const f of F) {
    const ids = new Set(f.biomes || []);
    if (f.type === 'spawnBiome' || f.type === 'biome') {
      const dim = f.type === 'biome' ? f.dim : 0;
      const missing = [...ids].filter((id) => !ctx.biomeExists(id, dim));
      if (missing.length) err(`${list(missing, ctx.name)} ${missing.length === 1 ? "doesn't" : "don't"} exist in this version.`, f.i);
    }
    if (f.type === 'spawnDist' && f.min > f.max) err(`Spawn distance: minimum (${f.min}) is more than maximum (${f.max}).`, f.i);
    if (f.type === 'spawnHeight') {
      if (f.min > f.max) err(`Spawn height: minimum (${f.min}) is more than maximum (${f.max}).`, f.i);
      else if (f.max < -64 || f.min > 320) err('Spawn height is outside the world (Y −64 to 320).', f.i);
      else if (f.min > 256) warn('A spawn surface above Y 256 is extremely rare.', f.i);
    }
    if (f.type === 'biome' && f.mode === 'cover') {
      if (f.min > f.max) err(`Coverage: minimum ${f.min}% is more than maximum ${f.max}%.`, f.i);
      if (f.min > 100) err('Coverage can\'t be more than 100%.', f.i);
    }
    if (f.type === 'spawnBiome' && f.size > 0 && f.exclude) warn('Biome size only applies to "spawn is in", not "is NOT in"; it is ignored here.', f.i);
    if (f.type === 'struct' || f.type === 'cluster') {
      const st = f.st === SHIP ? 20 : f.st;
      const info = ctx.structInfo(st);
      if (!info.available) {
        err(ctx.wt === 3 && info.dim !== -1 && info.dim !== 1
          ? `${ctx.label(f.st)} doesn't generate in Superflat worlds (only villages and strongholds do).`
          : `${ctx.label(f.st)} doesn't exist in this version.`, f.i);
        continue;
      }
      if (f.type === 'struct') {
        const min = f.min ?? 1, max = f.max === '' || f.max == null ? Infinity : f.max;
        if (min > max) err(`${ctx.label(f.st)}: "at least ${min}" is more than "at most ${max}".`, f.i);
        const bound = clusterBound(info, 2 * f.radius);
        if (min > bound) err(`At most ${bound} ${ctx.label(f.st)}${bound === 1 ? '' : 's'} can fit within ${f.radius} blocks (they're spaced ${info.regionSize * 16} blocks apart), so ${min} is impossible.`, f.i);
        if (st === 20 && info.dim === 1 && f.radius < 1008 - 16)
          err(`End Cities never generate within 1008 blocks of the End's center, so a radius of ${f.radius} can never match.`, f.i);
      } else {
        const bound = clusterBound(info, f.size);
        if (f.count > bound) err(`${ctx.label(f.st)}s are spaced so that at most ${bound} can be within ${f.size} blocks of each other; ${f.count} is impossible.`, f.i);
      }
      // single-biome / superflat worlds
      if (single >= 0 && info.dim === 0 && !NOT_SURFACE_CHECKED.has(st)) {
        const ok = ctx.allowedBiomes(st, f.st === 5 ? f.variant || 0 : 0);
        if (!ok.has(single) && (f.type === 'cluster' || (f.min ?? 1) > 0))
          err(`${ctx.label(f.st)}${f.variant ? ` (${ctx.name(f.variant)})` : ''} can't generate in a ${worldLabel}.`, f.i);
      }
    }
    if (f.type === 'stronghold') {
      if (f.min > 128) err('There are only 128 strongholds in a world.', f.i);
      if (ctx.center !== 1) {
        const c = ctx.center === 2 ? Math.hypot(ctx.cx, ctx.cz) : 0;
        // closest possible stronghold to 0,0: first ring starts at 88 chunks (1.9+) or 40 chunks
        // (older), then biome snapping can move it up to 112 blocks
        const nearest = (ctx.mc >= 12 ? 88 * 16 : 40 * 16) - 112 - 16;
        if (f.radius + c < nearest) err(`No stronghold is ever closer than ~${nearest} blocks to 0,0, so a radius of ${f.radius} around ${ctx.center === 2 ? 'that point' : '0,0'} can never match.`, f.i);
      }
    }
    if (f.type === 'slime') {
      let chunks = 0;
      const r = f.radius;
      for (let x = -Math.ceil(r / 16) - 1; x <= Math.ceil(r / 16); x++) for (let z = -Math.ceil(r / 16) - 1; z <= Math.ceil(r / 16); z++)
        if (Math.hypot(x * 16 + 8, z * 16 + 8) <= r + 8) chunks++; // + slack: the centre needn't be chunk-aligned
      if (f.min > chunks) err(`Only about ${chunks} chunks fit within ${r} blocks, so ${f.min} slime chunks is impossible.`, f.i);
      else if (f.min > Math.max(3, chunks * 0.35)) warn(`Only 1 in 10 chunks is a slime chunk; ${f.min} of ~${chunks} will be extremely rare.`, f.i);
    }
    if (f.type === 'chests') {
      if (ctx.wt === 3) err('Superflat worlds have no structures with guaranteed chests.', f.i);
      else if (!CHEST_STRUCTS.some((st) => ctx.structInfo(st).available)) err('No structures with guaranteed chests exist in this version.', f.i);
    }
  }

  // --- single biome / superflat vs biome filters -------------------------
  if (single >= 0) for (const f of F) {
    const ids = new Set(f.biomes || []);
    const has = ids.has(single);
    if (f.type === 'spawnBiome') {
      if (!f.exclude && !has) err(`Spawn can only be in ${singleName} in a ${worldLabel}.`, f.i);
      if (f.exclude && has) err(`The whole ${worldLabel} is ${singleName}, so spawn can't avoid it.`, f.i);
    }
    if (f.type === 'biome' && f.dim === 0) {
      if (f.mode === 'any' && !has) err(`A ${worldLabel} only has ${singleName}.`, f.i);
      if (f.mode === 'all' && [...ids].some((id) => id !== single)) err(`A ${worldLabel} only has ${singleName}, so it can't have all of these.`, f.i);
      if (f.mode === 'none' && has) err(`The whole ${worldLabel} is ${singleName}.`, f.i);
      if (f.mode === 'cover' && ((has && f.max < 100) || (!has && f.min > 0))) err(`In a ${worldLabel} this coverage is always ${has ? 100 : 0}%.`, f.i);
    }
  }

  // --- combinations ------------------------------------------------------
  const spawnIn = F.filter((f) => f.type === 'spawnBiome' && !f.exclude && f.biomes.length);
  const spawnNot = F.filter((f) => f.type === 'spawnBiome' && f.exclude && f.biomes.length);
  if (spawnIn.length) {
    let allowed = new Set(spawnIn[0].biomes);
    for (const f of spawnIn.slice(1)) allowed = inter(allowed, new Set(f.biomes));
    for (const f of spawnNot) for (const id of f.biomes) allowed.delete(id);
    if (!allowed.size) err('Your spawn biome filters contradict each other: no biome satisfies all of them.', ...spawnIn.map((f) => f.i), ...spawnNot.map((f) => f.i));
  }
  const spawnSet = spawnIn.length ? new Set(spawnIn.flatMap((f) => f.biomes).filter((id) => spawnIn.every((g) => g.biomes.includes(id)))) : null;
  const sizeFilter = spawnIn.find((f) => f.size > 0);

  const nones = F.filter((f) => f.type === 'biome' && f.mode === 'none' && f.biomes.length);
  for (const n of nones) {
    const N = new Set(n.biomes);
    // spawn itself is inside every circle around spawn
    if (atSpawn && n.dim === 0 && layerOf(n) === 'surface' && spawnSet && isSubset(spawnSet, N))
      err(`Spawn must be in ${list(spawnSet, ctx.name)}, but you also want none of those within ${n.radius} blocks of spawn.`, n.i, ...spawnIn.map((f) => f.i));
    for (const f of F) {
      if (f === n || f.type !== 'biome' || f.dim !== n.dim || layerOf(f) !== layerOf(n) || f.radius > n.radius) continue;
      const A = new Set(f.biomes);
      if (f.mode === 'any' && A.size && isSubset(A, N)) err(`You want ${list(A, ctx.name)} within ${f.radius} blocks, but none of them within ${n.radius}.`, f.i, n.i);
      if (f.mode === 'all' && [...A].some((id) => N.has(id))) err(`"All of" needs ${list(inter(A, N), ctx.name)} within ${f.radius} blocks, but another filter forbids them within ${n.radius}.`, f.i, n.i);
      if (f.mode === 'cover' && f.min > 0 && isSubset(A, N)) err(`These biomes can't cover ${f.min}% of the area if none of them may appear within ${n.radius} blocks.`, f.i, n.i);
    }
    // a structure needs one of its biomes where it stands
    if (n.dim === 0 && layerOf(n) === 'surface') for (const f of F) {
      if (f.type !== 'struct' || (f.min ?? 1) < 1 || f.radius > n.radius) continue;
      const st = f.st === SHIP ? 20 : f.st;
      const info = ctx.structInfo(st);
      if (!info.available || info.dim !== 0 || NOT_SURFACE_CHECKED.has(st)) continue;
      const ok = ctx.allowedBiomes(st, f.st === 5 ? f.variant || 0 : 0);
      if (ok.size && isSubset(ok, N)) err(`${ctx.label(f.st)} only generates in ${list(ok, ctx.name)}, which you've excluded within ${n.radius} blocks.`, f.i, n.i);
    }
  }

  // structure right on the spawn point vs the spawn biome
  if (atSpawn && spawnSet && spawnSet.size) for (const f of F) {
    if (f.type !== 'struct' || (f.min ?? 1) < 1) continue;
    const st = f.st === SHIP ? 20 : f.st;
    const info = ctx.structInfo(st);
    if (!info.available || info.dim !== 0 || NOT_SURFACE_CHECKED.has(st)) continue;
    const ok = ctx.allowedBiomes(st, f.st === 5 ? f.variant || 0 : 0);
    if (!ok.size || inter(ok, spawnSet).size) continue;
    const what = `${ctx.label(f.st)}${f.st === 5 && f.variant ? ` (${ctx.name(f.variant)})` : ''}`;
    const msg = `${what} only generates in ${list(ok, ctx.name)}, but spawn must be in ${list(spawnSet, ctx.name)}`;
    if (f.radius <= 8) err(`${msg}. Within ${f.radius} blocks it would be standing in the spawn biome, so this can't happen.`, f.i, ...spawnIn.map((s) => s.i));
    else if (sizeFilter && sizeFilter.sizePct >= 100 && f.radius <= sizeFilter.size) err(`${msg}, and the spawn biome must fully cover ${sizeFilter.size} blocks around spawn.`, f.i, sizeFilter.i);
    else if (sizeFilter && f.radius <= sizeFilter.size) warn(`${msg}, and the spawn biome must cover ${sizeFilter.sizePct}% of ${sizeFilter.size} blocks around spawn. Matches will be very rare.`, f.i, sizeFilter.i);
    else if (f.radius <= 64) warn(`${msg}. Within ${f.radius} blocks that's very unlikely.`, f.i, ...spawnIn.map((s) => s.i));
  }

  // "none" and "at least one" of the same structure
  for (const a of F) for (const b of F) {
    if (a.type !== 'struct' || b.type !== 'struct' || a === b || a.st !== b.st) continue;
    if (a.max === 0 && (b.min ?? 1) > 0 && b.radius <= a.radius && a.i < b.i + 1000)
      err(`You want no ${ctx.label(a.st)} within ${a.radius} blocks but at least ${b.min ?? 1} within ${b.radius}.`, a.i, b.i);
  }

  // coverage of disjoint sets over the same area
  const covers = F.filter((f) => f.type === 'biome' && f.mode === 'cover' && f.min > 0);
  for (let x = 0; x < covers.length; x++) for (let y = x + 1; y < covers.length; y++) {
    const a = covers[x], b = covers[y];
    if (a.dim !== b.dim || layerOf(a) !== layerOf(b) || a.radius !== b.radius) continue;
    if (!inter(new Set(a.biomes), new Set(b.biomes)).size && a.min + b.min > 100)
      err(`Two coverage filters need ${a.min}% + ${b.min}% of the same area for different biomes, which is more than 100%.`, a.i, b.i);
  }

  // dedupe (pairs can be reported twice)
  const seen = new Set();
  const uniq = (arr) => arr.filter((e) => (seen.has(e.msg) ? false : seen.add(e.msg)));
  return { errors: uniq(errors), warnings: uniq(warnings) };
}
