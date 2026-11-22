# Seed Finder

Find Minecraft **Java Edition** seeds by spawn, biomes and structures, and
browse the Overworld / Nether / End as a biome map with structure markers.
It supports every version from 1.0 up to **26.3**.

## Install

Download **`Seed-Finder-Setup-x.y.z.exe`** from the
[latest release](https://github.com/Contraption8or/seed-finder/releases/latest)
and run it. It installs per-user (no admin needed) and adds a Start-menu
shortcut. The installer isn't code-signed, so Windows SmartScreen may show
"Windows protected your PC"; click **More info → Run anyway**.

**Updates:** every time Seed Finder opens, it checks this repo's Releases. A
newer version downloads in the background, and you're asked to restart when
it's ready (otherwise it installs the next time you close the app). The
version and update status are shown at the bottom of the sidebar.

**Browser version:** no install needed. Double-click `start-web.bat` (needs
Node.js) and it serves the same app at http://localhost:8137.

## Develop

```
npm install
npm start          # run the desktop app from source
npm run smoke      # launch hidden, fail on page errors
npm run dist       # build the installer into release/
```

To publish an update: bump `"version"` in `package.json`, commit, then run
`npm run release`. It builds the installer, tags the commit, and creates the
GitHub Release (needs the GitHub CLI, logged in). Installed copies pick it up
on their next start.

## Filters

All filters must match. Distances are measured from the **world spawn**,
**0,0**, or **custom coordinates** (set at the top). Nether filters measure
from that point ÷ 8, which is where a portal at it would link. End filters
measure from End 0,0. Measuring from 0,0 or custom coordinates is much faster,
because structure positions can be pre-checked without generating biomes.

| Filter | What it does |
|---|---|
| **Spawn biome** | Spawn is / is NOT in any of the chosen biomes |
| **Spawn distance** | Spawn between X and Y blocks from 0,0 |
| **Spawn height** | Approximate surface Y at spawn (mountain or low spawns) |
| **Biomes near center** | *Any of* / *none of* / *all of* the chosen biomes within R, or *cover N–M % of the area*. Works for Overworld (surface, caves y≈0, or deep caves y≈-40), Nether and End |
| **Structure count** | At least N and/or at most M of a structure within R. Use "at most 0" for "none nearby". For villages you can pick the type (plains, desert, savanna, taiga, snowy) and zombie-only or no-zombie |
| **Structure cluster** | N of a structure all within D blocks of each other, somewhere within R (double, triple or quad witch huts, outposts, …) |
| **Strongholds** | At least N strongholds within R |
| **Slime chunks** | At least N slime chunks within R |

Structures: Village, Desert Pyramid, Jungle Temple, Swamp Hut, Igloo, Pillager
Outpost, Woodland Mansion, Ocean Monument, Ocean Ruin, Shipwreck, Buried
Treasure, Ruined Portal (Overworld and Nether), Ancient City, Trail Ruins,
Trial Chambers, **Abandoned Camp (26.3)**, Nether Fortress, Bastion Remnant,
End City and End City with ship. Only structures that exist in the chosen
version are offered.

The biome picker has **groups** (all oceans, land, forests, snowy, mountains,
cave biomes, …), and **Presets…** loads common setups such as speedrun spawn,
mushroom island, survival island, elytra, witch farm, and 26.2/26.3 specials.

## Map

Drag to pan, scroll to zoom, double-click to zoom in. Hovering shows the biome
and coordinates (plus the Nether/Overworld conversion). Click a marker to copy
its coordinates; villages show their type and whether they're zombie villages.
**Map layers** (bottom right) toggles each marker type, slime chunks (when
zoomed in), filter circles and the grid.

## Versions

| Menu entry | Covers | Generation notes |
|---|---|---|
| 26.3 | 26.3 | Dappled Forest; Abandoned Camps; trial chambers can spawn in dappled forest |
| 26.2 | 26.2 | Sulfur Caves (underground cave biome, also snapped to by strongholds) |
| 1.21.9 – 26.1.2 | 1.21.9, 1.21.10, 1.21.11, 26.1, 26.1.1, 26.1.2 | Strongholds can snap to cherry groves |
| 1.21.5 – 1.21.8 | 1.21.5 – 1.21.8 | Pale gardens also generate at negative weirdness; mansions can spawn in them |
| 1.21.4 and older | | Exactly as in cubiomes |

Versions in the same row generate identical worlds. This was checked against
the official data for every release from 1.21.4 to 26.3.

### How 26.x support was built and verified

[cubiomes](https://github.com/Cubitect/cubiomes) (the C library this app uses
for world generation) stops at 1.21.4, so newer versions were added from
official game data:

1. **Biome layout:** the official overworld multi-noise parameter list for
   each version (from [misode/mcmeta](https://github.com/misode/mcmeta)) was
   diffed release by release. Only three changes occurred: 1.21.5 (pale
   garden), 26.2 (sulfur caves) and 26.3 (dappled forest). The Nether and End
   never changed. `tools/rtree.mjs` re-implements the game's biome search tree
   (`Climate.RTree`). `tools/check-rtree.mjs` proves it identical to cubiomes'
   own 1.21.4 tree on 300,000 random and edge-case climate points, including
   the game's warm-start behaviour. `tools/gen-btree.mjs` then builds the
   tables for 1.21.5+, 26.2 and 26.3.
2. **Structures and strongholds:** structure placement (spacing, separation,
   salt) and the biome tags for every structure were diffed per version.
   `tools/check-tags.mjs` confirms every structure and stronghold biome rule
   matches the official tags for 1.21.4 through 26.3.
3. **Ground truth:** `tools/verify-server.mjs` runs the official server
   headless, force-generates areas in all three dimensions, and compares the
   saved chunks with the engine.

Results against the real 26.2 and 26.3 servers (4 seeds, about 200,000 biome
cells across three heights and all dimensions):

- **Biomes:** 99.92–100 % of cells identical. The leftovers are single cells
  exactly on a boundary shared by two biomes, where even the game's answer
  depends on the order chunks happened to generate in. Dappled Forest and
  Sulfur Caves (including where they overlap Lush Caves) are covered.
- **Structures:** every village, Abandoned Camp, trial chamber, ancient city,
  ruined portal, ocean ruin, shipwreck, fortress and bastion matched. There
  were 2 extras (one jungle temple, one trail ruin), see accuracy notes.
- **Spawn point:** identical on all seeds. **Nearest stronghold:** identical.

## Accuracy notes

- Biomes are sampled at the height you choose (surface by default). Cave
  biomes appear when you pick the "caves" layer.
- Some 1.18+ structures (desert pyramids, jungle temples, mansions, and
  occasionally trail ruins) also need suitable terrain height, which can't be
  computed exactly. Rarely, a marked one won't generate.
- Abandoned Camps use the same jigsaw biome check as outposts (start piece
  centre at the surface). All camps tested matched the game.
- Large-radius biome filters sample a coarser grid for speed, so very small
  biome patches can be missed. Coverage % is an estimate from that grid.
- Spawn height is an approximation (±~5 blocks).

## Updating for a future Minecraft version

1. Download the new version's `summary/data/dimension/data.json` and
   `summary/data/tag/worldgen/biome/data.json` from misode/mcmeta into a
   folder, as `<version>-dimension.json` / `<version>-tag_worldgen_biome.json`.
2. Diff them against the previous version. If the biome list changed, add
   the version to `tools/gen-btree.mjs`, add an `MC_*` entry in
   `tools/patch-cubiomes.cjs`, and run `node tools/gen-btree.mjs <folder>`.
3. `node tools/check-tags.mjs <folder>` to compare structure rules.
4. Rebuild: `sh build.sh` (needs `pip install ziglang`).
5. Verify against the real server: `node tools/verify-server.mjs <server.jar>
   <mcEnum> <seed> <workDir>` (running a server means accepting the Minecraft
   EULA).

## Project layout

- `cubiomes/`: cubiomes (MIT) by Cubitect, plus Seed Finder's additions
  (apply to a fresh checkout with `node tools/patch-cubiomes.cjs`;
  `cubiomes/tables/btree_ext.h` is generated).
- `engine/engine.c`: map generation, structure lookup and the filter search.
- `web/`: the UI (`app.js`), worker (`worker.js`), wasm loader (`wasm-api.js`)
  and the compiled `engine.wasm`.
- `tools/`: the data, verification and table-generation scripts described
  above.
