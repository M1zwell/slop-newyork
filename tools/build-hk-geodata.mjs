// tools/build-hk-geodata.mjs
// Builds js/nyc-geodata.js for Hong Kong Central / Victoria Harbour v1 (same GEO schema as the NYC builder).
// Frame: 1 unit = 1 m, x = east, z = south (north = -z), origin at Pedder St × Des Voeux Rd Central, bearing 0°.
// Sources: © OpenStreetMap contributors (ODbL) via Overpass — see tools/data-hk/.
// usage: GEO_DATA=tools/data-hk node --max-old-space-size=4096 tools/build-hk-geodata.mjs [out.js]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = process.env.GEO_DATA || fileURLToPath(new URL('data-hk/', import.meta.url));
const OUT = process.argv[2] || fileURLToPath(new URL('../js/nyc-geodata.js', import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const log = (...a) => console.log('[hk-geodata]', ...a);

// =====================================================================================================================
// FRAME — Central / Victoria Harbour
// =====================================================================================================================
const LAT0 = 22.28155; // Pedder St × Des Voeux Rd Central (approx)
const LON0 = 114.15785;
const A = 6378137.0;
const E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180;
const SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;
const THETA = 0; // Central streets run roughly E–W → grid-east = true east
const ORIGIN = [0, 0];

const enu = (lon, lat) => [(lon - LON0) * KX, (lat - LAT0) * KY];
function gridUV(lon, lat) {
  const [e, n] = enu(lon, lat);
  const c = Math.cos(THETA);
  const s = Math.sin(THETA);
  return [e * c - n * s, -(e * s + n * c)];
}
const toWorld = (lon, lat) => {
  const [u, v] = gridUV(lon, lat);
  return [u - ORIGIN[0], v - ORIGIN[1]];
};

const q = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [q(x), q(z)]);
const r1 = (x) => Math.round(x * 10) / 10;

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, x1, z0, z1 };
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
function rdpRing(ring, eps) {
  if (ring.length < 4) return ring.slice();
  let i0 = 0;
  let far = 0, i1 = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[i0][0], ring[i][1] - ring[i0][1]);
    if (d > far) { far = d; i1 = i; }
  }
  const a = rdp(ring.slice(i0, i1 + 1), eps);
  const b = rdp([...ring.slice(i1), ring[i0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
const centroid = (r) => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length];

function elemRing(e) {
  if (e.type === 'way') return (e.geometry || []).map((g) => toWorld(g.lon, g.lat));
  let best = [];
  for (const m of e.members || []) if (m.role === 'outer' && m.geometry && m.geometry.length > best.length) best = m.geometry.map((g) => toWorld(g.lon, g.lat));
  return best;
}
function elemRings(e) {
  if (e.type === 'way') return [(e.geometry || []).map((g) => toWorld(g.lon, g.lat))];
  const parts = (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => toWorld(g.lon, g.lat)));
  const rings = [];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  while (parts.length) {
    let ring = parts.shift();
    for (let guard = 0; guard < 200 && !close(ring[0], ring[ring.length - 1]); guard++) {
      const i = parts.findIndex((p) => close(p[0], ring[ring.length - 1]) || close(p[p.length - 1], ring[ring.length - 1]));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(close(p[0], ring[ring.length - 1]) ? p.slice(1) : p.reverse().slice(1));
    }
    rings.push(ring);
  }
  return rings;
}

function chainCoastline(osm) {
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry && e.nodes);
  const byStart = new Map();
  for (const w of ways) byStart.set(w.nodes[0], w);
  const used = new Set();
  const chains = [];
  for (const w of ways) {
    if (used.has(w.id)) continue;
    let first = w;
    const seen = new Set([w.id]);
    for (;;) {
      const prev = ways.find((u) => !seen.has(u.id) && u.nodes[u.nodes.length - 1] === first.nodes[0]);
      if (!prev) break;
      seen.add(prev.id);
      first = prev;
      if (prev.id === w.id) break;
    }
    const nodes = [];
    let cur = first;
    while (cur && !used.has(cur.id)) {
      used.add(cur.id);
      const g = cur.geometry.map((p) => toWorld(p.lon, p.lat));
      nodes.push(...(nodes.length ? g.slice(1) : g));
      cur = byStart.get(cur.nodes[cur.nodes.length - 1]);
    }
    chains.push(nodes);
  }
  return chains;
}

