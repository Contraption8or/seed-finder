// Seed Finder engine: thin WebAssembly-facing wrapper around cubiomes.
// Every exported function works on a single global world state (one wasm
// instance per Web Worker, so there is no sharing between threads).

#include "../cubiomes/generator.h"
#include "../cubiomes/finders.h"
#include "../cubiomes/util.h"
#include <stdlib.h>
#include <string.h>

#define EXPORT(name) __attribute__((export_name(#name)))

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

static int g_mc = MC_NEWEST;
static uint32_t g_flags = 0;
static uint64_t g_seed = 0;
static Generator gO, gN, gE;
static int seededO, seededN, seededE, seededSN;
static SurfaceNoise snEnd;

static int *cache = NULL;
static size_t cacheLen = 0;

static int *ensure_cache(size_t n)
{
    if (n > cacheLen)
    {
        free(cache);
        cache = (int *) malloc(n * sizeof(int));
        cacheLen = cache ? n : 0;
    }
    return cache;
}

static Generator *gen_for(int dim)
{
    if (dim == DIM_NETHER)
    {
        if (!seededN) { applySeed(&gN, DIM_NETHER, g_seed); seededN = 1; }
        return &gN;
    }
    if (dim == DIM_END)
    {
        if (!seededE) { applySeed(&gE, DIM_END, g_seed); seededE = 1; }
        return &gE;
    }
    if (!seededO) { applySeed(&gO, DIM_OVERWORLD, g_seed); seededO = 1; }
    return &gO;
}

static void set_seed(uint64_t seed)
{
    g_seed = seed;
    seededO = seededN = seededE = seededSN = 0;
}

// World types (Java "World Type" button)
enum { WT_DEFAULT = 0, WT_LARGE = 1, WT_AMPLIFIED = 2, WT_FLAT = 3, WT_SINGLE = 4 };
static int g_wt = WT_DEFAULT;

// Superflat ("Classic Flat" preset) only generates villages and strongholds.
static int sf_struct_config(int st, int mc, StructureConfig *sc)
{
    if (!getStructureConfig(st, mc, sc)) return 0;
    if (g_wt == WT_FLAT && sc->dim == DIM_OVERWORLD && st != Village) return 0;
    return 1;
}
#define getStructureConfig sf_struct_config

// Flat worlds (1.19.3+) place strongholds with seed 0, so they are the same in
// every superflat world (ChunkGeneratorStructureState.createForFlat).
static uint64_t stronghold_seed(void) { return (g_wt == WT_FLAT && g_mc >= MC_1_19_4) ? 0 : g_seed; }

// worldType: WT_*; fixedBiome: biome id for WT_SINGLE (ignored otherwise)
EXPORT(eng_setup) void eng_setup(int mc, int worldType, int fixedBiome)
{
    g_mc = mc;
    g_wt = worldType;
    g_flags = worldType == WT_LARGE ? LARGE_BIOMES : 0;
    g_sf_amplified = worldType == WT_AMPLIFIED;
    g_sf_fixed_biome = worldType == WT_FLAT ? plains : worldType == WT_SINGLE ? fixedBiome : -1;
    setupGenerator(&gO, mc, g_flags);
    setupGenerator(&gN, mc, g_flags);
    setupGenerator(&gE, mc, g_flags);
    set_seed(g_seed);
}

EXPORT(eng_seed) void eng_seed(uint64_t seed) { set_seed(seed); }

// ---------------------------------------------------------------------------
// Metadata helpers for the UI
// ---------------------------------------------------------------------------

EXPORT(eng_newest) int eng_newest(void) { return MC_NEWEST; }
EXPORT(eng_mc_name) const char *eng_mc_name(int mc) { return mc2str(mc); }
EXPORT(eng_biome_name) const char *eng_biome_name(int id) { return biome2str(g_mc, id); }
EXPORT(eng_struct_name) const char *eng_struct_name(int st) { return struct2str(st); }

