/**
 * OSM road layer / bridge / oneway helpers for Slop HK (P1).
 * Pure — no Three. Sidecar: hk-road-layers-data.js (baked offline).
 */
import { HK_ROAD_LAYERS, HK_ROAD_LAYERS_META } from './hk-road-layers-data.js';

export function parseOnewayTag(t) {
  if (!t || typeof t !== 'object') return 0;
  if (t.oneway === 'yes') return 1;
  if (t.oneway === '-1') return -1;
  return 0;
}

export function parseLayerTag(t) {
  if (!t || typeof t !== 'object') return 0;
  if (t.layer == null || t.layer === '') return 0;
  const n = Number.parseInt(String(t.layer), 10);
  return Number.isFinite(n) ? n : 0;
}

export function isBridgeTag(t) {
  if (!t || typeof t !== 'object') return false;
  const b = t.bridge;
  return b === 'yes' || b === 'viaduct' || b === 'movable' || b === 'cantilever' || b === 'covered';
}

export function isTunnelTag(t) {
  if (!t || typeof t !== 'object') return false;
  return t.tunnel === 'yes' || t.tunnel === 'building_passage' || t.tunnel === 'culvert';
}

/**
 * Deck elevation for ambient traffic: recipe rise when elevated, else ground.
 * Cars must not sag to bare DEM on Harcourt/Rumsey/Canal etc.
 * @param {number} recipeRise metres AGL at mid-span
 * @param {number} t path fraction 0..1
 * @param {number} [fillY=4] rise threshold treated as elevated
 * @param {number} [groundY=0]
 */
export function deckYAt(recipeRise, t, fillY = 4, groundY = 0) {
  const rise = Number.isFinite(recipeRise) ? recipeRise : 0;
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  // Smoothstep ramps over first/last 12%
  const ramp = (x) => {
    const s = Math.max(0, Math.min(1, x));
    return s * s * (3 - 2 * s);
  };
  let frac = 1;
  if (u < 0.12) frac = ramp(u / 0.12);
  else if (u > 0.88) frac = ramp((1 - u) / 0.12);
  const y = groundY + rise * frac;
  return y >= fillY ? y : groundY;
}

/** True if a mid-span sample stays within ±tol of recipe.rise (elevated plateau). */
export function recipeRiseHolds(recipe, tol = 0.5) {
  if (!recipe || !(recipe.rise > 0)) return false;
  const mid = deckYAt(recipe.rise, 0.5, 4, 0);
  return Math.abs(mid - recipe.rise) <= tol;
}

export function roadLayerStats() {
  return HK_ROAD_LAYERS_META?.stats || { ways: (HK_ROAD_LAYERS || []).length };
}

export { HK_ROAD_LAYERS, HK_ROAD_LAYERS_META };
