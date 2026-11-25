// Applies Seed Finder's additions (Minecraft 1.21.5 - 26.3) to a fresh
// cubiomes checkout. Run from the repo root: node tools/patch-cubiomes.cjs
// Every replacement must match exactly once, otherwise it aborts.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'cubiomes');

function patch(file, pairs, marker = 'Seed Finder addition') {
  const full = path.join(dir, file);
  const raw = fs.readFileSync(full, 'utf8');
  const crlf = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  if (s.includes(marker)) { console.log(`already patched (${marker})`, file); return; }
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${file}: expected 1 match, got ${n} for: ${a.slice(0, 80)}`);
    s = s.replace(a, b);
  }
  fs.writeFileSync(full, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log('patched', file);
}

patch('biomes.h', [
  [`    MC_1_21_WD, // Winter Drop, version TBA
    MC_1_21 = MC_1_21_WD,
    MC_NEWEST = MC_1_21,`,
   `    MC_1_21_WD, // Winter Drop (1.21.4)
    // --- Seed Finder additions (see tools/gen-btree.mjs) ---
    MC_1_21_5,  // 1.21.5 - 1.21.8: pale gardens also at negative weirdness
    MC_1_21_9,  // 1.21.9 - 26.1.2: strongholds may snap to cherry groves
    MC_26_2,    // 26.2: sulfur caves
    MC_26_3,    // 26.3: dappled forest, abandoned camps
    MC_1_21 = MC_1_21_WD,
    MC_NEWEST = MC_26_3,`],
  [`    pale_garden                     = 186,
};`,
   `    pale_garden                     = 186,
    // 26.2 / 26.3 (Seed Finder addition)
    dappled_forest                  = 187,
    sulfur_caves                    = 188,
};`],
]);

patch('biomes.c', [
  [`        if (id == pale_garden)
            return mc >= MC_1_21_WD;`,
   `        if (id == pale_garden)
            return mc >= MC_1_21_WD;

        // Seed Finder addition
        if (id == sulfur_caves)
            return mc >= MC_26_2;

        if (id == dappled_forest)
            return mc >= MC_26_3;`],
]);

patch('util.c', [
  [`    case MC_1_21_WD: return "1.21 WD"; break;`,
   `    case MC_1_21_WD: return "1.21 WD"; break;
    // Seed Finder addition
    case MC_1_21_5: return "1.21.5"; break;
    case MC_1_21_9: return "1.21.9"; break;
    case MC_26_2:   return "26.2"; break;
    case MC_26_3:   return "26.3"; break;`],
  [`    if (!strcmp(s, "1.21"))     return MC_1_21;`,
   `    if (!strcmp(s, "26.3"))     return MC_26_3;
    if (!strcmp(s, "26.2"))     return MC_26_2;
    if (!strcmp(s, "1.21.9"))   return MC_1_21_9;
    if (!strcmp(s, "1.21.5"))   return MC_1_21_5;
    if (!strcmp(s, "1.21"))     return MC_1_21;`],
  [`    case pale_garden: return "pale_garden";`,
   `    case pale_garden: return "pale_garden";
    case dappled_forest: return "dappled_forest";
    case sulfur_caves: return "sulfur_caves";`],
  [`    setColor(colors, pale_garden,                      0x696d95); // -`,
   `    setColor(colors, pale_garden,                      0x696d95); // -
    setColor(colors, dappled_forest,                   0x6f9a3a);
    setColor(colors, sulfur_caves,                     0xc9b83a);`],
  [`    case Trial_Chambers:    return "trial_chambers";`,
   `    case Trial_Chambers:    return "trial_chambers";
    case Abandoned_Camp:    return "abandoned_camp";`],
]);

patch('finders.h', [
  [`    Trial_Chambers,
    FEATURE_NUM`, `    Trial_Chambers,
    Abandoned_Camp, // 26.3 (Seed Finder addition)
    FEATURE_NUM`],
]);

