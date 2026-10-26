/**
 * HK elevated flyover recipes for Slop `/slop/hongkong`.
 * Name-match OSM GEO `ROADS[].raw` → chained decks via buildHkElevatedFlyovers.
 * Keep pure (no Three) so node:test can count GEO hits.
 */

/** @typedef {{ id: string, match: (raw: string) => boolean, label: string, rise: number, halfW: number }} HkFlyoverRecipe */

/** @type {HkFlyoverRecipe[]} */
export const HK_FLYOVER_RECIPES = [
  {
    id: 'harcourt',
    match: (raw) => /HARCOURT ROAD FLYOVER/i.test(raw),
    label: 'Harcourt Road Flyover',
    rise: 7.6,
    halfW: 7.6
  },
  {
    id: 'connaught-west',
    match: (raw) => /CONNAUGHT ROAD WEST FLYOVER/i.test(raw),
    label: 'Connaught Road West Flyover',
    rise: 7.2,
    halfW: 7.9
  },
  {
    id: 'rumsey',
    match: (raw) => /RUMSEY STREET FLYOVER/i.test(raw),
    label: 'Rumsey Street Flyover',
    rise: 7.0,
    halfW: 7.5
  },
  {
    id: 'canal',
    match: (raw) => /CANAL ROAD FLYOVER/i.test(raw),
    label: 'Canal Road Flyover',
    rise: 7.4,
    halfW: 7.4
  },
  // PR-F densify — major Island / Kowloon corridors (existing four unchanged)
  {
    id: 'kowloon-city',
    match: (raw) => /KOWLOON CITY FLYOVER/i.test(raw),
    label: 'Kowloon City Flyover',
    rise: 7.5,
    halfW: 7.6
  },
  {
    id: 'cwb',
    // En-dash / hyphen / space variants in GEO bake
    match: (raw) => /CENTRAL[\s–\-]*WAN\s*CHAI\s*BYPASS/i.test(raw),
    label: 'Central–Wan Chai Bypass',
    rise: 8.0,
    halfW: 8.2
  },
  {
    id: 'iec',
    match: (raw) => /ISLAND EASTERN CORRIDOR/i.test(raw),
    label: 'Island Eastern Corridor',
    rise: 8.5,
    halfW: 8.8
  },
  {
    id: 'west-kowloon',
    match: (raw) => /WEST KOWLOON HIGHWAY/i.test(raw),
    label: 'West Kowloon Highway',
    rise: 8.2,
    halfW: 8.5
  }
];

/** Count GEO road segs matching each recipe (for tests / smoke). */
export function countFlyoverRecipeMatches(roads) {
  const list = Array.isArray(roads) ? roads : [];
  return HK_FLYOVER_RECIPES.map((recipe) => {
    const segs = list.filter((r) => r && recipe.match(r.raw || ''));
    const highway = segs.filter((r) => r.highway).length;
    return { id: recipe.id, label: recipe.label, segs: segs.length, highway };
  });
}