// =====================================================================================================================
// COASTLINE → island outline (HK Island north shore focus) + Kowloon opposite
// =====================================================================================================================
const coast = load('osm_coastline.json');
const coastChains = chainCoastline(coast);
coastChains.sort((a, b) => b.length - a.length);
log(`coastline chains: ${coastChains.length}; longest ${coastChains.slice(0, 5).map((c) => c.length).join(', ')}`);

// Classify chains by centroid: south of harbour (z > ~ -400 near origin for HK Island north shore) vs Kowloon (z < 0 more north = more negative z)
function chainCentroid(c) {
  if (!c.length) return [0, 0];
  return [c.reduce((t, p) => t + p[0], 0) / c.length, c.reduce((t, p) => t + p[1], 0) / c.length];
}

// Build a closed rectangle-ish land polygon for the detailed Central strip when coastline is open chains.
// Prefer the longest chain that crosses Central (near origin).
function pickCentralShore(chains) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of chains) {
    if (c.length < 20) continue;
    const [cx, cz] = chainCentroid(c);
    // Prefer chains near origin, spanning some east-west
    const bb = bbox(c);
    const spanX = bb.x1 - bb.x0;
    const near = Math.hypot(cx, cz);
    const score = spanX - near * 0.3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best || chains[0] || [];
}

const mainShore = pickCentralShore(coastChains);
log(`main shore pts=${mainShore.length} centroid=${chainCentroid(mainShore).map(r1)}`);

// Build a closed "island" polygon for the Central waterfront: take shore points within a window and close inland.
function closeShoreAsIsland(shore, inlandSouth = 900) {
  // Keep points roughly in Central detail window
  const windowed = shore.filter(([x, z]) => x > -1800 && x < 2200 && z > -800 && z < 1200);
  const pts = (windowed.length > 30 ? windowed : shore).map((p) => p.slice());
  if (pts.length < 4) {
    // Fallback rectangle covering Central CBD
    return [
      [-1200, -200], [1600, -200], [1600, 800], [-1200, 800]
    ];
  }
  // Sort roughly west→east along the harbour edge (prefer northernmost points as waterfront)
  // Use convex-ish: take northern envelope then close south
  const byX = pts.slice().sort((a, b) => a[0] - b[0]);
  const step = Math.max(1, Math.floor(byX.length / 120));
  const north = [];
  for (let i = 0; i < byX.length; i += step) {
    // among nearby x, pick min z (north)
    const x0 = byX[i][0];
    let best = byX[i];
    for (let j = i; j < Math.min(byX.length, i + step * 2); j++) {
      if (Math.abs(byX[j][0] - x0) < 40 && byX[j][1] < best[1]) best = byX[j];
    }
    north.push(best);
  }
  if (north.length < 3) return rdp(pts, 4);
  const west = north[0];
  const east = north[north.length - 1];
  const southZ = Math.max(...north.map((p) => p[1])) + inlandSouth;
  const ring = [...north, [east[0], southZ], [west[0], southZ]];
  const simp = rdpRing(ring, 3);
  if (ringArea(simp) > 0) simp.reverse(); // CCW land-positive convention used elsewhere expects negative area sometimes; keep consistent with NYC (negative = CW)
  return simp;
}

const hkIsland = closeShoreAsIsland(mainShore, 1000);
log(`HK Island detail ring: ${hkIsland.length} pts area=${(Math.abs(ringArea(hkIsland)) / 1e6).toFixed(3)} km²`);

