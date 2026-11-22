// Re-implementation of Minecraft's Climate.RTree (biome parameter search
// tree) so biome tables for versions newer than cubiomes can be built from
// the official multi-noise parameter list.
//
// Leaves/nodes carry `space`: 7 [min,max] pairs (temperature, humidity,
// continentalness, erosion, depth, weirdness, offset), quantized like
// Climate.quantizeCoord: (long)(value * 10000f).

export const quantize = (v) => Math.trunc(Math.fround(Math.fround(v) * 10000));
const P = 7;
const CHILDREN = 6;
const mid = (p) => Math.trunc((p[0] + p[1]) / 2); // Java long division
const ldiv = Math.trunc;

export function leafFromEntry(e, biomeId) {
  const p = e.parameters;
  const r = (v) => (Array.isArray(v) ? [quantize(v[0]), quantize(v[1])] : [quantize(v), quantize(v)]);
  const space = [r(p.temperature), r(p.humidity), r(p.continentalness), r(p.erosion), r(p.depth), r(p.weirdness), r(p.offset ?? 0)];
  return { leaf: true, space, biome: biomeId, name: e.biome };
}

function subTree(children) {
  const space = [];
  for (let i = 0; i < P; i++) {
    let lo = Infinity, hi = -Infinity;
    for (const c of children) { lo = Math.min(lo, c.space[i][0]); hi = Math.max(hi, c.space[i][1]); }
    space.push([lo, hi]);
  }
  return { leaf: false, space, children };
}

function cost(space) { let c = 0; for (const p of space) c += Math.abs(p[1] - p[0]); return c; }

function sortNodes(nodes, dim, absolute) {
  const key = (n, d) => { const m = mid(n.space[d]); return absolute ? Math.abs(m) : m; };
  nodes.sort((a, b) => {
    for (let i = 0; i < P; i++) {
      const d = (dim + i) % P;
      const x = key(a, d), y = key(b, d);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });
}

function bucketize(nodes) {
  const buckets = [];
  let cur = [];
  const size = Math.trunc(Math.pow(6.0, Math.floor(Math.log(nodes.length - 0.01) / Math.log(6.0))));
  for (const n of nodes) {
    cur.push(n);
    if (cur.length >= size) { buckets.push(subTree(cur)); cur = []; }
  }
  if (cur.length) buckets.push(subTree(cur));
  return buckets;
}

function build(nodes) {
  if (nodes.length === 1) return nodes[0];
  if (nodes.length <= CHILDREN) {
    const sumKey = (n) => { let s = 0; for (let i = 0; i < P; i++) s += Math.abs(mid(n.space[i])); return s; };
    nodes.sort((a, b) => sumKey(a) - sumKey(b));
    return subTree(nodes);
  }
  let bestCost = Infinity, bestDim = -1, bestBuckets = null;
  for (let d = 0; d < P; d++) {
    sortNodes(nodes, d, false);
    const buckets = bucketize(nodes);
    let c = 0;
    for (const b of buckets) c += cost(b.space);
    if (bestCost > c) { bestCost = c; bestDim = d; bestBuckets = buckets; }
  }
  sortNodes(bestBuckets, bestDim, true);
  return subTree(bestBuckets.map((b) => build(b.children.slice())));
}

export function buildTree(leaves) { return build(leaves.slice()); }

export function dist(node, t) {
  let s = 0;
  for (let i = 0; i < P; i++) {
    const p = node.space[i];
    const v = i < 6 ? t[i] : 0;
    const a = v - p[1], b = p[0] - v;
    const d = a > 0 ? a : Math.max(b, 0);
    s += d * d;
  }
  return s;
}

// Climate.RTree.SubTree.search
export function search(node, t, candidate) {
  if (node.leaf) return node;
  let bestDist = candidate ? dist(candidate, t) : Infinity;
  let best = candidate;
  for (const child of node.children) {
    const cd = dist(child, t);
    if (bestDist > cd) {
      const lf = search(child, t, best);
      const ld = child === lf ? cd : dist(lf, t);
      if (bestDist > ld) { bestDist = ld; best = lf; }
    }
  }
  return best;
}

// Flatten into arrays for C: nodes in DFS order, each node = 6 param-index
// bytes (into a shared, deduplicated param table) + child start + count, or
// leaf biome. Offset is always zero in vanilla overworld data (checked by the
// caller), so only 6 dimensions are emitted.
export function flatten(root) {
  const params = new Map();
  const pid = (p) => { const k = p[0] + ',' + p[1]; if (!params.has(k)) params.set(k, params.size); return params.get(k); };
  const out = [];
  const walk = (n) => {
    const idx = out.length;
    const rec = { p: n.space.slice(0, 6).map(pid), leaf: n.leaf, biome: n.biome ?? 0, first: 0, count: 0 };
    out.push(rec);
    if (!n.leaf) {
      // children are laid out contiguously right after their parent block
      const kids = n.children;
      rec.count = kids.length;
      rec.pending = kids;
    }
    return idx;
  };
  // BFS so each node's children are contiguous
  walk(root);
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (!r.pending) continue;
    r.first = out.length;
    for (const k of r.pending) walk(k);
    delete r.pending;
  }
  const ptab = [...params.keys()].map((k) => k.split(',').map(Number));
  return { nodes: out, params: ptab };
}