patch('finders.c', [
  [`    s_trial_chambers        = { 94251327, 34, 22, Trial_Chambers,   0,0},`,
   `    s_trial_chambers        = { 94251327, 34, 22, Trial_Chambers,   0,0},
    s_abandoned_camp        = { 91231127, 37, 29, Abandoned_Camp,   0,0}, // Seed Finder addition`],
  [`    case Trial_Chambers:
        *sconf = s_trial_chambers;
        return mc >= MC_1_21_1;`,
   `    case Trial_Chambers:
        *sconf = s_trial_chambers;
        return mc >= MC_1_21_1;
    case Abandoned_Camp:
        *sconf = s_abandoned_camp;
        return mc >= MC_26_3;`],
  [`    case Trail_Ruins:
    case Trial_Chambers:
        *pos = getFeaturePos(sconf, seed, regX, regZ);
        return 1;`,
   `    case Trail_Ruins:
    case Trial_Chambers:
    case Abandoned_Camp:
        *pos = getFeaturePos(sconf, seed, regX, regZ);
        return 1;`],
  [`    case Mansion:
        if (mc <= MC_1_10) return 0;
        return biomeID == dark_forest || biomeID == dark_forest_hills;`,
   `    case Mansion:
        if (mc <= MC_1_10) return 0;
        if (biomeID == pale_garden) return mc >= MC_1_21_5;
        return biomeID == dark_forest || biomeID == dark_forest_hills;

    case Abandoned_Camp:
        if (mc < MC_26_3) return 0;
        switch (biomeID) {
        case bamboo_jungle: case birch_forest: case cherry_grove:
        case dappled_forest: case flower_forest: case forest: case meadow:
        case old_growth_birch_forest: case old_growth_pine_taiga:
        case old_growth_spruce_taiga: case pale_garden: case savanna:
        case snowy_taiga: case sparse_jungle: case swamp: case taiga:
        case windswept_forest: case wooded_badlands:
            return 1;
        default:
            return 0;
        }`],
  [`    case mangrove_swamp:
    case deep_dark:
        return 0;
    default:
        return 1;
    }
}`,
   `    case mangrove_swamp:
    case deep_dark:
        return 0;
    case cherry_grove:
        return mc >= MC_1_21_9;
    case dappled_forest: // not in #stronghold_biased_to (26.3)
        return 0;
    default:
        return 1;
    }
}`],
  [`    case Ruined_Portal:
    case Ruined_Portal_N:
        if (g->mc <= MC_1_15)
            goto L_not_viable;
        goto L_viable;`,
   `    case Ruined_Portal:
    case Ruined_Portal_N:
        if (g->mc <= MC_1_15)
            goto L_not_viable;
        goto L_viable;
    case Abandoned_Camp:
        if (g->mc < MC_26_3)
            goto L_not_viable;
        {   // jigsaw start piece (a small tent) rotated around the chunk
            // origin; the biome is checked at its centre at surface height
            uint64_t rng = chunkGenerateRnd(g->seed, chunkX, chunkZ);
            switch (nextInt(&rng, 4)) {
                case 0: sampleX = +7; sampleZ = +7; break;
                case 1: sampleX = -7; sampleZ = +7; break;
                case 2: sampleX = -7; sampleZ = -7; break;
                default: sampleX = +7; sampleZ = -7; break;
            }
            sampleX = (chunkX * 32 + sampleX) / 2 >> 2;
            sampleZ = (chunkZ * 32 + sampleZ) / 2 >> 2;
            id = getBiomeAt(g, 0, sampleX, 319>>2, sampleZ);
        }
        if (id < 0 || !isViableFeatureBiome(g->mc, structureType, id))
            goto L_not_viable;
        goto L_viable;`],
]);

patch('biomenoise.c', [
  [`#include "tables/btree21wd.h"`,
   `#include "tables/btree21wd.h"
#include "tables/btree_ext.h" // Seed Finder addition: 1.21.5+ trees`],
  [`    const BiomeTree *bt;
    int idx;

    if (mc >= MC_1_21_WD)`,
   `    const BiomeTree *bt;
    int idx;

    if (mc >= MC_1_21_5)
        return climateToBiomeExt(mc, np, dat);

    if (mc >= MC_1_21_WD)`],
]);

// ---------------------------------------------------------------------------
// Stage 2: world types (Seed Finder world types)
//  - Amplified (1.18+): the overworld offset spline doubles every positive
//    leaf value (v < 0 ? v : 2v), derivatives unchanged. Verified against the
//    official overworld_amplified/offset density function.
//  - Superflat / Single Biome: a fixed overworld biome for every lookup.
// ---------------------------------------------------------------------------
const WT = 'Seed Finder world types';
patch('biomenoise.h', [
  [`int climateToBiome(int mc, const uint64_t np[6], uint64_t *dat);`,
   `int climateToBiome(int mc, const uint64_t np[6], uint64_t *dat);

// ${WT}: set before setupGenerator() / applySeed()
extern int g_sf_amplified;     // 1 = amplified offset spline (1.18+)
extern int g_sf_fixed_biome;   // >= 0: every overworld biome lookup returns this`],
], WT);
patch('biomenoise.c', [
  [`static Spline *createFixSpline(SplineStack *ss, float val)
{`,
   `int g_sf_amplified = 0;    // ${WT}
int g_sf_fixed_biome = -1;

static Spline *createFixSpline(SplineStack *ss, float val)
{
    if (g_sf_amplified && val > 0) // amplified: AMPLIFIED_OFFSET
        val *= 2.0F;`],
  [`int climateToBiome(int mc, const uint64_t np[6], uint64_t *dat)
{`,
   `int climateToBiome(int mc, const uint64_t np[6], uint64_t *dat)
{
    if (g_sf_fixed_biome >= 0) // ${WT}: single biome / superflat
        return g_sf_fixed_biome;`],
], WT);
patch('generator.c', [
  [`int genArea(const Layer *layer, int *out, int areaX, int areaZ, int areaWidth, int areaHeight)
{`,
   `int genArea(const Layer *layer, int *out, int areaX, int areaZ, int areaWidth, int areaHeight)
{
    if (g_sf_fixed_biome >= 0) // ${WT}: single biome / superflat (layered versions)
    {
        for (int i = 0; i < areaWidth * areaHeight; i++) out[i] = g_sf_fixed_biome;
        return 0;
    }`],
], WT);
// Fixed-biome worlds (superflat, single biome): FixedBiomeSource.findBiomeHorizontal
// doesn't scan; it returns a random point in the square around the target.
// (Verified against the official 26.3 server: stronghold rings for seeds 0, 158.)
patch('finders.c', [
  [`    Pos out = {x, z};
    int i, j, found;
    found = 0;
`, `    Pos out = {x, z};
    int i, j, found;
    found = 0;

    if (g_sf_fixed_biome >= 0 && g->dim == DIM_OVERWORLD) // ${WT}
    {
        if (!id_matches(g_sf_fixed_biome, validB, validM))
        {
            if (passes) *passes = 0;
            return out;
        }
        out.x = x - radius + nextInt(rng, 2 * radius + 1);
        out.z = z - radius + nextInt(rng, 2 * radius + 1);
        if (passes) *passes = 1;
        return out;
    }
`],
], WT);