// 0 = overworld, -1 nether, 1 end, 99 = does not exist in this version
EXPORT(eng_biome_dim) int eng_biome_dim(int id)
{
    if (id < 0 || id > 255) return 99;
    if (!biome2str(g_mc, id)) return 99;
    int d = getDimension(id);
    if (d == DIM_OVERWORLD) return isOverworld(g_mc, id) ? 0 : 99;
    if (d == DIM_NETHER) return g_mc >= MC_1_16_1 ? -1 : 99;
    if (d == DIM_END) return g_mc >= MC_1_9 ? 1 : 99;
    return 99;
}

// returns dimension of the structure, or 99 if unavailable in this version
EXPORT(eng_struct_dim) int eng_struct_dim(int st)
{
    StructureConfig sc;
    if (!getStructureConfig(st, g_mc, &sc)) return 99;
    return sc.dim;
}

static unsigned char colors[256][3];
static int colorsInit = 0;
EXPORT(eng_colors) unsigned char *eng_colors(void)
{
    if (!colorsInit) { initBiomeColors(colors); colorsInit = 1; }
    return &colors[0][0];
}

// ---------------------------------------------------------------------------
// Map generation
// ---------------------------------------------------------------------------

static int surface_y(int scale) { return scale == 1 ? 63 : 15; }

// Generates w*h biome ids for cells at 'scale' starting at cell (x,z).
// Returns a pointer to the ids, or NULL on failure.
EXPORT(eng_map) int *eng_map(int dim, int scale, int x, int z, int w, int h)
{
    Generator *g = gen_for(dim);
    Range r = { scale, x, z, w, h, surface_y(scale), 1 };
    size_t n = getMinCacheSize(g, scale, w, 1, h);
    int *buf = ensure_cache(n);
    if (!buf) return NULL;
    if (genBiomes(g, buf, r)) return NULL;
    return buf;
}

EXPORT(eng_biome_at) int eng_biome_at(int dim, int x, int z)
{
    Generator *g = gen_for(dim);
    return getBiomeAt(g, 4, x >> 2, 15, z >> 2);
}

// ---------------------------------------------------------------------------
// Spawn, structures, strongholds
// ---------------------------------------------------------------------------

static int outbuf[4096 * 3];
EXPORT(eng_out) int *eng_out(void) { return outbuf; }

static Pos spawnPos;
static int spawnValid = 0;
static uint64_t spawnSeed = 0;

static Pos spawn_cached(void)
{
    if (!spawnValid || spawnSeed != g_seed || !seededO)
    {
        // superflat worlds always spawn at 0,0 (verified on the official server)
        if (g_wt == WT_FLAT) { spawnPos.x = 0; spawnPos.z = 0; }
        else spawnPos = getSpawn(gen_for(DIM_OVERWORLD));
        spawnSeed = g_seed;
        spawnValid = 1;
    }
    return spawnPos;
}

EXPORT(eng_spawn) int *eng_spawn(void)
{
    Pos p = spawn_cached();
    outbuf[0] = p.x; outbuf[1] = p.z;
    return outbuf;
}

#define ST_END_CITY_SHIP 100

static int end_city_has_ship(int bx, int bz)
{
    static Piece pieces[END_CITY_PIECES_MAX];
    int n = getEndCityPieces(pieces, g_seed, bx >> 4, bz >> 4);
    for (int i = 0; i < n; i++)
        if (pieces[i].type == END_SHIP) return 1;
    return 0;
}

// Viability check. Returns 0 if the structure doesn't generate, otherwise a
// non-zero value; for villages that value is the village biome variant.
// 'flags' is passed through (villages: required biome variant, 0 = any).
static int viable_ex(int st, StructureConfig *sc, int x, int z, uint32_t flags)
{
    Generator *g = gen_for(sc->dim);
    int v = isViableStructurePos(st, g, x, z, flags);
    if (!v) return 0;
    if (sc->dim == DIM_OVERWORLD && g_mc >= MC_1_18)
        if (!isViableStructureTerrain(st, g, x, z)) return 0;
    if (st == End_City)
    {
        if (!seededSN) { initSurfaceNoise(&snEnd, DIM_END, g_seed); seededSN = 1; }
        if (!isViableEndCityTerrain(g, &snEnd, x, z)) return 0;
    }
    return v;
}