// Kowloon opposite shore: chains with centroid north of harbour (z < -200)
const kowloonChains = coastChains.filter((c) => {
  const [, cz] = chainCentroid(c);
  return cz < -150 && c.length > 30;
});
function closeKowloon(chains) {
  const pts = chains.flat();
  if (pts.length < 10) {
    return [[-1500, -2500], [2000, -2500], [2000, -400], [-1500, -400]];
  }
  const windowed = pts.filter(([x, z]) => x > -2000 && x < 2500 && z > -3500 && z < -100);
  const byX = (windowed.length > 20 ? windowed : pts).slice().sort((a, b) => a[0] - b[0]);
  const step = Math.max(1, Math.floor(byX.length / 100));
  const south = []; // harbour-facing = max z (south edge of Kowloon)
  for (let i = 0; i < byX.length; i += step) {
    const x0 = byX[i][0];
    let best = byX[i];
    for (let j = i; j < Math.min(byX.length, i + step * 2); j++) {
      if (Math.abs(byX[j][0] - x0) < 50 && byX[j][1] > best[1]) best = byX[j];
    }
    south.push(best);
  }
  const west = south[0];
  const east = south[south.length - 1];
  const northZ = Math.min(...south.map((p) => p[1])) - 1200;
  const ring = [...south, [east[0], northZ], [west[0], northZ]];
  const simp = rdpRing(ring, 4);
  if (ringArea(simp) > 0) simp.reverse();
  return simp;
}
const kowloon = closeKowloon(kowloonChains);
log(`Kowloon ring: ${kowloon.length} pts`);

// =====================================================================================================================
// ROADS
// =====================================================================================================================
const osmRoads = load('osm_roads.json');
const HW_WIDTH = {
  motorway: 22, trunk: 18, primary: 14, secondary: 11, tertiary: 9,
  residential: 7, unclassified: 7, living_street: 5, service: 4
};
const roadLines = [];
for (const e of osmRoads.elements) {
  if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) continue;
  const t = e.tags || {};
  const name = (t.name || t.ref || '').toUpperCase();
  if (!name && t.highway === 'service') continue;
  const pts = rdp(e.geometry.map((g) => toWorld(g.lon, g.lat)), 1.2);
  if (pts.length < 2) continue;
  const w = HW_WIDTH[t.highway] || 7;
  const lanes = parseInt(t.lanes || '0', 10) || (w >= 14 ? 4 : w >= 10 ? 2 : 1);
  const hw = t.highway === 'motorway' || t.highway === 'trunk' ? 1 : 0;
  const dir = t.oneway === 'yes' ? 'FT' : t.oneway === '-1' ? 'TF' : 'TW';
  roadLines.push({ name: name || t.highway.toUpperCase(), w, dir, lanes, hw, pts });
}
log(`${roadLines.length} road polylines`);

// Synthesize numbered "streets" (E–W) and "avenues" (N–S) from major named roads for city-config compatibility
function roadOrientation(pts) {
  let dx = 0, dz = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    dx += Math.abs(pts[i + 1][0] - pts[i][0]);
    dz += Math.abs(pts[i + 1][1] - pts[i][1]);
  }
  return { dx, dz, ew: dx >= dz };
}

const MAJOR_EW = /DES VOEUX|QUEEN'S ROAD|QUEENS ROAD|CONNAUGHT|HENNESSY|GLOUCESTER|LOCKHART|JOHNSTON|KENNEDY|BONHAM|CAINE|HOLLYWOOD|STANLEY|ICE HOUSE|CHATER|MURRAY/;
const MAJOR_NS = /PEDDER|ICE HOUSE|D'AGUILAR|DAGUILAR|WYNDHAM|GARDEN ROAD|COTTON TREE|MURRAY|RUMSEY|JUBILEE|FERRY|NATHAN|CANTON|SALISBURY|HARBOUR|FINANCE/;

const ewCandidates = [];
const nsCandidates = [];
for (const r of roadLines) {
  if (r.pts.length < 2 || r.w < 6) continue;
  const o = roadOrientation(r.pts);
  const bb = bbox(r.pts);
  if (o.ew && (MAJOR_EW.test(r.name) || (r.w >= 9 && bb.x1 - bb.x0 > 200))) {
    const z = (bb.z0 + bb.z1) / 2;
    ewCandidates.push({ name: r.name, z, x0: bb.x0, x1: bb.x1, w: r.w, dir: r.dir === 'FT' ? 1 : r.dir === 'TF' ? -1 : 0 });
  }
  if (!o.ew && (MAJOR_NS.test(r.name) || (r.w >= 9 && bb.z1 - bb.z0 > 150))) {
    const x = (bb.x0 + bb.x1) / 2;
    nsCandidates.push({ name: r.name, x, z0: bb.z0, z1: bb.z1, w: r.w, dir: r.dir === 'FT' ? 1 : r.dir === 'TF' ? -1 : 0, lanes: r.lanes });
  }
}

