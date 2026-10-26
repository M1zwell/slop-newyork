# Slop HK P0+P1 VERIFY — Tiny Warsaw cherry-pick (measured heights + road layers)

**Branch:** `feat/slop-hk-tw-height-join`  
**Base:** `feat/slop-hongkong-central` @ `c097ec848abc0007138fcb384411341c3980ab36`  
**Date:** 2026-10-26 (Asia/Hong_Kong)  
**Repo:** `/workspace/m1zwell-slop-newyork` (local; CloudAgent blocked — usage exhausted)

## Goal

Mode A measured building heights (CSDI LandsD Top−Base) + OSM bridge/layer/oneway road polish, cherry-picking Tiny Warsaw *ideas* only (no vendoring).

## P0 — Measured heights

### Bake

```bash
node tools/bake-hk-slop-heights.mjs --bbox 114.152,22.277,114.1617,22.286
```

- CSDI FeatureServer (keyless): `landsd_rcd_1637211194312_35158/FeatureServer/0`
- `h = TopHeight − BaseHeight`; else `Storeys×3.2`; `max(3,h)`. Never raw TopHeight.
- Pedder ENU join ≤25 m; densified curb-lot samples (~18 m interior grid).
- Artifacts: `data/hk-lot-heights.json.gz`, `data/hk-lot-heights.stats.json`, `js/hk-lot-heights-data.js` (same-origin; no live CSDI in browser).

### Bake results (sample Central bbox)

| Metric | Value | Gate |
|--------|-------|------|
| CSDI buildings kept | 1192 | ≥200 ideal |
| Densified lot samples | 4976 | — |
| Lot→CSDI matchRate | 0.598 | informational (plazas/parks) |
| **Fabric matchRate** (CSDI→lot ≤25 m) | **0.996** (1187/1192) | **≥0.70 PASS** |
| storeysMedianAbsErr (Top−Base vs Storeys×3.2) | **4.7 m** | **≤6 PASS** |
| storeysP90AbsErr | 26.4 m | ≤15 strict FAIL; soft ≤30 PASS |
| Landmark median abs err vs GEO.h | 8.9 m (n=47) | reported only — GEO.h unchanged |

**p90 note:** LandsD `Storeys` often counts podium+tower while physical height is Top−Base; runtime uses Top−Base. Documented soft-fail.

### Runtime wiring

- `js/hk-measured-height.js` — spatial index + `resolveLotFloors` / `lookupMeasuredHeight`
- `js/buildings.js` — `floorsForLot` prefers measured; falls back `hk-height-tables.js`; no NaN
- Landmarks / `GEO.h` not overridden
- `SOURCE.txt` — LandsD/CSDI attribution

## P1 — Road polish

### Bake

```bash
node tools/bake-hk-road-layers.mjs
```

- Sidecar: `data/hk-road-layers.json` → `js/hk-road-layers-data.js`
- Coverage: ways 3212; layer 240; bridge 142; oneway 2700; lanes 2655
- `js/city-config.js` stamps `layer` / `bridge` / `tunnel` / `oneway` / `lanes` onto `ROADS` **without** overwriting GEO string `dir` (FT/TW/TF)

### Recipe rise ±0.5 m

- `js/hk-flyover-recipes.js` + `js/hk-road-layers.js` (`deckYAt`, `recipeRiseHolds`)
- Harcourt / Rumsey / Canal recipes hold mid-span rise ±0.5 m in unit tests
- Central GEO matches: Harcourt 7 segs, Rumsey 14, Connaught West 16; Canal east of bake bbox (recipe kept for densify)
- **Not ported this slice:** Soft-NO full elevated flyover mesh + DEM abutment (missing deps) — cars stay on existing road Y; recipe helpers gate future deck mesh

## Tests

```bash
node --test tests/hk-measured-height.test.mjs tests/hk-road-layers.test.mjs
# → 11/11 pass
node --test tests/geodata.test.mjs tests/teleports.test.cjs
# → 4/4 pass (no curb-island / teleport regression)
```

## Files changed / added

**Modified:** `js/buildings.js`, `js/city-config.js`  
**Added:**  
- `tools/bake-hk-slop-heights.mjs`, `tools/bake-hk-road-layers.mjs`, `tools/lib/building-geom.mjs`  
- `js/hk-measured-height.js`, `js/hk-lot-heights-data.js`, `js/hk-height-tables.js`  
- `js/hk-road-layers.js`, `js/hk-road-layers-data.js`, `js/hk-flyover-recipes.js`  
- `data/hk-lot-heights.json.gz`, `data/hk-lot-heights.stats.json`, `data/hk-road-layers.json`  
- `tests/hk-measured-height.test.mjs`, `tests/hk-road-layers.test.mjs`  
- `SOURCE.txt`, `VERIFY.md`

## Non-goals (honoured)

No Tiny Warsaw vendoring · no Open3Dhk meshes · no client LandsD keys · no live CSDI in browser · curb-island / SCC bars preserved

## Blockers / follow-ups

1. **CloudAgent / usage exhausted** — implemented on existing local checkout only.
2. **Push / `gh pr create`** — try after commit; if auth fails, commits stay local + this VERIFY + patch.
3. **Elevated deck mesh** — Soft-NO `buildHkElevatedFlyovers` + DEM abutment not ported (P1 helpers/tests only).
4. **p90 strict ≤15 m** — soft-fail until LandsD Storeys semantics filtered or alternate abs-err source (not Planet same-source tautology).
5. **Canal Rd Flyover** — outside Central GEO bbox; recipe present, segs=0 until densify.

## Acceptance checklist

- [x] P0 Mode A bake succeeded (1192 CSDI)
- [x] Fabric match ≥70% (99.6%)
- [x] Median abs err ≤6 m (4.7 m storeys consistency)
- [x] Measured preferred in buildings.js; quantile fallback; no NaN
- [x] Landmarks / GEO.h unchanged
- [x] SOURCE attribution
- [x] P1 layer/bridge/oneway stamped; dir strings preserved
- [x] Recipe rise ±0.5 m unit-tested
- [x] Unit tests green (11 + 4)
- [ ] PR opened (pending auth)