static int viable(int st, StructureConfig *sc, int x, int z) { return viable_ex(st, sc, x, z, 0); }

static int village_abandoned(int x, int z, int biome)
{
    StructureVariant sv;
    getVariant(&sv, Village, g_mc, g_seed, x, z, biome);
    return sv.abandoned;
}

// Lists viable structures inside the block rectangle. Results in outbuf as
// (x, z, extra) triples. extra: End City -> 1 if it has a ship;
// Village -> biome variant | (abandoned << 16).
EXPORT(eng_structs) int eng_structs(int st, int x0, int z0, int x1, int z1, int max)
{
    StructureConfig sc;
    if (!getStructureConfig(st, g_mc, &sc)) return 0;
    if (max > 4096) max = 4096;
    int reg = sc.regionSize * 16;
    int rx0 = floordiv(x0, reg) - 1, rx1 = floordiv(x1, reg);
    int rz0 = floordiv(z0, reg) - 1, rz1 = floordiv(z1, reg);
    int n = 0;
    for (int rz = rz0; rz <= rz1; rz++)
    for (int rx = rx0; rx <= rx1; rx++)
    {
        Pos p;
        if (!getStructurePos(st, g_mc, g_seed, rx, rz, &p)) continue;
        if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1) continue;
        int v = viable(st, &sc, p.x, p.z);
        if (!v) continue;
        int extra = 0;
        if (st == End_City) extra = end_city_has_ship(p.x, p.z);
        if (st == Village && g_mc >= MC_1_14) extra = v | (village_abandoned(p.x, p.z, v) << 16);
        outbuf[n*3+0] = p.x;
        outbuf[n*3+1] = p.z;
        outbuf[n*3+2] = extra;
        if (++n >= max) return n;
    }
    return n;
}

EXPORT(eng_strongholds) int eng_strongholds(int count)
{
    if (g_mc < MC_1_0 || count <= 0) return 0;
    if (count > 128) count = 128;
    StrongholdIter sh;
    initFirstStronghold(&sh, g_mc, stronghold_seed());
    Generator *g = gen_for(DIM_OVERWORLD);
    int n = 0;
    while (n < count)
    {
        int more = nextStronghold(&sh, g);
        outbuf[n*3+0] = sh.pos.x;
        outbuf[n*3+1] = sh.pos.z;
        outbuf[n*3+2] = 0;
        n++;
        if (more <= 0) break;
    }
    return n;
}

// Slime chunks in a chunk rectangle -> outbuf (cx, cz) pairs.
EXPORT(eng_slime) int eng_slime(int cx0, int cz0, int w, int h)
{
    int n = 0;
    for (int j = 0; j < h; j++)
    for (int i = 0; i < w && n < 4096; i++)
        if (isSlimeChunk(g_seed, cx0 + i, cz0 + j)) { outbuf[n*2] = cx0 + i; outbuf[n*2+1] = cz0 + j; n++; }
    return n;
}

EXPORT(eng_spawn_height) int eng_spawn_height(void)
{
    static SurfaceNoise sn;
    Pos sp = spawn_cached();
    Generator *g = gen_for(DIM_OVERWORLD);
    initSurfaceNoise(&sn, DIM_OVERWORLD, g_seed);
    float y = 0; int id;
    if (mapApproxHeight(&y, &id, g, &sn, sp.x >> 2, sp.z >> 2, 1, 1)) return -9999;
    return (int) y;
}

