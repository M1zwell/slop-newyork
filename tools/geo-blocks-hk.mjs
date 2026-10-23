// HK curb islands from OSM road centreline + land ring (adapted from geo-blocks.mjs; no NYC geo-base import).
// Returns blocks in the same object shape the NYC assembler maps into GEO.blocks schema rows.
// usage from build-hk-geodata.mjs: buildHkBlocks({ landRing, roadLines, strip, sidewalk, log })

const RES = 1;

class Raster {
  constructor(x0, z0, x1, z1, res) {
    this.res = res;
    this.x0 = Math.floor(x0 / res) * res;
    this.z0 = Math.floor(z0 / res) * res;
    this.w = Math.ceil((x1 - this.x0) / res) + 1;
    this.h = Math.ceil((z1 - this.z0) / res) + 1;
    this.d = new Uint8Array(this.w * this.h);
  }
  fillRing(ring, val = 1) {
    const { res, x0, z0, w, h, d } = this;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const [x, z] of ring) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
      if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
    }
    const jy0 = Math.max(0, Math.floor((bz0 - z0) / res));
    const jy1 = Math.min(h - 1, Math.ceil((bz1 - z0) / res));
    const xs = [];
    for (let j = jy0; j <= jy1; j++) {
      const z = z0 + (j + 0.5) * res;
      xs.length = 0;
      for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
        const [xa, za] = ring[k];
        const [xb, zb] = ring[i];
        if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
      xs.sort((p, q) => p - q);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = Math.max(0, Math.ceil((xs[n] - x0) / res - 0.5));
        const i1 = Math.min(w - 1, Math.floor((xs[n + 1] - x0) / res - 0.5));
        for (let i = i0; i <= i1; i++) d[j * w + i] = val;
      }
    }
  }
  edt(isSource) {
    const { w, h, d } = this;
    const INF = 1e20;
    const f = new Float64Array(Math.max(w, h));
    const out = new Float32Array(w * h);
    const v = new Int32Array(Math.max(w, h));
    const zz = new Float64Array(Math.max(w, h) + 1);
    const dt1 = (n, get, set) => {
      for (let q = 0; q < n; q++) f[q] = get(q);
      let k = 0;
      v[0] = 0; zz[0] = -INF; zz[1] = INF;
      for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= zz[k]) {
          k--;
          s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < n; q++) {
        while (zz[k + 1] < q) k++;
        set(q, (q - v[k]) * (q - v[k]) + f[v[k]]);
      }
    };
    for (let i = 0; i < w * h; i++) out[i] = isSource(d[i]) ? 0 : INF;
    for (let i = 0; i < w; i++) dt1(h, (q) => out[q * w + i], (q, val) => (out[q * w + i] = val));
    for (let j = 0; j < h; j++) dt1(w, (q) => out[j * w + q], (q, val) => (out[j * w + q] = val));
    return out;
  }
  keepLargest() {
    const { w, h, d } = this;
    const lab = new Int32Array(w * h);
    let best = 0, bestN = 0, cur = 0;
    const stack = [];
    for (let s = 0; s < w * h; s++) {
      if (!d[s] || lab[s]) continue;
      cur++;
      let n = 0;
      stack.push(s);
      lab[s] = cur;
      while (stack.length) {
        const p = stack.pop();
        n++;
        const i = p % w, j = (p - i) / w;
        if (i > 0 && d[p - 1] && !lab[p - 1]) { lab[p - 1] = cur; stack.push(p - 1); }
        if (i < w - 1 && d[p + 1] && !lab[p + 1]) { lab[p + 1] = cur; stack.push(p + 1); }
        if (j > 0 && d[p - w] && !lab[p - w]) { lab[p - w] = cur; stack.push(p - w); }
        if (j < h - 1 && d[p + w] && !lab[p + w]) { lab[p + w] = cur; stack.push(p + w); }
      }
      if (n > bestN) { bestN = n; best = cur; }
    }
    for (let i = 0; i < w * h; i++) d[i] = lab[i] === best ? 1 : 0;
  }
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
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
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az;
    const L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function rdpRing(ring, eps) {
  if (ring.length < 4) return ring.slice();
  let far = 0, i1 = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > far) { far = d; i1 = i; }
  }
  const a = rdp(ring.slice(0, i1 + 1), eps);
  const b = rdp([...ring.slice(i1), ring[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
function destair(out, short) {
  const n = out.length;
  const len = (i) => {
    const a = out[i], b = out[(i + 1) % n];
    return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  };
  const res = [];
  for (let i = 0; i < n; i++) {
    const prevLong = len((i + n - 1) % n) > short;
    const nextLong = len(i) > short;
    if (prevLong && nextLong) res.push(out[i]);
    if (!nextLong) {
      const a = out[i], b = out[(i + 1) % n];
      res.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
  }
  return res;
}

function roadHalfWidth(r) {
  // Slightly under-stamp vs declared curb width so OSM gaps still carve islands
  if (r.w > 3) return Math.max(2.5, r.w * 0.42);
  return 3.5;
}

/** Skip elevated / underground / pure footways that should not carve curb islands. */
function isBlockBoundingRoad(r) {
  const n = r.name || '';
  if (/PEDESTRIAN|FOOTWAY|STEPS|PATH|CYCLEWAY|ALLEY|DRIVEWAY|BRIDGE|TUNNEL|RAMP/.test(n)) return false;
  // Skip only true motorways (elevated); keep trunk/primary arterials (Connaught, Harcourt…)
  if (r.hw && (r.w || 0) >= 20) return false;
  if ((r.w || 0) < 4) return false;
  return true;
}

function maskRects(m, w, h, maxRects = 8, minSide = 8) {
  let total = 0;
  for (let k = 0; k < w * h; k++) total += m[k];
  const rects = [];
  const hist = new Int32Array(w);
  const stack = new Int32Array(w + 1);
  let covered = 0;
  for (let it = 0; it < maxRects; it++) {
    hist.fill(0);
    let best = 0, bi0 = 0, bi1 = 0, bj0 = 0, bj1 = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) hist[i] = m[j * w + i] ? hist[i] + 1 : 0;
      let sp = 0;
      for (let i = 0; i <= w; i++) {
        const hh = i < w ? hist[i] : 0;
        while (sp && hist[stack[sp - 1]] >= hh) {
          const top = stack[--sp];
          const height = hist[top];
          const left = sp ? stack[sp - 1] + 1 : 0;
          const width = i - left;
          if (height >= minSide && width >= minSide) {
            const area = height * width;
            if (area > best) { best = area; bi0 = left; bi1 = i - 1; bj0 = j - height + 1; bj1 = j; }
          }
        }
        stack[sp++] = i;
      }
    }
    if (best < 120 || (rects.length && best < total * 0.06)) break;
    rects.push([bi0, bi1, bj0, bj1]);
    covered += best;
    for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) m[j * w + i] = 0;
    if (covered > total * 0.93) break;
  }
  return { rects, total, covered };
}

/**
 * @param {{ landRing: number[][], roadLines: {name,w,pts}[], strip?: number, sidewalk?: number, log?: Function }} opts
 * @returns {{ blocks: object[], innerRing: number[][] }}
 */
export function buildHkBlocks({ landRing, roadLines, strip = 20, sidewalk = 4.0, log = console.log }) {
  const mb = bbox(landRing);
  // Coarse land with waterfront strip eroded
  const land2 = new Raster(mb.x0 - 10, mb.z0 - 10, mb.x1 + 10, mb.z1 + 10, 2);
  land2.fillRing(landRing, 1);
  {
    const toWater = land2.edt((v) => v === 0);
    const rc = (strip / 2) ** 2;
    for (let i = 0; i < land2.d.length; i++) land2.d[i] = toWater[i] > rc ? 1 : 0;
  }
  land2.keepLargest();
  // Trace a simple inner ring via sampling the eroded mask bbox edges is hard; reuse landRing eroded conceptually
  // by rebuilding at 1m from the eroded 2m mask's largest component via fill of original then EDT strip.
  const X0 = Math.floor(mb.x0) - 4, X1 = Math.ceil(mb.x1) + 4;
  const Z0 = Math.floor(mb.z0) - 4, Z1 = Math.ceil(mb.z1) + 4;
  const R = new Raster(X0, Z0, X1, Z1, RES);
  R.fillRing(landRing, 1);
  {
    const toWater = R.edt((v) => v === 0);
    const rc = strip ** 2;
    for (let i = 0; i < R.d.length; i++) R.d[i] = toWater[i] > rc ? 1 : 0;
  }
  R.keepLargest();
  const W = R.w, H = R.h, D = R.d;
  log(`[hk-blocks] land raster ${W}×${H} (${((W * H) / 1e6).toFixed(2)} M cells)`);

  // Stamp roadway capsules
  const roads = [];
  for (const r of roadLines) {
    if (!isBlockBoundingRoad(r) || !r.pts || r.pts.length < 2) continue;
    const half = roadHalfWidth(r);
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1];
      if (!Number.isFinite(x0 + z0 + x1 + z1)) continue;
      roads.push({ x0, z0, x1, z1, r: half });
    }
  }
  log(`[hk-blocks] ${roads.length} roadway segments to stamp`);
  for (const s of roads) {
    const ix0 = Math.max(0, Math.floor((Math.min(s.x0, s.x1) - s.r - R.x0) / RES));
    const ix1 = Math.min(W - 1, Math.ceil((Math.max(s.x0, s.x1) + s.r - R.x0) / RES));
    const iz0 = Math.max(0, Math.floor((Math.min(s.z0, s.z1) - s.r - R.z0) / RES));
    const iz1 = Math.min(H - 1, Math.ceil((Math.max(s.z0, s.z1) + s.r - R.z0) / RES));
    if (ix0 > ix1 || iz0 > iz1) continue;
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
    const L2 = dx * dx + dz * dz || 1e-9;
    const r2 = s.r * s.r;
    for (let j = iz0; j <= iz1; j++) {
      const pz = R.z0 + (j + 0.5) * RES;
      for (let i = ix0; i <= ix1; i++) {
        const k = j * W + i;
        if (!D[k]) continue;
        const px = R.x0 + (i + 0.5) * RES;
        let t = ((px - s.x0) * dx + (pz - s.z0) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = s.x0 + t * dx - px, ez = s.z0 + t * dz - pz;
        if (ex * ex + ez * ez <= r2) D[k] = 0;
      }
    }
  }

  // Label curb islands
  const lab = new Int32Array(W * H);
  const comps = [];
  {
    const stack = new Int32Array(Math.min(W * H, 4e7));
    for (let s0 = 0; s0 < W * H; s0++) {
      if (!D[s0] || lab[s0]) continue;
      const id = comps.length + 1;
      let sp = 0, n = 0, i0 = W, i1 = -1, j0 = H, j1 = -1;
      stack[sp++] = s0;
      lab[s0] = id;
      while (sp) {
        const p = stack[--sp];
        n++;
        const i = p % W, j = (p - i) / W;
        if (i < i0) i0 = i; if (i > i1) i1 = i;
        if (j < j0) j0 = j; if (j > j1) j1 = j;
        if (i > 0 && D[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (i < W - 1 && D[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (j > 0 && D[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
        if (j < H - 1 && D[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
      }
      comps.push({ id, n, i0, i1, j0, j1, start: s0 });
    }
  }
  log(`[hk-blocks] ${comps.length} curb islands labelled`);

  function traceComponent(c) {
    const at = (i, j) => (i >= 0 && j >= 0 && i < W && j < H && lab[j * W + i] === c.id ? 1 : 0);
    const si = c.start % W, sj = (c.start - si) / W;
    const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
    let cx = si, cz = sj, dir = 0;
    const pts = [];
    const start = cx + ',' + cz + ',' + dir;
    let guard = 0;
    do {
      pts.push([R.x0 + cx * RES, R.z0 + cz * RES]);
      cx += DX[dir];
      cz += DZ[dir];
      let left, right;
      if (dir === 0) { left = at(cx, cz - 1); right = at(cx, cz); }
      else if (dir === 1) { left = at(cx, cz); right = at(cx - 1, cz); }
      else if (dir === 2) { left = at(cx - 1, cz); right = at(cx - 1, cz - 1); }
      else { left = at(cx - 1, cz - 1); right = at(cx, cz - 1); }
      if (left && right) dir = (dir + 3) % 4;
      else if (!right) dir = (dir + 1) % 4;
      if (++guard > 4e6) break;
    } while (cx + ',' + cz + ',' + dir !== start);
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], n = pts[(i + 1) % pts.length];
      if ((q[0] - p[0]) * (n[1] - q[1]) - (q[1] - p[1]) * (n[0] - q[0]) !== 0) out.push(q);
    }
    return destair(out, RES * 1.5);
  }

  // Property-line erosion
  const ER = Math.round(sidewalk / RES);
  const prop = new Uint8Array(W * H);
  {
    const tmp = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) {
      const row = j * W;
      let run = 0;
      const left = new Int32Array(W), right = new Int32Array(W);
      for (let i = 0; i < W; i++) {
        const L = lab[row + i];
        run = L && i > 0 && lab[row + i - 1] === L ? run + 1 : L ? 1 : 0;
        left[i] = run;
      }
      run = 0;
      for (let i = W - 1; i >= 0; i--) {
        const L = lab[row + i];
        run = L && i < W - 1 && lab[row + i + 1] === L ? run + 1 : L ? 1 : 0;
        right[i] = run;
      }
      for (let i = 0; i < W; i++) tmp[row + i] = lab[row + i] && left[i] > ER && right[i] > ER ? 1 : 0;
    }
    const up = new Int32Array(H), dn = new Int32Array(H);
    for (let i = 0; i < W; i++) {
      let run = 0;
      for (let j = 0; j < H; j++) {
        const k = j * W + i, L = lab[k];
        run = L && j > 0 && lab[k - W] === L ? run + 1 : L ? 1 : 0;
        up[j] = run;
      }
      run = 0;
      for (let j = H - 1; j >= 0; j--) {
        const k = j * W + i, L = lab[k];
        run = L && j < H - 1 && lab[k + W] === L ? run + 1 : L ? 1 : 0;
        dn[j] = run;
      }
      for (let j = 0; j < H; j++) prop[j * W + i] = tmp[j * W + i] && up[j] > ER && dn[j] > ER ? 1 : 0;
    }
  }

  function lotRects(c, maxRects = 8) {
    const w = c.i1 - c.i0 + 1, h = c.j1 - c.j0 + 1;
    const m = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (c.j0 + j) * W + c.i0 + i;
      if (prop[k] && lab[k] === c.id) m[j * w + i] = 1;
    }
    const { rects, total, covered } = maskRects(m, w, h, maxRects);
    return {
      rects: rects.map(([i0, i1, j0, j1]) => [
        R.x0 + (c.i0 + i0) * RES, R.x0 + (c.i0 + i1 + 1) * RES,
        R.z0 + (c.j0 + j0) * RES, R.z0 + (c.j0 + j1 + 1) * RES
      ]),
      propArea: total,
      covered
    };
  }

  const blocks = [];
  let small = 0;
  for (const c of comps) {
    const area = c.n * RES * RES;
    if (area < 28) { small++; continue; }
    let poly = traceComponent(c);
    poly = rdpRing(poly, 0.5);
    if (poly.length < 3) continue;
    if (ringArea(poly) > 0) poly.reverse();
    const bw = (c.i1 - c.i0 + 1) * RES, bd = (c.j1 - c.j0 + 1) * RES;
    const rectness = area / (bw * bd);
    const { rects, propArea, covered } = area >= 150 ? lotRects(c) : { rects: [], propArea: 0, covered: 0 };
    blocks.push({
      id: blocks.length,
      poly,
      area: Math.round(area),
      bbox: [R.x0 + c.i0 * RES, R.x0 + (c.i1 + 1) * RES, R.z0 + c.j0 * RES, R.z0 + (c.j1 + 1) * RES],
      rect: rectness > 0.985,
      rects,
      frames: null,
      fill: propArea ? Math.round((covered / propArea) * 100) / 100 : 0,
      park: 0,
      parkName: ''
    });
  }
  log(`[hk-blocks] ${blocks.length} blocks (${blocks.filter((b) => b.rect).length} rectangular, ${blocks.filter((b) => !b.rects.length).length} without lots); ${small} specks dropped`);
  return { blocks, innerRing: landRing };
}