// Cluster E–W into street numbers by z (south-positive), origin ≈ street 42 analogue at z≈0
ewCandidates.sort((a, b) => a.z - b.z);
const streetsOut = [];
const usedZ = [];
let streetN = 1;
for (const c of ewCandidates) {
  if (usedZ.some((z) => Math.abs(z - c.z) < 35)) continue;
  usedZ.push(c.z);
  streetsOut.push({
    n: streetN++,
    z: q(c.z),
    segs: [[q(c.x0), q(c.x1), c.dir, q(c.w)]]
  });
  if (streetsOut.length >= 80) break;
}
// Ensure we have a "42nd St" analogue near origin for teleports that used streetZ(42)
if (!streetsOut.some((s) => Math.abs(s.z) < 40)) {
  streetsOut.push({ n: 42, z: 0, segs: [[-800, 1200, 0, 12]] });
} else {
  // renumber so closest to z=0 is 42
  streetsOut.sort((a, b) => a.z - b.z);
  const mid = streetsOut.reduce((bi, s, i) => (Math.abs(s.z) < Math.abs(streetsOut[bi].z) ? i : bi), 0);
  streetsOut.forEach((s, i) => { s.n = 42 + (i - mid); });
}
streetsOut.sort((a, b) => a.n - b.n);
log(`${streetsOut.length} synthesized streets`);

nsCandidates.sort((a, b) => a.x - b.x);
function pickAveId(name, x) {
  if (/PEDDER/i.test(name)) return '5';
  if (/ICE HOUSE|雪廠/i.test(name)) return '7';
  if (/WYNDHAM|雲咸/i.test(name)) return '6';
  if (/GARDEN ROAD|花園道/i.test(name)) return 'park';
  if (/MURRAY|美利/i.test(name)) return 'lex';
  if (/COTTON TREE|紅棉/i.test(name)) return '3';
  if (/NATHAN/i.test(name)) return '8';
  if (/HARBOUR|干諾/i.test(name)) return '9';
  if (Math.abs(x) < 30) return '5';
  return null;
}
const avenuesOut = [];
const usedIds = new Set();
const usedX = [];
for (const c of nsCandidates) {
  if (usedX.some((x) => Math.abs(x - c.x) < 40)) continue;
  let id = pickAveId(c.name, c.x);
  if (id && usedIds.has(id)) id = null;
  if (!id) continue; // only keep named major N–S for avenue registry
  usedX.push(c.x);
  usedIds.add(id);
  avenuesOut.push({
    id,
    label: c.name.replace(/\s+/g, ' '),
    x: q(c.x),
    segs: [{ z0: q(c.z0), z1: q(c.z1), dir: c.dir, w: q(c.w), lanes: c.lanes || 2, names: [[q(c.z0), q(c.z1), c.name]] }]
  });
}
// Fill required midtown core ids used by city-config AVENUES list
const required = [
  ['8', 'HARBOUR VIEW STREET', -200],
  ['7', 'ICE HOUSE STREET', 110],
  ['6', 'WYNDHAM STREET', -130],
  ['5', 'PEDDER STREET', 20],
  ['park', 'GARDEN ROAD', 350],
  ['lex', 'MURRAY ROAD', 250],
  ['3', 'COTTON TREE DRIVE', 450]
];
for (const [id, label, x] of required) {
  if (avenuesOut.some((a) => a.id === id)) continue;
  avenuesOut.push({
    id, label, x,
    segs: [{ z0: -400, z1: 700, dir: 0, w: 12, lanes: 2, names: [[-400, 700, label]] }]
  });
}
avenuesOut.sort((a, b) => a.x - b.x);
log(`${avenuesOut.length} synthesized avenues: ${avenuesOut.map((a) => a.id + '@' + a.x).join(', ')}`);

// Broadway analogue: Des Voeux Road Central
let broadway = [];
{
  const dv = roadLines.filter((r) => /DES VOEUX/.test(r.name)).sort((a, b) => b.pts.length - a.pts.length)[0];
  if (dv) broadway = rdp(dv.pts.slice().sort((a, b) => a[1] - b[1]), 2);
  else broadway = [[0, -300], [0, 500]];
}