// ---------------------------------------------------------------------------
// Seed search
// ---------------------------------------------------------------------------
//
// Header (4 ints): [0] centre mode (0 = 0,0  1 = spawn  2 = custom)
//                  [1] filter count  [2] custom X  [3] custom Z
// Then fixed 16-int records: [0] type  [1..7] params  [8..15] biome bitmask
//
//  1 SPAWN_BIOME   p1 = exclude
//  2 BIOME         p1 = dim, p2 = radius, p3 = mode (0 any, 1 none, 2 all, 3 coverage %)
//                  p4 = quart-y layer, p5 = min %, p6 = max %
//  3 STRUCT        p1 = type, p2 = radius, p3 = min count, p4 = max count (-1 none)
//                  p5 = village variant biome (0 any), p6 = flags (1 zombie only, 2 no zombie)
//  4 STRONGHOLD    p2 = radius, p3 = min, p4 = max (-1 none)
//  5 SLIME         p2 = radius, p3 = min count
//  6 CLUSTER       p1 = type, p2 = search radius, p3 = cluster size (blocks), p4 = count
//  7 SPAWN_DIST    p2 = max distance from 0,0, p3 = min distance
//  8 SPAWN_HEIGHT  p2 = min y, p3 = max y (approximate surface)
//  9 CHESTS        p2 = radius, p3 = min chests, p4 = cluster size (blocks)
//  (1 SPAWN_BIOME also: p2 = biome size radius (0 = off), p3 = min % covered)

enum { F_SPAWN_BIOME = 1, F_BIOME = 2, F_STRUCT = 3, F_STRONGHOLD = 4, F_SLIME = 5,
       F_CLUSTER = 6, F_SPAWN_DIST = 7, F_SPAWN_HEIGHT = 8, F_CHESTS = 9 };
#define FHDR 4
#define FREC 16
#define FMAX 32

static int32_t filters[FHDR + FREC * FMAX];
EXPORT(eng_filters) int32_t *eng_filters(void) { return filters; }

static inline int mask_has(const int32_t *m, int id)
{
    if (id < 0 || id > 255) return 0;
    return (((uint32_t) m[id >> 5]) >> (id & 31)) & 1;
}

static inline long long d2(long long dx, long long dz) { return dx * dx + dz * dz; }

// mode 0: any present, 1: none present, 2: all present, 3: coverage in [lo,hi] %
static int biome_check_lim(int dim, int cx, int cz, int R, const int32_t *mask,
                       int mode, int qy, int lo, int hi, int limit)
{
    Generator *g = gen_for(dim);
    int s = 4;
    while ((2 * R) / s > limit && s < 256) s *= 4;
    int x0 = floordiv(cx - R, s), z0 = floordiv(cz - R, s);
    int x1 = floordiv(cx + R, s), z1 = floordiv(cz + R, s);
    int w = x1 - x0 + 1, h = z1 - z0 + 1;
    Range r = { s, x0, z0, w, h, qy, 1 };
    int *buf = ensure_cache(getMinCacheSize(g, s, w, 1, h));
    if (!buf || genBiomes(g, buf, r)) return 0;
    long long R2 = (long long) R * R;
    long long slack = mode == 3 ? 0 : (long long) s * s; // presence: cells touching the circle
    uint32_t want[8], got[8] = {0};
    for (int k = 0; k < 8; k++) want[k] = (uint32_t) mask[k];
    int total = 0, hit = 0;
    for (int j = 0; j < h; j++)
    for (int i = 0; i < w; i++)
    {
        long long dx = (long long)(x0 + i) * s + s / 2 - cx;
        long long dz = (long long)(z0 + j) * s + s / 2 - cz;
        if (d2(dx, dz) > R2 + slack) continue;
        int id = buf[j * w + i];
        total++;
        if (!mask_has(mask, id)) continue;
        hit++;
        if (mode == 0) return 1;
        if (mode == 1) return 0;
        if (mode == 2) got[id >> 5] |= 1u << (id & 31);
    }
    if (mode == 0) return 0;
    if (mode == 1) return 1;
    if (mode == 2)
    {
        for (int k = 0; k < 8; k++) if ((got[k] & want[k]) != want[k]) return 0;
        return 1;
    }
    if (total == 0) return 0;
    double pct = 100.0 * hit / total;
    return pct >= lo && pct <= hi;
}

