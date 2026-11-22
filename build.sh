#!/bin/sh
# Rebuilds web/engine.wasm from cubiomes + engine/engine.c (needs: pip install ziglang)
cd "$(dirname "$0")"
PY="${PYTHON:-python}"
SRC="engine/engine.c cubiomes/noise.c cubiomes/biomes.c cubiomes/layers.c cubiomes/biomenoise.c cubiomes/generator.c cubiomes/finders.c cubiomes/util.c cubiomes/quadbase.c"
$PY -m ziglang cc -target wasm32-wasi -O3 -mexec-model=reactor -fno-sanitize=undefined \
  -Wno-everything -o web/engine.wasm $SRC -Wl,--export-dynamic -Wl,-z,stack-size=1048576