// Road graph (minimal)
const rgNodes = [];
const rgLinks = [];
const rgNames = [];
const nameIdx = new Map();
function ensureName(n) {
  if (!nameIdx.has(n)) { nameIdx.set(n, rgNames.length); rgNames.push(n); }
  return nameIdx.get(n);
}
for (const r of roadLines) {
  if (r.pts.length < 2 || r.w < 6) continue;
  const ni = [];
  for (const [x, z] of r.pts) {
    ni.push(rgNodes.length / 2);
    rgNodes.push(q(x), q(z));
  }
  const nm = ensureName(r.name);
  for (let i = 0; i + 1 < ni.length; i++) {
    rgLinks.push([ni[i], ni[i + 1], nm, q(r.w), r.lanes, r.dir === 'TW' ? 0 : 1, []]);
  }
}
const roadGraph = { nodes: rgNodes, links: rgLinks, names: rgNames };

// =====================================================================================================================
// PARKS / LANDMARKS / PIERS
// =====================================================================================================================
const osmParks = load('osm_parks.json');
const parkShapes = [];
for (const e of osmParks.elements) {
  const t = e.tags || {};
  const n = t.name;
  if (!n) continue;
  for (const r of elemRings(e)) {
    if (r.length < 4) continue;
    const s = rdpRing(r[0] === r[r.length - 1] ? r.slice(0, -1) : r, 1.5);
    if (s.length < 3 || Math.abs(ringArea(s)) < 200) continue;
    if (ringArea(s) > 0) s.reverse();
    parkShapes.push({ name: n, cat: t.leisure || 'park', acres: Math.round(Math.abs(ringArea(s)) / 4046.86 * 10) / 10, rings: [s] });
  }
}
log(`${parkShapes.length} parks`);

// Hong Kong Park / Statue Square as centralPark stand-in
function findPark(re) {
  return parkShapes.find((p) => re.test(p.name));
}
const hkPark = findPark(/Hong Kong Park/i) || findPark(/Statue Square/i) || findPark(/Chater Garden/i) || parkShapes[0];
let cp;
if (hkPark) {
  const ring = hkPark.rings[0];
  const b = bbox(ring);
  cp = {
    bounds: { minX: q(b.x0), maxX: q(b.x1), minZ: q(b.z0), maxZ: q(b.z1) },
    outline: flat(ring),
    water: [], lawns: [], drives: [], paths: [], sites: []
  };
} else {
  cp = { bounds: { minX: -200, maxX: 200, minZ: 50, maxZ: 350 }, outline: flat([[-200, 50], [200, 50], [200, 350], [-200, 350]]), water: [], lawns: [], drives: [], paths: [], sites: [] };
}

const osmLM = load('osm_landmarks.json');
const landmarks = {};
const NOTABLE = /International Finance|Bank of China|HSBC|Exchange Square|Jardine House|Lippo|Cheung Kong|The Center|The Centre|Prince.s Building|Alexandra House|Mandarin Oriental|Four Seasons|City Hall|Legislative|Observation Wheel|Landmark|Clock Tower|Peninsula|Cultural Centre|International Commerce|IFC|Standard Chartered|Murray Building|Former Central|High Court|Pacific Place|Convention/i;
for (const e of osmLM.elements) {
  const t = e.tags || {};
  if (t.man_made === 'pier') continue;
  const name = t['name:en'] || t.name;
  if (!name) continue;
  // Keep notable names always; otherwise keep larger footprints only
  const r = elemRing(e);
  if (r.length < 3) {
    // nodes (attractions): invent a small footprint
    if (e.type === 'node' && e.lon != null) {
      const [x, z] = toWorld(e.lon, e.lat);
      if (!NOTABLE.test(name) && !landmarks[name]) continue;
      if (!landmarks[name]) landmarks[name] = { x: q(x), z: q(z), w: 20, d: 20, h: null, area: 400, ring: flat([[x-10,z-10],[x+10,z-10],[x+10,z+10],[x-10,z+10]]) };
    }
    continue;
  }
  const b = bbox(r);
  const area = Math.abs(ringArea(r));
  if (!NOTABLE.test(name) && area < 800) continue;
  const prev = landmarks[name];
  if (prev && prev.area >= area) continue;
  const height = t.height ? parseFloat(String(t.height).replace(/m$/i, '')) : (t['building:levels'] ? parseFloat(t['building:levels']) * 3.2 : null);
  landmarks[name] = {
    x: q((b.x0 + b.x1) / 2), z: q((b.z0 + b.z1) / 2),
    w: q(b.x1 - b.x0), d: q(b.z1 - b.z0),
    h: Number.isFinite(height) ? height : null,
    area: Math.round(area),
    ring: flat(rdpRing(r[0] === r[r.length - 1] ? r.slice(0, -1) : r, 0.5))
  };
}
log(`${Object.keys(landmarks).length} landmarks: ${Object.keys(landmarks).slice(0, 12).join(', ')}`);