static int biome_check(int dim, int cx, int cz, int R, const int32_t *mask,
                       int mode, int qy, int lo, int hi)
{
    int limit = (g_mc >= MC_1_18 || dim != DIM_OVERWORLD) ? 72 : 256;
    if (mode == 3) limit = limit * 2 / 3;
    return biome_check_lim(dim, cx, cz, R, mask, mode, qy, lo, hi, limit);
}

// Structures with guaranteed loot chests -> how many (0 = none guaranteed)
static int chest_count(int st, int x, int z)
{
    switch (st)
    {
    case Desert_Pyramid: return 4;
    case Jungle_Pyramid: return 2;
    case Treasure: case Shipwreck: case Ruined_Portal: case Outpost: return 1;
    case Igloo:
    {
        StructureVariant sv;
        getVariant(&sv, Igloo, g_mc, g_seed, x, z, -1);
        return sv.basement ? 1 : 0;
    }
    }
    return 0;
}

// Is there a spot within R of the centre where structures within D blocks of
// each other add up to >= N guaranteed chests?
static int chests_check(int cx, int cz, int R, int N, int D)
{
    static const int types[] = { Desert_Pyramid, Jungle_Pyramid, Igloo, Treasure, Shipwreck, Ruined_Portal, Outpost };
    static Pos pts[512]; static int cnt[512];
    int np = 0, E = R + D;
    for (size_t t = 0; t < sizeof(types) / sizeof(types[0]); t++)
    {
        int st = types[t];
        StructureConfig sc;
        if (!getStructureConfig(st, g_mc, &sc) || sc.dim != DIM_OVERWORLD) continue;
        int reg = sc.regionSize * 16;
        for (int rz = floordiv(cz - E, reg) - 1; rz <= floordiv(cz + E, reg) && np < 512; rz++)
        for (int rx = floordiv(cx - E, reg) - 1; rx <= floordiv(cx + E, reg) && np < 512; rx++)
        {
            Pos p;
            if (!getStructurePos(st, g_mc, g_seed, rx, rz, &p)) continue;
            if (d2(p.x - cx, p.z - cz) > (long long) E * E) continue;
            int c = chest_count(st, p.x, p.z);
            if (!c || !viable(st, &sc, p.x, p.z)) continue;
            pts[np] = p; cnt[np] = c; np++;
        }
    }
    long long D2 = (long long) D * D;
    for (int i = 0; i < np; i++)
    {
        if (d2(pts[i].x - cx, pts[i].z - cz) > (long long) R * R) continue;
        int n = 0;
        for (int j = 0; j < np; j++)
            if (d2(pts[j].x - pts[i].x, pts[j].z - pts[i].z) <= D2) n += cnt[j];
        if (n >= N) return 1;
    }
    return 0;
}

// Structure placement info for the UI's impossibility checks:
// outbuf = [regionSize, chunkRange, dim, available]
EXPORT(eng_struct_info) int *eng_struct_info(int st)
{
    StructureConfig sc;
    int ok = getStructureConfig(st, g_mc, &sc);
    outbuf[0] = ok ? sc.regionSize : 0; outbuf[1] = ok ? sc.chunkRange : 0;
    outbuf[2] = ok ? sc.dim : 99; outbuf[3] = ok;
    return outbuf;
}

static int struct_base(int st) { return st == ST_END_CITY_SHIP ? End_City : st; }

// Counts candidate positions (no biome check) up to 'limit'.
static int struct_candidates(int st, int cx, int cz, int R, int limit)
{
    StructureConfig sc;
    st = struct_base(st);
    if (!getStructureConfig(st, g_mc, &sc)) return 0;
    int reg = sc.regionSize * 16;
    long long R2 = (long long) R * R;
    int n = 0;
    for (int rz = floordiv(cz - R, reg) - 1; rz <= floordiv(cz + R, reg); rz++)
    for (int rx = floordiv(cx - R, reg) - 1; rx <= floordiv(cx + R, reg); rx++)
    {
        Pos p;
        if (!getStructurePos(st, g_mc, g_seed, rx, rz, &p)) continue;
        if (d2(p.x - cx, p.z - cz) <= R2 && ++n >= limit) return n;
    }
    return n;
}

