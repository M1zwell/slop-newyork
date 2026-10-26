/**
 * building-geom — the footprint geometry shared by the building bake and the identity
 * bake, so the two agree on WHERE a building is.
 *
 * WHY this is shared and not copied: `bake-hk-buildings.mjs` writes the cloud and
 * `bake-hk-poi.mjs` writes the name sidecar, and the two are joined at runtime BY
 * POSITION. When they used different centroid conventions (min-rotated-rect centre vs
 * bbox centre) they disagreed by several metres on L-shaped and podium plans, and the
 * nearest-within-radius join then handed 18.2% of Central's buildings their NEIGHBOUR's
 * name (measured over central-belt-z). One centroid function is the fix; a second copy
 * would let the two drift apart again.
 *
 * Pure functions, no I/O.
 */

export function ringBounds(geom) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  const visit = (p) => { if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]; if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]; };
  const walk = (a) => { if (typeof a[0] === 'number') visit(a); else for (const x of a) walk(x); };
  walk(geom.coordinates);
  return Number.isFinite(mnx) ? { mnx, mny, mxx, mxy } : null;
}

// ── minimum-rotated-rectangle (Arnis-backlog port): the axis-aligned bbox made
// every tower an axis-aligned box that FIGHTS diagonal streets. Convex hull
// (monotone chain) + rotating calipers over hull edges → the tightest oriented
// rect; we emit its bearing as `r` (radians, width-axis East→North — the exact
// convention buildingCloud already renders for Open3Dhk `r`). Metric coords so
// the angle is true (lon scaled by cos(lat)).
export function collectPoints(geom, out) {
  const walk = (a) => { if (typeof a[0] === 'number') out.push(a); else for (const x of a) walk(x); };
  if (geom && geom.coordinates) walk(geom.coordinates);
  return out;
}
export function convexHull(pts) {
  const P = [...new Map(pts.map((p) => [p[0] + ',' + p[1], p])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const pt of P) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const pt = P[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** { cxM, cyM, w, d, r } in metric coords (metres, x east / y north), or null. */
export function minRotatedRect(geom, mlonC, mlat) {
  const raw = collectPoints(geom, []);
  if (raw.length < 3) return null;
  const pts = raw.map((p) => [p[0] * mlonC, p[1] * mlat]); // degrees → metres
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      if (u < mnu) mnu = u; if (u > mxu) mxu = u;
      if (v < mnv) mnv = v; if (v > mxv) mxv = v;
    }
    const area = (mxu - mnu) * (mxv - mnv);
    if (!best || area < best.area) {
      const cu = (mnu + mxu) / 2, cv = (mnv + mxv) / 2;
      best = {
        area,
        w: mxu - mnu,
        d: mxv - mnv,
        r: ang,
        cxM: cu * ca - cv * sa,
        cyM: cu * sa + cv * ca,
      };
    }
  }
  if (!best) return null;
  // Normalize: keep r in (-π/2, π/2] with w = the axis it measures (swap if needed)
  let { w, d, r } = best;
  r = ((r % Math.PI) + Math.PI) % Math.PI; // [0, π)
  if (r > Math.PI / 2) r -= Math.PI; // (-π/2, π/2]
  return { cxM: best.cxM, cyM: best.cyM, w, d, r };
}