const osmPiers = load('osm_piers.json');
const piers = [];
for (const e of osmPiers.elements) {
  const t = e.tags || {};
  const r = elemRing(e);
  if (r.length < 3) continue;
  const b = bbox(r);
  const ring = rdpRing(r[0] === r[r.length - 1] ? r.slice(0, -1) : r, 0.8);
  piers.push({
    name: t.name || 'Pier',
    cx: q((b.x0 + b.x1) / 2), cz: q((b.z0 + b.z1) / 2),
    len: q(Math.max(b.x1 - b.x0, b.z1 - b.z0)),
    wid: q(Math.min(b.x1 - b.x0, b.z1 - b.z0) || 8),
    ang: 0,
    ring: flat(ring)
  });
}
log(`${piers.length} piers`);

// =====================================================================================================================
// POINTS / BRIDGES / ISLANDS / BOROUGHS (schema-compatible stubs mapped to HK geography)
// =====================================================================================================================
// Named lat/lon (WGS84) for HK points of note
const POINTS_LL = {
  // Reuse NYC point keys so city-config.js keeps loading; values are HK analogues
  gwbManhattanTower: [22.2935, 114.1680], // stub near TST → Central harbour (not a bridge)
  gwbNJTower: [22.2860, 114.1680],
  verrazzanoBrooklynTower: [22.2950, 114.1750],
  verrazzanoStatenTower: [22.2870, 114.1750],
  statueOfLiberty: [22.2936, 114.1694], // Tsim Sha Tsui Clock Tower stand-in
  whitehallTerminal: [22.2872, 114.1610], // Central Star Ferry pier
  pier17: [22.2865, 114.1645],
  castleClinton: [22.2820, 114.1615], // City Hall / Edinburgh Place
  peterMinuitPlaza: [22.2810, 114.1595], // Statue Square
  bowlingGreen: [22.2805, 114.1585]
};
const points = Object.fromEntries(Object.entries(POINTS_LL).map(([k, [lat, lon]]) => [k, toWorld(lon, lat).map(q)]));

// Stub bridges across Victoria Harbour (Central ↔ TST) for schema; rendering may look odd but won't crash
function harbourBridge(aLL, bLL) {
  const a = toWorld(aLL[1], aLL[0]).map(q);
  const b = toWorld(bLL[1], bLL[0]).map(q);
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  return { a, mid: [q((a[0] + b[0]) / 2), q((a[1] + b[1]) / 2)], dir: [dx / L, dz / L] };
}
const bridges = {
  queensboro: harbourBridge([22.2830, 114.1650], [22.2940, 114.1720]),
  williamsburg: harbourBridge([22.2840, 114.1600], [22.2950, 114.1680]),
  manhattan: harbourBridge([22.2850, 114.1580], [22.2955, 114.1660]),
  brooklyn: harbourBridge([22.2860, 114.1560], [22.2960, 114.1640])
};

