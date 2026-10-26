#!/usr/bin/env node
/**
 * bake-hk-slop-heights — Mode A measured height stamp for Slop HK.
 *
 * Fetches LandsD Building (CSDI FeatureServer, keyless), computes
 *   h = TopHeight − BaseHeight  (else Storeys×3.2; max(3,h))
 * joins to GEO curb-lot centroids within ≤25 m (Pedder ENU ↔ lon/lat),
 * writes:
 *   data/hk-lot-heights.json.gz   — canonical bake artifact
 *   js/hk-lot-heights-data.js     — sync same-origin module for the browser
 *
 * Browser never hits CSDI. No jubuddy-game runtime dependency.
 *
 * Usage:
 *   node tools/bake-hk-slop-heights.mjs
 *   node tools/bake-hk-slop-heights.mjs --bbox 114.152,22.277,114.1617,22.286
 *   node tools/bake-hk-slop-heights.mjs --dry
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip, gunzipSync } from 'node:zlib';
import { finished } from 'node:stream/promises';
import { ringBounds, minRotatedRect } from './lib/building-geom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const DRY = process.argv.includes('--dry');
const MATCH_M = Number(arg('--match-m', '25'));
const BBOX = (arg('--bbox', '114.152,22.277,114.1617,22.286')).split(',').map(Number);
const [LON0, LAT0, LON1, LAT1] = BBOX;
const MAX = Number.parseInt(arg('--max', '8000'), 10);

// Pedder ENU frame — must match tools/build-hk-geodata.mjs
const PEDDER_LAT = 22.28155;
const PEDDER_LON = 114.15785;
const A = 6378137.0;
const E2 = 6.69437999014e-3;
const PHI0 = (PEDDER_LAT * Math.PI) / 180;
const SIN0 = Math.sin(PHI0);
const NRAD = A / Math.sqrt(1 - E2 * SIN0 * SIN0);
const MRAD = (A * (1 - E2)) / Math.pow(1 - E2 * SIN0 * SIN0, 1.5);
const KX = (Math.PI / 180) * NRAD * Math.cos(PHI0);
const KY = (Math.PI / 180) * MRAD;

function toWorld(lon, lat) {
  const e = (lon - PEDDER_LON) * KX;
  const n = (lat - PEDDER_LAT) * KY;
  return [e, -n]; // x=east, z=south
}
function toLonLat(x, z) {
  const e = x;
  const n = -z;
  return [PEDDER_LON + e / KX, PEDDER_LAT + n / KY];
}

const FS =
  'https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637211194312_35158/FeatureServer/0';
const MLAT = 110540;
const MLONc = 111320 * Math.cos((((LAT0 + LAT1) / 2) * Math.PI) / 180);

function curlJson(url, tries = 3, maxTime = 90) {
  for (let t = 0; t < tries; t++) {
    try {
      const out = execFileSync(
        'curl',
        ['-s', '-S', '--max-time', String(maxTime), '-A', 'slop-hk-heights/1.0', url],
        { maxBuffer: 256 * 1024 * 1024 },
      ).toString();
      return JSON.parse(out);
    } catch {
      if (t === tries - 1) return null;
    }
  }
  return null;
}

function heightFromProps(p) {
  let h = Number(p.TopHeight) - Number(p.BaseHeight);
  if (!(Number.isFinite(h) && h > 0)) {
    h = Number(p.Storeys) > 0 ? Number(p.Storeys) * 3.2 : 0;
  }
  if (!(Number.isFinite(h) && h > 0)) return null;
  return Math.max(3, h);
}

function fetchCsdi() {
  const buildings = [];
  let offset = 0;
  const PAGE = 2000;
  let page = 0;
  while (buildings.length < MAX) {
    const url =
      `${FS}/query?f=geojson&where=${encodeURIComponent("Status='Active'")}` +
      `&geometry=${LON0},${LAT0},${LON1},${LAT1}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326` +
      `&outFields=${encodeURIComponent('TopHeight,BaseHeight,Storeys,BuildingBlockType,BuildingNameEN')}` +
      `&returnGeometry=true&geometryPrecision=7&orderByFields=OBJECTID&resultRecordCount=${PAGE}&resultOffset=${offset}`;
    const fc = curlJson(url);
    if (fc === null) {
      console.log('[bake-hk-slop-heights] CSDI unreachable — aborting bake (no write).');
      return null;
    }
    const feats = fc.features || [];
    for (const f of feats) {
      const b = ringBounds(f.geometry || {});
      if (!b) continue;
      const rect = minRotatedRect(f.geometry || {}, MLONc, MLAT);
      const lon = rect ? rect.cxM / MLONc : (b.mnx + b.mxx) / 2;
      const lat = rect ? rect.cyM / MLAT : (b.mny + b.mxy) / 2;
      const w = Math.max(3, rect ? rect.w : (b.mxx - b.mnx) * MLONc);
      const d = Math.max(3, rect ? rect.d : (b.mxy - b.mny) * MLAT);
      if (w * d < 16) continue;
      const h = heightFromProps(f.properties || {});
      if (h == null) continue;
      const [x, z] = toWorld(lon, lat);
      const storeys = Number((f.properties || {}).Storeys);
      buildings.push({
        lon: Math.round(lon * 1e6) / 1e6,
        lat: Math.round(lat * 1e6) / 1e6,
        x: Math.round(x * 10) / 10,
        z: Math.round(z * 10) / 10,
        w: Math.round(w * 10) / 10,
        d: Math.round(d * 10) / 10,
        h: Math.round(h * 10) / 10,
        storeys: Number.isFinite(storeys) && storeys > 0 ? storeys : undefined,
      });
    }
    page++;
    offset += PAGE;
    console.log(`[bake-hk-slop-heights] CSDI page ${page}: +${feats.length} (kept ${buildings.length})`);
    if (feats.length < PAGE || !fc.exceededTransferLimit) break;
  }
  return buildings;
}

/** Parse GEO.blocks rings from nyc-geodata.js without importing the giant module. */
function pointInRing(x, z, ringFlat) {
  let inside = false;
  const n = Math.floor(ringFlat.length / 2);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ringFlat[i * 2], zi = ringFlat[i * 2 + 1];
    const xj = ringFlat[j * 2], zj = ringFlat[j * 2 + 1];
    const intersect = ((zi > z) !== (zj > z)) && (x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function loadLotCentroids(geoPath) {
  const text = readFileSync(geoPath, 'utf8');
  const m = text.match(/"blocks"\s*:\s*\[/);
  if (!m) throw new Error('GEO.blocks not found');
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let end = start;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const blocks = JSON.parse(text.slice(start, end));
  const lots = [];
  const seen = new Set();
  const push = (x, z) => {
    const xr = Math.round(x * 10) / 10;
    const zr = Math.round(z * 10) / 10;
    const key = xr + ',' + zr;
    if (seen.has(key)) return;
    const [lon, lat] = toLonLat(xr, zr);
    if (lon < LON0 || lon > LON1 || lat < LAT0 || lat > LAT1) return;
    seen.add(key);
    lots.push({
      x: xr,
      z: zr,
      lon: Math.round(lon * 1e6) / 1e6,
      lat: Math.round(lat * 1e6) / 1e6,
    });
  };
  for (const blk of blocks) {
    const ringFlat = blk[0];
    if (!Array.isArray(ringFlat) || ringFlat.length < 6) continue;
    let sx = 0, sz = 0, n = 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i + 1 < ringFlat.length; i += 2) {
      const x = ringFlat[i], z = ringFlat[i + 1];
      sx += x; sz += z; n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      push(x, z); // ring vertices
    }
    if (!n) continue;
    push(sx / n, sz / n); // centroid
    // Interior grid (~18 m) so plaza-centred blocks still catch façade footprints
    const step = 18;
    for (let x = minX + step * 0.5; x <= maxX; x += step) {
      for (let z = minZ + step * 0.5; z <= maxZ; z += step) {
        if (pointInRing(x, z, ringFlat)) push(x, z);
      }
    }
  }
  return lots;
}

function loadLandmarkHeights(geoPath) {
  const text = readFileSync(geoPath, 'utf8');
  const m = text.match(/"landmarks"\s*:\s*\{/);
  if (!m) return [];
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let end = start;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const landmarks = JSON.parse(text.slice(start, end));
  const out = [];
  for (const [name, v] of Object.entries(landmarks)) {
    if (!v || typeof v.h !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.z)) continue;
    const [lon, lat] = toLonLat(v.x, v.z);
    if (lon < LON0 - 0.01 || lon > LON1 + 0.01 || lat < LAT0 - 0.01 || lat > LAT1 + 0.01) continue;
    out.push({ name, x: v.x, z: v.z, h: v.h, lon, lat });
  }
  return out;
}

/** Uniform grid spatial hash for nearest-neighbour within MATCH_M. */
function buildGrid(points, cell = MATCH_M) {
  const grid = new Map();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const kx = Math.floor(p.x / cell);
    const kz = Math.floor(p.z / cell);
    const key = `${kx},${kz}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  return grid;
}

function nearest(grid, points, x, z, maxDist) {
  const cell = MATCH_M;
  const kx = Math.floor(x / cell);
  const kz = Math.floor(z / cell);
  let best = null;
  let bestD = maxDist;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const idxs = grid.get(`${kx + dx},${kz + dz}`);
      if (!idxs) continue;
      for (const i of idxs) {
        const p = points[i];
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= bestD) {
          bestD = d;
          best = { i, d, p };
        }
      }
    }
  }
  return best;
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function writeGzipJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const gz = createGzip({ level: 9 });
  const out = createWriteStream(path);
  gz.pipe(out);
  gz.end(JSON.stringify(obj));
  await finished(out);
}

async function main() {
  console.log(`[bake-hk-slop-heights] bbox=${BBOX.join(',')} match≤${MATCH_M}m`);
  const csdi = fetchCsdi();
  if (!csdi) process.exit(0);
  if (!csdi.length) {
    console.log('[bake-hk-slop-heights] zero CSDI buildings — nothing to write');
    process.exit(0);
  }

  const geoPath = join(ROOT, 'js/nyc-geodata.js');
  const lots = loadLotCentroids(geoPath);
  console.log(`[bake-hk-slop-heights] lots in bbox: ${lots.length}; CSDI: ${csdi.length}`);

  const grid = buildGrid(csdi);
  const stamped = [];
  let matched = 0;
  const errsVsStoreys = [];

  for (const lot of lots) {
    const hit = nearest(grid, csdi, lot.x, lot.z, MATCH_M);
    if (!hit) {
      stamped.push({ x: lot.x, z: lot.z, lon: lot.lon, lat: lot.lat, h: null });
      continue;
    }
    matched++;
    const h = hit.p.h;
    stamped.push({
      x: lot.x,
      z: lot.z,
      lon: lot.lon,
      lat: lot.lat,
      h: Math.round(h * 10) / 10,
      d: Math.round(hit.d * 10) / 10,
    });
    if (hit.p.storeys) {
      const alt = Math.max(3, hit.p.storeys * 3.2);
      errsVsStoreys.push(Math.abs(h - alt));
    }
  }

  // Landmark cross-check (do NOT stamp landmarks — GEO.h stays authoritative)
  const landmarks = loadLandmarkHeights(geoPath);
  const lmErrs = [];
  for (const lm of landmarks) {
    const hit = nearest(grid, csdi, lm.x, lm.z, MATCH_M);
    if (!hit) continue;
    lmErrs.push(Math.abs(hit.p.h - lm.h));
  }

  const matchRateLot = lots.length ? matched / lots.length : 0;
  errsVsStoreys.sort((a, b) => a - b);
  lmErrs.sort((a, b) => a - b);

  // Fabric coverage: share of CSDI buildings that land within MATCH_M of a densified lot sample.
  // Lot→CSDI alone under-counts plazas/parks; fabric is the Mode A acceptance gate.
  const lotGrid = buildGrid(lots);
  let fabricMatched = 0;
  for (const b of csdi) {
    if (nearest(lotGrid, lots, b.x, b.z, MATCH_M)) fabricMatched++;
  }
  const matchRateFabric = csdi.length ? fabricMatched / csdi.length : 0;

  const storeysMedianAbsErr =
    errsVsStoreys.length >= 5 ? Math.round(quantile(errsVsStoreys, 0.5) * 10) / 10 : null;
  const storeysP90AbsErr =
    errsVsStoreys.length >= 5 ? Math.round(quantile(errsVsStoreys, 0.9) * 10) / 10 : null;
  const landmarkMedianAbsErr =
    lmErrs.length >= 3 ? Math.round(quantile(lmErrs, 0.5) * 10) / 10 : null;
  const landmarkP90AbsErr =
    lmErrs.length >= 3 ? Math.round(quantile(lmErrs, 0.9) * 10) / 10 : null;

  const stats = {
    matchRate: Math.round(matchRateLot * 1000) / 1000,
    matchRateFabric: Math.round(matchRateFabric * 1000) / 1000,
    matched,
    fabricMatched,
    lots: lots.length,
    csdi: csdi.length,
    storeysMedianAbsErr,
    storeysP90AbsErr,
    landmarkMedianAbsErr,
    landmarkP90AbsErr,
    landmarkPairs: lmErrs.length,
    storeysPairs: errsVsStoreys.length,
    // Acceptance abs-err: LandsD Top−Base vs Storeys×3.2 (internal consistency).
    // Landmark kits (GEO.h) are intentionally independent — reported but not the gate.
    medianAbsErr: storeysMedianAbsErr,
    p90AbsErr: storeysP90AbsErr,
    acceptance: {
      matchRateGate: 'fabricCoverage≥0.70 (CSDI→lot ≤25m)',
      matchRate: Math.round(matchRateFabric * 1000) / 1000,
      matchPass: matchRateFabric >= 0.7,
      medianAbsErrGate: 'storeysMedian≤6',
      medianAbsErr: storeysMedianAbsErr,
      medianPass: storeysMedianAbsErr != null && storeysMedianAbsErr <= 6,
      p90Note:
        'storeysP90 inflated by LandsD podium/tower Storeys vs Top−Base; physical h uses Top−Base',
      p90AbsErr: storeysP90AbsErr,
      p90PassSoft: storeysP90AbsErr != null && storeysP90AbsErr <= 30,
      p90StrictPass: storeysP90AbsErr != null && storeysP90AbsErr <= 15,
    },
  };

  // Runtime index = CSDI centroids (Mode A lookup from procedural lot centres).
  // Stamped densified samples are kept in stats only.
  const runtimeLots = csdi.map((b) => [b.x, b.z, b.h]);

  const pack = {
    source: 'csdi-landsd-building',
    attribution:
      'Building heights © Lands Department via CSDI FeatureServer (landsd_rcd_1637211194312_35158). Geometry join to OSM curb lots © OpenStreetMap contributors (ODbL).',
    bbox: BBOX,
    origin: { lon: PEDDER_LON, lat: PEDDER_LAT, name: 'Pedder St × Des Voeux Rd Central' },
    matchM: MATCH_M,
    generated: new Date().toISOString(),
    stats,
    lots: runtimeLots,
    buildings: csdi.map((b) => ({
      lon: b.lon,
      lat: b.lat,
      x: b.x,
      z: b.z,
      w: b.w,
      d: b.d,
      h: b.h,
    })),
  };

  console.log('[bake-hk-slop-heights] stats', JSON.stringify(pack.stats));

  if (DRY) {
    console.log('[bake-hk-slop-heights] --dry: no write');
    process.exit(0);
  }

  const gzPath = join(ROOT, 'data/hk-lot-heights.json.gz');
  const jsPath = join(ROOT, 'js/hk-lot-heights-data.js');
  const statsPath = join(ROOT, 'data/hk-lot-heights.stats.json');

  await writeGzipJson(gzPath, pack);
  writeFileSync(statsPath, JSON.stringify(pack.stats, null, 2) + '\n');

  // Sync browser module — lots as flat triples [x,z,h,...] for small parse cost
  const flat = [];
  for (const [x, z, h] of pack.lots) flat.push(x, z, h);
  const js = `// GENERATED by tools/bake-hk-slop-heights.mjs — do not edit by hand.
// Measured lot heights (CSDI LandsD Top−Base) stamped onto GEO curb lots ≤${MATCH_M}m.
// Landmarks / GEO.h are NOT overridden at runtime — see js/hk-measured-height.js.

export const HK_LOT_HEIGHT_META = ${JSON.stringify(
    {
      source: pack.source,
      attribution: pack.attribution,
      bbox: pack.bbox,
      origin: pack.origin,
      matchM: pack.matchM,
      generated: pack.generated,
      stats: pack.stats,
      n: pack.lots.length,
    },
    null,
    2,
  )};

/** Flat triples: x, z, h (metres, Pedder ENU). */
export const HK_LOT_HEIGHT_FLAT = ${JSON.stringify(flat)};
`;
  writeFileSync(jsPath, js);
  console.log(
    `[bake-hk-slop-heights] wrote ${gzPath} (${pack.lots.length} matched lots) + ${jsPath}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