// Counts viable structures (with variant requirements) up to 'limit'.
static int struct_count(const int32_t *f, int cx, int cz, int limit)
{
    int st = f[1], R = f[2], variant = f[5], flags = f[6];
    int wantShip = (st == ST_END_CITY_SHIP);
    st = struct_base(st);
    StructureConfig sc;
    if (!getStructureConfig(st, g_mc, &sc)) return 0;
    int reg = sc.regionSize * 16;
    long long R2 = (long long) R * R;
    int n = 0;
    for (int rz = floordiv(cz - R, reg) - 1; rz <= floordiv(cz + R, reg); rz++)
    for (int rx = floordiv(cx - R, reg) - 1; rx <= floordiv(cx + R, reg); rx++)
    {
        Pos p;
        if (!getStructurePos(st, g_mc, g_seed, rx, rz, &p)) continue;
        if (d2(p.x - cx, p.z - cz) > R2) continue;
        int v = viable_ex(st, &sc, p.x, p.z, st == Village ? (uint32_t) variant : 0);
        if (!v) continue;
        if (wantShip && !end_city_has_ship(p.x, p.z)) continue;
        if (st == Village && (flags & 3) && g_mc >= MC_1_14)
        {
            int ab = village_abandoned(p.x, p.z, v);
            if ((flags & 1) && !ab) continue;
            if ((flags & 2) && ab) continue;
        }
        if (++n >= limit) return n;
    }
    return n;
}

static int stronghold_count(int cx, int cz, int R, int limit)
{
    StrongholdIter sh;
    Pos ap = initFirstStronghold(&sh, g_mc, stronghold_seed());
    long long R2s = (long long)(R + 112) * (R + 112);
    Generator *g = gen_for(DIM_OVERWORLD);
    double cd = __builtin_sqrt((double) cx * cx + (double) cz * cz);
    int n = 0;
    for (int i = 0; i < 128; i++)
    {
        int near = d2(ap.x - cx, ap.z - cz) <= R2s;
        int more = nextStronghold(&sh, g);
        if (near && d2(sh.pos.x - cx, sh.pos.z - cz) <= (long long) R * R)
            if (++n >= limit) return n;
        if (more <= 0) break;
        ap = sh.nextapprox;
        // rings only grow outward; stop once every remaining one is too far
        if (sh.dist * 16.0 - 224.0 - cd > R) break;
    }
    return n;
}

static int slime_count(int cx, int cz, int R, int limit)
{
    long long R2 = (long long) R * R;
    int n = 0;
    for (int z = floordiv(cz - R, 16); z <= floordiv(cz + R, 16); z++)
    for (int x = floordiv(cx - R, 16); x <= floordiv(cx + R, 16); x++)
    {
        if (d2(x * 16 + 8 - cx, z * 16 + 8 - cz) > R2) continue;
        if (isSlimeChunk(g_seed, x, z) && ++n >= limit) return n;
    }
    return n;
}

// Is there a structure within S of the centre that has >= N of the same type
// (itself included) within D blocks of it?
static int cluster_check(int st, int cx, int cz, int S, int D, int N, int checkViable)
{
    Pos pts[256];
    int np = 0;
    StructureConfig sc;
    st = struct_base(st);
    if (!getStructureConfig(st, g_mc, &sc)) return 0;
    int reg = sc.regionSize * 16, E = S + D;
    for (int rz = floordiv(cz - E, reg) - 1; rz <= floordiv(cz + E, reg) && np < 256; rz++)
    for (int rx = floordiv(cx - E, reg) - 1; rx <= floordiv(cx + E, reg) && np < 256; rx++)
    {
        Pos p;
        if (!getStructurePos(st, g_mc, g_seed, rx, rz, &p)) continue;
        if (d2(p.x - cx, p.z - cz) > (long long) E * E) continue;
        if (checkViable && !viable(st, &sc, p.x, p.z)) continue;
        pts[np++] = p;
    }
    long long D2 = (long long) D * D;
    for (int i = 0; i < np; i++)
    {
        if (d2(pts[i].x - cx, pts[i].z - cz) > (long long) S * S) continue;
        int n = 0;
        for (int j = 0; j < np; j++)
            if (d2(pts[j].x - pts[i].x, pts[j].z - pts[i].z) <= D2) n++;
        if (n >= N) return 1;
    }
    return 0;
}