const islands = {
  // Small harbour features / stubs (flat rings)
  roosevelt: flat(rdpRing([[1400, -900], [1600, -900], [1600, -700], [1400, -700]], 1)),
  randalls: flat(rdpRing([[1800, -2000], [2000, -2000], [2000, -1800], [1800, -1800]], 1)),
  governors: flat(rdpRing([[800, 900], [1000, 900], [1000, 1100], [800, 1100]], 1)),
  liberty: flat(rdpRing([[points.statueOfLiberty[0] - 40, points.statueOfLiberty[1] - 40], [points.statueOfLiberty[0] + 40, points.statueOfLiberty[1] - 40], [points.statueOfLiberty[0] + 40, points.statueOfLiberty[1] + 40], [points.statueOfLiberty[0] - 40, points.statueOfLiberty[1] + 40]], 1)),
  millRock: flat(rdpRing([[200, -1200], [280, -1200], [280, -1120], [200, -1120]], 1)),
  ellis: flat(rdpRing([[-200, -1400], [-100, -1400], [-100, -1300], [-200, -1300]], 1))
};

// upperManhattan: Mid-Levels / inland south of Central CBD (positive z further inland)
const upperManhattan = (() => {
  const b = bbox(hkIsland);
  return flat([
    [b.x0, b.z1 - 50], [b.x1, b.z1 - 50], [b.x1, b.z1 + 1500], [b.x0, b.z1 + 1500]
  ]);
})();

const innerShore = flat(rdpRing(hkIsland, 2));

const boroughs = {
  // Schema names kept; mapped to HK landmasses for fog/horizon meshes
  brooklyn: [flat(kowloon)],
  queens: [flat(rdpRing([
    [kowloon.reduce((m, p) => Math.max(m, p[0]), -Infinity) - 100, -2800],
    [3500, -2800], [3500, -200], [kowloon.reduce((m, p) => Math.max(m, p[0]), -Infinity) - 100, -200]
  ], 5))],
  bronx: [flat(rdpRing([
    [-2000, -4000], [2500, -4000], [2500, -2200], [-2000, -2200]
  ], 5))],
  statenIsland: [flat(rdpRing([[-3500, 2000], [-2000, 2000], [-2000, 3500], [-3500, 3500]], 5))],
  newJersey: [flat(kowloon)] // Kowloon across the harbour
};

const CUT_Z = q(Math.min(...hkIsland.map((p) => p[1])) - 100);
const STRIP = 20;
const SIDEWALK = 4.0;

// Minimal blocks: empty — city-grid will rely more on roads; empty is safer than bad footprints
const blocks = [];

const GEO = {
  version: 1,
  frame: {
    bearingDeg: 0,
    origin: 'Pedder St × Des Voeux Rd Central (Hong Kong)',
    units: 'm',
    cutZ: CUT_Z,
    strip: STRIP,
    sidewalk: SIDEWALK,
    city: 'hongkong',
    region: 'Central / Victoria Harbour'
  },
  manhattan: flat(hkIsland), // HK Island Central detail outline (schema key retained)
  upperManhattan,
  innerShore,
  islands,
  boroughs,
  streets: streetsOut,
  avenues: avenuesOut,
  broadway: flat(broadway),
  plazas: [],
  roads: roadLines.map((r) => [r.name, r.w ? q(r.w) : 0, r.dir || '', r.lanes || 0, r.hw ? 1 : 0, flat(r.pts)]),
  roadGraph,
  blocks,
  parks: parkShapes.map((p) => ({ name: p.name, cat: p.cat, acres: p.acres, rings: p.rings.map(flat) })),
  centralPark: cp, // Hong Kong Park / Statue Square stand-in
  piers,
  bridges,
  landmarks,
  points
};

const json = JSON.stringify(GEO);
const header = `// js/nyc-geodata.js — GENERATED by tools/build-hk-geodata.mjs (Hong Kong Central v1), do not edit by hand.
// World frame: 1 unit = 1 m, x = east, z = south (north = -z), origin at Pedder St × Des Voeux Rd Central, bearing ${GEO.frame.bearingDeg}°.
// Schema keys retain NYC names (manhattan, centralPark, …) for runtime compatibility; values are Hong Kong.
// Geographic data © OpenStreetMap contributors (https://www.openstreetmap.org/copyright) — ODbL.
// Deploy target (recommended): https://gghere.com/slop/hongkong
// NOTE: bare https://gghere.com/hongkong currently 308-redirects to jubuddy planet — do not reuse that path.
`;
fs.writeFileSync(OUT, `${header}export const GEO = ${json};\n`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
for (const [k, v] of Object.entries(GEO)) log(`  ${k}: ${(JSON.stringify(v).length / 1024).toFixed(0)} KB`);
