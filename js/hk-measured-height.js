/**
 * Measured building heights for Slop HK (Mode A).
 * Prefers CSDI LandsD Top−Base stamped onto GEO curb lots (hk-lot-heights-data.js).
 * Falls back to district quantile tables (hk-height-tables.js).
 * Landmarks / GEO.h must stay authoritative — callers must not override kits.
 */
import { HK_LOT_HEIGHT_FLAT, HK_LOT_HEIGHT_META } from './hk-lot-heights-data.js';
import { HK_HEIGHT_TABLES } from './hk-height-tables.js';

const MATCH_M = (HK_LOT_HEIGHT_META && HK_LOT_HEIGHT_META.matchM) || 25;
const CELL = MATCH_M;

/** @type {Map<string, number[]>} */
const grid = new Map();
/** @type {{x:number,z:number,h:number}[]} */
const pts = [];

(function indexFlat() {
  const flat = HK_LOT_HEIGHT_FLAT || [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const x = flat[i];
    const z = flat[i + 1];
    const h = flat[i + 2];
    if (!(Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(h) && h > 0)) continue;
    const idx = pts.length;
    pts.push({ x, z, h });
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(idx);
  }
})();

/**
 * Nearest measured height within MATCH_M of world (x,z). Null if none.
 * @param {number} x
 * @param {number} z
 * @param {number} [maxDist=MATCH_M]
 * @returns {{h:number,d:number}|null}
 */
export function lookupMeasuredHeight(x, z, maxDist = MATCH_M) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const kx = Math.floor(x / CELL);
  const kz = Math.floor(z / CELL);
  let best = null;
  let bestD = maxDist;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const idxs = grid.get(`${kx + dx},${kz + dz}`);
      if (!idxs) continue;
      for (const i of idxs) {
        const p = pts[i];
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= bestD) {
          bestD = d;
          best = { h: p.h, d };
        }
      }
    }
  }
  return best;
}

/**
 * Convert measured metres AGL → whole storeys (never NaN).
 * @param {number} h
 * @param {number} [floorM=3.5]
 */
export function floorsFromHeight(h, floorM = 3.5) {
  const fh = Number.isFinite(floorM) && floorM > 0 ? floorM : 3.5;
  if (!(Number.isFinite(h) && h > 0)) return 1;
  return Math.max(1, Math.round(h / fh));
}

/**
 * Resolve floor count for a lot rect: measured h preferred, else fallback [lo,hi] sample.
 * @param {{x0:number,x1:number,z0:number,z1:number}} lot
 * @param {[number,number]} fallbackRange
 * @param {(a:number,b:number)=>number} irange
 * @param {number} [floorM=3.5]
 */
export function resolveLotFloors(lot, fallbackRange, irange, floorM = 3.5) {
  const lo = fallbackRange?.[0];
  const hi = fallbackRange?.[1];
  const fallback = () => {
    const a = Number.isFinite(lo) ? lo : 4;
    const b = Number.isFinite(hi) ? hi : Math.max(a, 12);
    const v = typeof irange === 'function' ? irange(a, b) : Math.round((a + b) / 2);
    return Number.isFinite(v) && v > 0 ? v : 4;
  };
  if (!lot) return fallback();
  const cx = (lot.x0 + lot.x1) * 0.5;
  const cz = (lot.z0 + lot.z1) * 0.5;
  const hit = lookupMeasuredHeight(cx, cz);
  if (!hit || !(hit.h > 0)) return fallback();
  return floorsFromHeight(hit.h, floorM);
}

export { HK_HEIGHT_TABLES, HK_LOT_HEIGHT_META, MATCH_M };
