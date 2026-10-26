import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOnewayTag,
  parseLayerTag,
  isBridgeTag,
  isTunnelTag,
  deckYAt,
  recipeRiseHolds,
  roadLayerStats,
  HK_ROAD_LAYERS
} from '../js/hk-road-layers.js';
import { HK_FLYOVER_RECIPES } from '../js/hk-flyover-recipes.js';
import { ROADS, IS_HONGKONG } from '../js/city-config.js';
import { countFlyoverRecipeMatches } from '../js/hk-flyover-recipes.js';

test('IS_HONGKONG is true on this GEO bake', () => {
  assert.equal(IS_HONGKONG, true);
});

test('parse lane/layer/oneway/bridge tags', () => {
  assert.equal(parseOnewayTag({ oneway: 'yes' }), 1);
  assert.equal(parseOnewayTag({ oneway: '-1' }), -1);
  assert.equal(parseOnewayTag({}), 0);
  assert.equal(parseLayerTag({ layer: '2' }), 2);
  assert.equal(parseLayerTag({ layer: 'x' }), 0);
  assert.equal(isBridgeTag({ bridge: 'yes' }), true);
  assert.equal(isBridgeTag({ bridge: 'viaduct' }), true);
  assert.equal(isBridgeTag({}), false);
  assert.equal(isTunnelTag({ tunnel: 'yes' }), true);
});

test('sidecar has layer/bridge/oneway/lanes coverage', () => {
  const s = roadLayerStats();
  assert.ok(s.ways >= 1000, `ways=${s.ways}`);
  assert.ok(s.withLayer >= 100, `withLayer=${s.withLayer}`);
  assert.ok(s.withBridge >= 50, `withBridge=${s.withBridge}`);
  assert.ok(s.withOneway >= 500, `withOneway=${s.withOneway}`);
  assert.ok(s.withLanes >= 500, `withLanes=${s.withLanes}`);
  assert.ok(HK_ROAD_LAYERS.length === s.ways);
});

test('GEO ROADS stamped with layer/bridge/oneway fields', () => {
  const withLayer = ROADS.filter((r) => r.layer).length;
  const withBridge = ROADS.filter((r) => r.bridge).length;
  const withOneway = ROADS.filter((r) => r.oneway).length;
  assert.ok(withLayer >= 50, `stamped layer=${withLayer}`);
  assert.ok(withBridge >= 30, `stamped bridge=${withBridge}`);
  assert.ok(withOneway >= 200, `stamped oneway=${withOneway}`);
  // GEO string dir must stay FT/TW/TF — not numeric oneway
  for (const r of ROADS.slice(0, 200)) {
    assert.equal(typeof r.dir, 'string');
  }
});

test('Harcourt/Rumsey/Canal recipe rise holds ±0.5 m at mid-span', () => {
  for (const id of ['harcourt', 'rumsey', 'canal']) {
    const recipe = HK_FLYOVER_RECIPES.find((r) => r.id === id);
    assert.ok(recipe, id);
    assert.ok(recipeRiseHolds(recipe, 0.5), `${id} rise=${recipe.rise} mid=${deckYAt(recipe.rise, 0.5)}`);
    assert.ok(Math.abs(deckYAt(recipe.rise, 0.5) - recipe.rise) <= 0.5);
    // Ends stay near ground (no DEM sag — we use groundY=0 plateau, not bare DEM)
    assert.ok(deckYAt(recipe.rise, 0) < 1);
    assert.ok(deckYAt(recipe.rise, 1) < 1);
  }
});

test('baseline flyover recipes match GEO roads (Central bake)', () => {
  const counts = countFlyoverRecipeMatches(ROADS);
  const byId = Object.fromEntries(counts.map((c) => [c.id, c]));
  // Central GEO includes Harcourt / Rumsey / Connaught West; Canal Rd is east of bake bbox
  assert.ok(byId.harcourt.segs >= 2, `harcourt=${byId.harcourt.segs}`);
  assert.ok(byId.rumsey.segs >= 2, `rumsey=${byId.rumsey.segs}`);
  assert.ok(byId['connaught-west'].segs >= 2, `connaught-west=${byId['connaught-west'].segs}`);
  assert.ok(byId.harcourt.highway >= 1);
  assert.ok(byId.rumsey.highway >= 1);
  // Canal recipe still defined for future densify; rise gate covered above
  assert.ok(HK_FLYOVER_RECIPES.some((r) => r.id === 'canal'));
});
