// Seed Finder's tiny filter language. One condition per line, all must match.
// It compiles to the same filter objects the visual builder uses, so the
// impossibility checker and the search treat both identically.
//
// ctx = { biomeId(name) -> id|undefined, biomeKeys(dim) -> [names], groups: {name: test(name)},
//         structByName: {name: id}, structName(id) }

export const STRUCT_ALIASES = {
  village: 5, villages: 5, desert_pyramid: 1, pyramid: 1, desert_temple: 1, jungle_temple: 2, jungle_pyramid: 2,
  swamp_hut: 3, witch_hut: 3, hut: 3, igloo: 4, outpost: 10, pillager_outpost: 10, mansion: 9, woodland_mansion: 9,
  monument: 8, ocean_monument: 8, ocean_ruin: 6, ruin: 6, shipwreck: 7, buried_treasure: 14, treasure: 14,
  ruined_portal: 11, portal: 11, nether_portal: 12, ruined_portal_nether: 12, ancient_city: 13, city: 13,
  trail_ruins: 23, trial_chambers: 24, trial_chamber: 24, abandoned_camp: 25, camp: 25,
  fortress: 18, nether_fortress: 18, bastion: 19, bastion_remnant: 19, end_city: 20, end_city_ship: 100, ship: 100,
};
const VILLAGE_KINDS = { plains: 1, desert: 2, savanna: 35, taiga: 5, snowy: 12 };
const WORLD_TYPES = { default: 0, normal: 0, large: 1, large_biomes: 1, amplified: 2, flat: 3, superflat: 3, single: 4, single_biome: 4 };

export const REFERENCE = [
  ['Setup', [
    ['version 26.3', 'Pick the Minecraft version (as in the menu: 26.3, 26.2, 1.21.9, 1.20 …)'],
    ['world amplified', 'World type: default, large_biomes, amplified, superflat, single <biome>'],
    ['center spawn', 'Measure from spawn (default). Also: center 0,0  or  center 500, -1200'],
  ]],
  ['Spawn', [
    ['spawn in cherry_grove, meadow', 'Spawn biome is any of these'],
    ['spawn not in @oceans', 'Spawn biome is none of these'],
    ['spawn in swamp size 500', 'Spawn biome covers ≥90% of a 500-block radius (add 100% for all of it)'],
    ['spawn within 100', 'Spawn is at most 100 blocks from 0,0  (spawn distance 50..200 for a range)'],
    ['spawn height 100..320', 'Approximate surface height at spawn'],
  ]],
  ['Biomes', [
    ['biome jungle within 300', 'Any of the listed biomes within 300 blocks'],
    ['biome none @oceans within 500', 'None of them within 500 blocks'],
    ['biome all cherry_grove, meadow within 600', 'All of them within 600 blocks'],
    ['biome @forests covers 40%..100% within 400', 'They cover 40–100% of the area'],
    ['cave biome lush_caves within 100', 'Caves (y≈0). Also deep biome … (y≈-40), nether biome …, end biome …'],
  ]],
  ['Structures', [
    ['village within 300', 'At least one'],
    ['village >= 2 within 600', 'Counts: >= <= = > <  (village = 0 within 200 means none)'],
    ['village(desert) within 500', 'Village type: plains, desert, savanna, taiga, snowy'],
    ['zombie village within 800', 'Zombie (abandoned) villages only; normal village … excludes them'],
    ['fortress within 100', 'Nether structures measure from spawn ÷ 8'],
    ['end_city_ship within 1500', 'End structures measure from End 0,0'],
    ['swamp_hut cluster 3 within 150 near 2000', '3 huts all within 150 blocks of each other, somewhere within 2000'],
    ['stronghold >= 1 within 1800', 'Strongholds'],
    ['slime >= 4 within 64', 'Slime chunks'],
  ]],
  ['Chests', [
    ['chests >= 3 within 200', 'At least 3 guaranteed loot chests together (within 16 blocks) near the center'],
    ['chests >= 4 within 300 cluster 64', 'Chests counted together if within 64 blocks of each other'],
  ]],
];

