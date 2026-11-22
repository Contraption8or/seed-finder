// Compares cubiomes' hard-coded structure/stronghold biome rules with the
// official biome tags (misode/mcmeta summary tag/worldgen/biome dumps saved as
// <dir>/<version>-tag_worldgen_biome.json). Usage: node tools/check-tags.mjs <dir>
import fs from 'fs';
import path from 'path';
import { createEngine } from '../web/wasm-api.js';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const dir = process.argv[2];
const eng = await createEngine(await WebAssembly.compile(fs.readFileSync(path.join(here, '../web/engine.wasm'))));

const VERSIONS = { '1.21.4': 28, '1.21.5': 29, '1.21.8': 29, '1.21.9': 30, '1.21.11': 30, '26.1.2': 30, '26.2': 31, '26.3': 32 };
const CHECKS = [
  ['stronghold_biased_to', 'sh'],
  [['village_plains', 'village_desert', 'village_savanna', 'village_snowy', 'village_taiga'], 5],
  ['desert_pyramid', 1], ['jungle_temple', 2], ['swamp_hut', 3], ['igloo', 4],
  [['ocean_ruin_cold', 'ocean_ruin_warm'], 6], [['shipwreck', 'shipwreck_beached'], 7],
  ['ocean_monument', 8], ['woodland_mansion', 9], ['pillager_outpost', 10],
  ['ancient_city', 13], ['trail_ruins', 23], ['trial_chambers', 24], ['mineshaft', 15],
  ['buried_treasure', 14], ['nether_fortress', 18], ['bastion_remnant', 19], ['end_city', 20],
  ['abandoned_camp_*', 25],
];

let problems = 0;
for (const [ver, mc] of Object.entries(VERSIONS)) {
  const file = path.join(dir, `${ver}-tag_worldgen_biome.json`);
  if (!fs.existsSync(file)) { console.log(ver, 'no tag dump, skipped'); continue; }
  const tags = JSON.parse(fs.readFileSync(file, 'utf8'));
  const expand = (name, seen = new Set()) => {
    if (seen.has(name)) return new Set(); seen.add(name);
    const t = tags[name]; const out = new Set();
    for (const v of (t?.values || [])) {
      const id = typeof v === 'string' ? v : v.id;
      if (id.startsWith('#')) for (const x of expand(id.slice(11), seen)) out.add(x);
      else out.add(id.slice(10));
    }
    return out;
  };
  eng.world(mc, false, 0n);
  const names = {}; for (let i = 0; i < 256; i++) { const d = eng.biomeDim(i); if (d !== 99) names[i] = eng.biomeName(i); }
  for (const [tag, st] of CHECKS) {
    const list = Array.isArray(tag) ? tag : tag.endsWith('*') ? Object.keys(tags).filter((k) => k.startsWith('has_structure/' + tag.slice(0, -1))).map((k) => k.slice(14)) : [tag];
    const want = new Set();
    for (const t of list) for (const b of expand(st === 'sh' ? t : 'has_structure/' + t)) want.add(b);
    if (!want.size && st !== 'sh' && eng.structDim(st) === 99) continue;
    const bad = [];
    for (const [id, n] of Object.entries(names)) {
      const got = st === 'sh' ? eng.ex.eng_sh_biome(+id) : eng.ex.eng_viable_biome(st, +id);
      if (!!got !== want.has(n)) bad.push(`${n}: cubiomes=${got ? 'yes' : 'no'} tag=${want.has(n) ? 'yes' : 'no'}`);
    }
    if (bad.length) { problems++; console.log(`${ver} ${Array.isArray(tag) ? tag[0] + '…' : tag}:\n   ` + bad.join('\n   ')); }
  }
}
console.log(problems ? `${problems} rule(s) differ` : 'all structure/stronghold biome rules match the official tags');
