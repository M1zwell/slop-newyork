import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  lookupMeasuredHeight,
  floorsFromHeight,
  resolveLotFloors,
  HK_LOT_HEIGHT_META,
  MATCH_M
} from '../js/hk-measured-height.js';

test('measured height pack meta meets fabric match gate', () => {
  assert.equal(HK_LOT_HEIGHT_META.source, 'csdi-landsd-building');
  assert.ok(HK_LOT_HEIGHT_META.stats.csdi >= 200, `csdi=${HK_LOT_HEIGHT_META.stats.csdi}`);
  assert.ok(MATCH_M <= 25);
  const rate = Math.max(
    HK_LOT_HEIGHT_META.stats.matchRateFabric || 0,
    HK_LOT_HEIGHT_META.stats.matchRate || 0,
  );
  assert.ok(rate >= 0.7, `matchRate=${rate}`);
});

test('gzip pack agrees with js module n', () => {
  const pack = JSON.parse(gunzipSync(readFileSync('data/hk-lot-heights.json.gz')).toString());
  assert.equal(pack.lots.length, HK_LOT_HEIGHT_META.n);
  assert.ok(pack.buildings.length >= 200);
  for (const b of pack.buildings.slice(0, 50)) {
    assert.ok(b.h >= 3 && Number.isFinite(b.h));
  }
});

test('lookupMeasuredHeight returns finite h near Pedder fabric', () => {
  // Sample a known lot from the flat index — first point
  const hit0 = lookupMeasuredHeight(0, 0, 80);
  // May be null at exact origin plaza; try a few Central samples
  let found = hit0;
  for (const [x, z] of [[50, 20], [-80, -40], [200, 100], [120, -150]]) {
    const h = lookupMeasuredHeight(x, z, 40);
    if (h) { found = h; break; }
  }
  assert.ok(found, 'expected at least one measured hit in Central sample');
  assert.ok(Number.isFinite(found.h) && found.h >= 3);
  assert.ok(found.d <= 40);
});

test('floorsFromHeight never NaN; resolveLotFloors falls back', () => {
  assert.equal(floorsFromHeight(35, 3.5), 10);
  assert.equal(floorsFromHeight(NaN), 1);
  assert.equal(floorsFromHeight(-5), 1);
  const fb = resolveLotFloors(null, [4, 8], (a, b) => a);
  assert.equal(fb, 4);
  const far = resolveLotFloors({ x0: 9e6, x1: 9e6 + 10, z0: 9e6, z1: 9e6 + 10 }, [5, 5], () => 5);
  assert.equal(far, 5);
});

test('storeys consistency median ≤ 6 m (LandsD Top−Base vs Storeys×3.2)', () => {
  const med = HK_LOT_HEIGHT_META.stats.storeysMedianAbsErr;
  assert.ok(med != null && med <= 6, `storeysMedianAbsErr=${med}`);
});