export const STARTER = `# Seed Finder code: one condition per line, all must match.
# Lines starting with # are comments. Press "Reference" for everything you can write.
center spawn
spawn in plains, meadow, @forests
village >= 1 within 300
chests >= 3 within 250
biome none @oceans within 200
`;

const NUM = /^-?\d+$/;

export function parse(text, ctx) {
  const filters = [], errors = [], settings = {};
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, li) => {
    const line = raw.replace(/#.*/, '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!line) return;
    const fail = (msg) => errors.push({ line: li + 1, msg });
    try {
      const f = parseLine(line, ctx, settings, fail);
      if (f) { f.line = li + 1; filters.push(f); }
    } catch (e) { fail(e.message); }
  });
  return { filters, errors, settings };
}

function biomeList(str, ctx, dim) {
  const ids = [];
  for (let tok of str.split(',').map((t) => t.trim()).filter(Boolean)) {
    tok = tok.replace(/\s+/g, '_');
    if (tok.startsWith('@')) {
      const g = ctx.groups[tok.slice(1)];
      if (!g) throw new Error(`Unknown group "${tok}". Groups: ${Object.keys(ctx.groups).map((k) => '@' + k).join(', ')}`);
      ctx.biomeKeys(dim).filter(g).forEach((k) => ids.push(ctx.biomeId(k)));
    } else if (tok.includes('*')) {
      const re = new RegExp('^' + tok.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const m = ctx.biomeKeys(dim).filter((k) => re.test(k));
      if (!m.length) throw new Error(`"${tok}" doesn't match any biome in this version.`);
      m.forEach((k) => ids.push(ctx.biomeId(k)));
    } else {
      const id = ctx.biomeId(tok);
      if (id === undefined) throw new Error(`Unknown biome "${tok}"${suggest(tok, ctx.biomeKeys(dim))}.`);
      ids.push(id);
    }
  }
  if (!ids.length) throw new Error('No biomes listed.');
  return [...new Set(ids)];
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function suggest(tok, keys) {
  let close = keys.filter((k) => k.includes(tok) || tok.includes(k));
  if (!close.length) close = keys.map((k) => [k, editDistance(tok, k)]).filter(([, d]) => d <= Math.max(2, tok.length / 4)).sort((a, b) => a[1] - b[1]).map(([k]) => k);
  close = close.slice(0, 3);
  return close.length ? ` (did you mean ${close.join(', ')}?)` : '';
}

const int = (s, what) => {
  if (!NUM.test(s)) throw new Error(`Expected a number for ${what}, got "${s}".`);
  return parseInt(s, 10);
};

function parseLine(line, ctx, settings, fail) {
  let m;
  // --- setup
  if ((m = line.match(/^version (\S+)$/))) { settings.version = m[1]; return null; }
  if ((m = line.match(/^world (\w+)(?: (.+))?$/))) {
    const wt = WORLD_TYPES[m[1]];
    if (wt === undefined) throw new Error(`Unknown world type "${m[1]}". Use default, large_biomes, amplified, superflat or single <biome>.`);
    settings.worldType = wt;
    if (wt === 4) {
      if (!m[2]) throw new Error('Single biome needs a biome, e.g. "world single desert".');
      settings.singleBiome = biomeList(m[2], ctx, 0)[0];
    }
    return null;
  }
  if ((m = line.match(/^center (.+)$/))) {
    const v = m[1].trim();
    if (v === 'spawn') settings.center = { mode: 1 };
    else if (v === '0,0' || v === '0, 0' || v === 'origin') settings.center = { mode: 0 };
    else if ((m = v.match(/^(-?\d+)\s*,?\s*(-?\d+)$/))) settings.center = { mode: 2, x: +m[1], z: +m[2] };
    else throw new Error('Use "center spawn", "center 0,0" or "center X, Z".');
    return null;
  }

  // --- spawn
  if ((m = line.match(/^spawn (not in|in) (.+?)(?: size (\d+)(?: (\d+)%)?)?$/))) {
    const exclude = m[1] === 'not in';
    return { type: 'spawnBiome', exclude, biomes: biomeList(m[2], ctx, 0), size: m[3] ? +m[3] : 0, sizePct: m[4] ? +m[4] : 90 };
  }
  if ((m = line.match(/^spawn within (\d+)(?: of 0,? ?0)?$/))) return { type: 'spawnDist', min: 0, max: +m[1] };
  if ((m = line.match(/^spawn distance (\d+)\s*\.\.\s*(\d+)$/))) return { type: 'spawnDist', min: +m[1], max: +m[2] };
  if ((m = line.match(/^spawn height (-?\d+)\s*\.\.\s*(-?\d+)$/))) return { type: 'spawnHeight', min: +m[1], max: +m[2] };
  if (line.startsWith('spawn')) throw new Error('Spawn lines: spawn in …, spawn not in …, spawn within N, spawn distance A..B, spawn height A..B');

  // --- biomes
  if ((m = line.match(/^(?:(cave|deep|nether|end) )?biome (.+)$/))) {
    const where = m[1] || 'surface';
    const dim = where === 'nether' ? -1 : where === 'end' ? 1 : 0;
    const layer = where === 'cave' ? 'caves' : where === 'deep' ? 'deep' : 'surface';
    let rest = m[2];
    const w = rest.match(/^(.*) within (\d+)$/);
    if (!w) throw new Error('Biome lines need "within <blocks>" at the end.');
    rest = w[1]; const radius = +w[2];
    let mode = 'any', min = 0, max = 100;
    if ((m = rest.match(/^(none|no|all|any) (.+)$/))) { mode = m[1] === 'no' ? 'none' : m[1]; rest = m[2]; }
    if ((m = rest.match(/^(.+) covers (\d+)%(?:\s*\.\.\s*(\d+)%)?$/))) { mode = 'cover'; rest = m[1]; min = +m[2]; max = m[3] ? +m[3] : 100; }
    return { type: 'biome', dim, layer, mode, biomes: biomeList(rest, ctx, dim), radius, min, max };
  }

  // --- chests
  if ((m = line.match(/^chests? (>=|>|=) ?(\d+) within (\d+)(?: cluster (\d+))?$/))) {
    const n = +m[2] + (m[1] === '>' ? 1 : 0);
    return { type: 'chests', min: n, radius: +m[3], size: m[4] ? +m[4] : 16 };
  }
  if (line.startsWith('chest')) throw new Error('Chest lines: chests >= 3 within 200  (optional: cluster 32)');

  // --- strongholds / slime
  if ((m = line.match(/^strongholds? (?:(>=|>|=) ?(\d+) )?within (\d+)$/))) {
    const n = m[2] ? +m[2] + (m[1] === '>' ? 1 : 0) : 1;
    return { type: 'stronghold', min: n, radius: +m[3] };
  }
  if ((m = line.match(/^slime(?: chunks?)? (?:(>=|>|=) ?(\d+) )?within (\d+)$/))) {
    const n = m[2] ? +m[2] + (m[1] === '>' ? 1 : 0) : 1;
    return { type: 'slime', min: n, radius: +m[3] };
  }

  // --- structures
  if ((m = line.match(/^(zombie |normal )?([a-z_]+)(?:\((\w+)\))? cluster (\d+) within (\d+)(?: near (\d+))?$/))) {
    const st = STRUCT_ALIASES[m[2]];
    if (st === undefined) throw new Error(`Unknown structure "${m[2]}"${suggest(m[2], Object.keys(STRUCT_ALIASES))}.`);
    if (st === 100) throw new Error('Clusters work with regular structures, not "end_city_ship".');
    return { type: 'cluster', st, count: +m[4], size: +m[5], radius: m[6] ? +m[6] : 2000 };
  }
  if ((m = line.match(/^(zombie |normal )?([a-z_]+)(?:\((\w+)\))? (?:(>=|<=|=|>|<) ?(\d+) )?within (\d+)$/))) {
    const st = STRUCT_ALIASES[m[2]];
    if (st === undefined) throw new Error(`Unknown structure or command "${m[2]}"${suggest(m[2], Object.keys(STRUCT_ALIASES))}.`);
    const op = m[4] || '>=', n = m[5] ? +m[5] : 1;
    let min = 1, max = '';
    if (op === '>=') min = n; else if (op === '>') min = n + 1;
    else if (op === '=') { min = n; max = n; }
    else if (op === '<=') { min = 0; max = n; }
    else if (op === '<') { min = 0; max = Math.max(0, n - 1); }
    const f = { type: 'struct', st, radius: +m[6], min, max, variant: 0, zombie: 'any' };
    if (m[3]) {
      if (st !== 5) throw new Error('Only villages have a type, e.g. village(desert).');
      const v = VILLAGE_KINDS[m[3]];
      if (v === undefined) throw new Error(`Village types: ${Object.keys(VILLAGE_KINDS).join(', ')}.`);
      f.variant = v;
    }
    if (m[1]) {
      if (st !== 5) throw new Error('"zombie"/"normal" only applies to villages.');
      f.zombie = m[1].trim() === 'zombie' ? 'only' : 'no';
    }
    return f;
  }
  throw new Error(`I don't understand this line. Check the reference for examples.`);
}

// Builder filters -> code (so switching to Code keeps your work)
export function toCode(filters, settings, ctx) {
  const out = ['# Generated from the visual builder. Edit freely; it updates as you type.'];
  if (settings.center === 0) out.push('center 0,0');
  else if (settings.center === 2) out.push(`center ${settings.cx}, ${settings.cz}`);
  else out.push('center spawn');
  const names = (ids) => ids.map(ctx.biomeName).join(', ');
  const sname = (st) => Object.entries(STRUCT_ALIASES).find(([, v]) => v === st)?.[0] ?? String(st);
  for (const f of filters) {
    switch (f.type) {
      case 'spawnBiome':
        out.push(`spawn ${f.exclude ? 'not in' : 'in'} ${names(f.biomes)}${f.size > 0 && !f.exclude ? ` size ${f.size}${f.sizePct && f.sizePct !== 90 ? ` ${f.sizePct}%` : ''}` : ''}`);
        break;
      case 'spawnDist': out.push(f.min ? `spawn distance ${f.min}..${f.max}` : `spawn within ${f.max}`); break;
      case 'spawnHeight': out.push(`spawn height ${f.min}..${f.max}`); break;
      case 'biome': {
        const pre = f.dim === -1 ? 'nether ' : f.dim === 1 ? 'end ' : f.layer === 'caves' ? 'cave ' : f.layer === 'deep' ? 'deep ' : '';
        const body = f.mode === 'cover' ? `${names(f.biomes)} covers ${f.min}%..${f.max}%` : `${f.mode === 'any' ? '' : f.mode + ' '}${names(f.biomes)}`;
        out.push(`${pre}biome ${body} within ${f.radius}`);
        break;
      }
      case 'struct': {
        let s = sname(f.st);
        if (f.st === 5 && f.variant) s += `(${Object.entries(VILLAGE_KINDS).find(([, v]) => v === f.variant)?.[0]})`;
        if (f.st === 5 && f.zombie === 'only') s = 'zombie ' + s;
        if (f.st === 5 && f.zombie === 'no') s = 'normal ' + s;
        const max = f.max === '' || f.max == null ? null : f.max;
        let count = '';
        if (max !== null && max === f.min) count = `= ${max} `;
        else if (max !== null && !f.min) count = `<= ${max} `;
        else if ((f.min ?? 1) !== 1) count = `>= ${f.min} `;
        out.push(`${s} ${count}within ${f.radius}`);
        if (max !== null && f.min && max !== f.min) out.push(`${s} <= ${max} within ${f.radius}`);
        break;
      }
      case 'cluster': out.push(`${sname(f.st)} cluster ${f.count} within ${f.size} near ${f.radius}`); break;
      case 'stronghold': out.push(`stronghold >= ${f.min || 1} within ${f.radius}`); break;
      case 'slime': out.push(`slime >= ${f.min || 1} within ${f.radius}`); break;
      case 'chests': out.push(`chests >= ${f.min} within ${f.radius}${f.size !== 16 ? ` cluster ${f.size}` : ''}`); break;
    }
  }
  return out.join('\n') + '\n';
}
