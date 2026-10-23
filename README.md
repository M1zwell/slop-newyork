# Slop Hong Kong

A Hong Kong Central / Victoria Harbour simulation built with [three.js](https://threejs.org/), WebGPURenderer, and TSL. Fork of [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork) (via [M1zwell/slop-newyork](https://github.com/M1zwell/slop-newyork)) with the Manhattan geodata pipeline swapped for an OpenStreetMap Overpass extract of Central and the harbour.

Explore on foot, by car, by bicycle, or by helicopter.

> **Deploy target (confirmed):** [`gghere.com/slop/hongkong`](https://gghere.com/slop/hongkong)  
> Do **not** use bare `/hongkong` — `gghere.com/hongkong` currently **308**s to the jubuddy tiny-planet SPA (`jubuddy.com/hongkong`). Keep that redirect alone until a deliberate product change.

## Local preview

```bash
# any static file server from the repo root
npx --yes serve -l 4173 .
# then open http://localhost:4173/
```

Requires a browser with **WebGPU** (same as upstream Slop New York).

## Rebuild Hong Kong geodata

Cached Overpass JSON lives in `tools/data-hk/` (committed). Rebuild `js/nyc-geodata.js` without hitting Overpass:

```bash
GEO_DATA=tools/data-hk node --max-old-space-size=4096 tools/build-hk-geodata.mjs
```

Refresh OSM extracts (may time out — retry; Overpass is best-effort):

```bash
# example: coast / roads / parks / landmarks / piers queries in tools/data-hk/q_*.overpassql
bash tools/overpass.sh tools/data-hk/q_roads.overpassql tools/data-hk/osm_roads.json
# …repeat for q_coast, q_parks, q_landmarks, q_piers
GEO_DATA=tools/data-hk node --max-old-space-size=4096 tools/build-hk-geodata.mjs
```

World frame (v1): **1 unit = 1 m**, origin at **Pedder Street × Des Voeux Road Central**, bearing **0°** (x = east, z = south). Schema key names in `js/nyc-geodata.js` (`manhattan`, `centralPark`, …) are kept for engine compatibility; values are Hong Kong.

The legacy NYC builder (`tools/build-geodata.mjs` + `tools/data/`) remains in-tree but is unused by this branch’s default `js/nyc-geodata.js`.

## Deploy note for gghere

Recommended production wiring (do **not** flip in this PR):

| Path | Action |
|------|--------|
| `gghere.com/slop/hongkong` | Vercel rewrite / proxy to this static build (or a dedicated Vercel project) |
| `gghere.com/hongkong` | **Leave** existing 308 → jubuddy planet SPA |
| `jubuddy.com/hk` | Tiny planet — untouched |

## License and data

Project code: [MIT License](LICENSE) (same as upstream).

Geographic data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) ([ODbL](https://opendatacommons.org/licenses/odbl/)). Third-party data and dependencies retain their respective licenses.