static int dim_of_struct(int st)
{
    StructureConfig sc;
    if (!getStructureConfig(struct_base(st), g_mc, &sc)) return 99;
    return sc.dim;
}

static int test_seed(uint64_t seed)
{
    set_seed(seed);
    int center = filters[0];
    int nf = filters[1];
    if (nf > FMAX) nf = FMAX;
    int ox = 0, oz = 0;               // overworld centre (when known)
    if (center == 2) { ox = filters[2]; oz = filters[3]; }
    const int fixedCenter = center != 1;

    // Phase A: checks that need neither biomes nor the spawn point.
    for (int i = 0; i < nf; i++)
    {
        const int32_t *f = filters + FHDR + i * FREC;
        if (f[0] == F_SLIME && fixedCenter)
        {
            if (slime_count(ox, oz, f[2], f[3]) < f[3]) return 0;
        }
        else if (f[0] == F_STRUCT || f[0] == F_CLUSTER)
        {
            int sd = dim_of_struct(f[1]);
            if (sd == 99) return 0;
            if (sd != DIM_END && !fixedCenter) continue;
            int cx = sd == DIM_OVERWORLD ? ox : sd == DIM_NETHER ? floordiv(ox, 8) : 0;
            int cz = sd == DIM_OVERWORLD ? oz : sd == DIM_NETHER ? floordiv(oz, 8) : 0;
            if (f[0] == F_STRUCT)
            {
                int mn = f[3];
                if (mn > 0 && struct_candidates(f[1], cx, cz, f[2], mn) < mn) return 0;
            }
            else if (!cluster_check(f[1], cx, cz, f[2], f[3], f[4], 0)) return 0;
        }
    }

    if (center == 1)
    {
        Pos sp = spawn_cached();
        ox = sp.x; oz = sp.z;
    }
    const int nx = floordiv(ox, 8), nz = floordiv(oz, 8); // nether centre

    // Phase B: cheapest first.
    for (int pass = 0; pass < 3; pass++)
    for (int i = 0; i < nf; i++)
    {
        const int32_t *f = filters + FHDR + i * FREC;
        switch (f[0])
        {
        case F_SPAWN_DIST:
            if (pass != 0) break;
            {
                Pos sp = spawn_cached();
                long long dd = d2(sp.x, sp.z);
                if (dd > (long long) f[2] * f[2]) return 0;
                if (dd < (long long) f[3] * f[3]) return 0;
            }
            break;
        case F_SPAWN_BIOME:
            if (pass == 0)
            {
                Pos sp = spawn_cached();
                int id = getBiomeAt(gen_for(DIM_OVERWORLD), 4, sp.x >> 2, 15, sp.z >> 2);
                if (mask_has(f + 8, id) == (f[1] != 0)) return 0;
            }
            else if (pass == 2 && f[2] > 0 && !f[1])
            {   // biome size: the spawn biome(s) cover >= p3 % of a radius-p2 circle
                Pos sp = spawn_cached();
                if (!biome_check_lim(DIM_OVERWORLD, sp.x, sp.z, f[2], f + 8, 3, 15,
                                     f[3] > 0 ? f[3] : 90, 100, 112)) return 0;
            }
            break;
        case F_CHESTS:
            if (pass != 1) break;
            if (!chests_check(ox, oz, f[2], f[3], f[4] > 0 ? f[4] : 16)) return 0;
            break;
        case F_SPAWN_HEIGHT:
            if (pass != 0) break;
            {
                int y = eng_spawn_height();
                if (y < f[2] || y > f[3]) return 0;
            }
            break;
        case F_SLIME:
            if (pass != 1 || fixedCenter) break;
            if (slime_count(ox, oz, f[2], f[3]) < f[3]) return 0;
            break;
        case F_STRUCT:
            if (pass != 1) break;
            {
                int sd = dim_of_struct(f[1]);
                int cx = sd == DIM_OVERWORLD ? ox : sd == DIM_NETHER ? nx : 0;
                int cz = sd == DIM_OVERWORLD ? oz : sd == DIM_NETHER ? nz : 0;
                int mn = f[3], mx = f[4];
                int limit = mx >= 0 ? mx + 1 : (mn > 0 ? mn : 1);
                int n = struct_count(f, cx, cz, limit);
                if (n < mn) return 0;
                if (mx >= 0 && n > mx) return 0;
            }
            break;
        case F_CLUSTER:
            if (pass != 1) break;
            {
                int sd = dim_of_struct(f[1]);
                int cx = sd == DIM_OVERWORLD ? ox : sd == DIM_NETHER ? nx : 0;
                int cz = sd == DIM_OVERWORLD ? oz : sd == DIM_NETHER ? nz : 0;
                if (!cluster_check(f[1], cx, cz, f[2], f[3], f[4], 1)) return 0;
            }
            break;
        case F_STRONGHOLD:
            if (pass != 1) break;
            {
                int mn = f[3] > 0 ? f[3] : 0, mx = f[4];
                int limit = mx >= 0 ? mx + 1 : (mn > 0 ? mn : 1);
                int n = stronghold_count(ox, oz, f[2], limit);
                if (n < mn) return 0;
                if (mx >= 0 && n > mx) return 0;
            }
            break;
        case F_BIOME:
            if (pass != 2) break;
            {
                int dim = f[1];
                int cx = dim == DIM_OVERWORLD ? ox : dim == DIM_NETHER ? nx : 0;
                int cz = dim == DIM_OVERWORLD ? oz : dim == DIM_NETHER ? nz : 0;
                if (!biome_check(dim, cx, cz, f[2], f + 8, f[3], f[4], f[5], f[6])) return 0;
            }
            break;
        }
    }
    return 1;
}

static uint64_t splitmix(uint64_t x)
{
    x += 0x9E3779B97F4A7C15ULL;
    x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ULL;
    x = (x ^ (x >> 27)) * 0x94D049BB133111EBULL;
    return x ^ (x >> 31);
}

static uint64_t found[256];
EXPORT(eng_found) uint64_t *eng_found(void) { return found; }

// Tests 'count' seeds. random=1: seeds are splitmix(base+i), else base+i.
// Matching seeds are written to found[]; returns how many (<= 256).
EXPORT(eng_search) int eng_search(uint64_t base, int count, int random)
{
    int n = 0;
    for (int i = 0; i < count && n < 256; i++)
    {
        uint64_t s = random ? splitmix(base + (uint64_t) i) : base + (uint64_t) i;
        if (test_seed(s)) found[n++] = s;
    }
    return n;
}

// ---------------------------------------------------------------------------
// Verification helpers (used by tools/verify-server.mjs and tools/check-tags.mjs)
// ---------------------------------------------------------------------------

int isStrongholdBiome(int mc, int id);

// Biome ids for w*h cells at scale 4 and a given quart-Y.
EXPORT(eng_map_y) int *eng_map_y(int dim, int x, int z, int w, int h, int qy)
{
    Generator *g = gen_for(dim);
    Range r = { 4, x, z, w, h, qy, 1 };
    int *buf = ensure_cache(getMinCacheSize(g, 4, w, 1, h));
    if (!buf || genBiomes(g, buf, r)) return NULL;
    return buf;
}

EXPORT(eng_viable_biome) int eng_viable_biome(int st, int id) { return isViableFeatureBiome(g_mc, st, id); }
EXPORT(eng_sh_biome) int eng_sh_biome(int id) { return isStrongholdBiome(g_mc, id); }
