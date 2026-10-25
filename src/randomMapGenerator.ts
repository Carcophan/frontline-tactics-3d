import { ContinentDef, ContinentId, TerritoryDef } from './mapData';

export interface GeneratedWorldMap {
  worldName: string;
  seed: number;
  continents: Record<ContinentId, ContinentDef>;
  territories: TerritoryDef[];
  seaCrossingKeys: Set<string>;
  wrapCrossingKeys: Set<string>;
}

interface ContinentTheme {
  continentNames: string[];
  baseColor: number;
  territoryNames: string[];
}

const WORLD_PREFIXES = [
  'Chroniken von',
  'Sphäre von',
  'Archipel von',
  'Kontinente von',
  'Reiche von',
  'Weltkarte',
  'Ära von',
];

const WORLD_ROOT_NAMES = [
  'Aethelgard',
  'Valoria',
  'Drakonia',
  'Solaria',
  'Thalassia',
  'Hyperborea',
  'Kaldorien',
  'Aurelia',
  'Nephria',
  'Askalon',
  'Eldoria',
  'Valkyria',
];

const CONTINENT_THEMES: ContinentTheme[] = [
  {
    // Nordic / Highland Realm
    continentNames: [
      'Nordmark',
      'Valoria',
      'Frostheim',
      'Skaldenreich',
      'Hyperborea',
      'Eisthron',
    ],
    baseColor: 0x4b7bc9,
    territoryNames: [
      'Kaldorien',
      'Eisenfels',
      'Winterwacht',
      'Sturmhall',
      'Drachenfjord',
      'Runenstein',
      'Nebelhorn',
      'Silbergrat',
      'Wolfsklippe',
      'Eiswacht',
      'Thorshaven',
      'Gletschertal',
      'Nordkap',
      'Rabenfels',
      'Bärenbucht',
      'Grimmwald',
    ],
  },
  {
    // Imperial Heartland
    continentNames: [
      'Aethelgard',
      'Kronland',
      'Aurelia',
      'Valenreich',
      'Zentralmark',
      'Alt-Imperium',
    ],
    baseColor: 0xd9a441,
    territoryNames: [
      'Königsmark',
      'Alderburg',
      'Greifenstein',
      'Hohenwacht',
      'Goldtal',
      'Adlerhorst',
      'Kronenburg',
      'Ehrenfels',
      'Lichtenwald',
      'Löwenstein',
      'Silberstrom',
      'Weidenmark',
      'Kupferberg',
      'Falkenburg',
      'Dornenwall',
      'Sternenfurt',
    ],
  },
  {
    // Eastern / Jade Steppe Empire
    continentNames: [
      'Drakonia',
      'Jadereich',
      'Askalon',
      'Kitanien',
      'Ostreich',
      'Zinnober-Bund',
    ],
    baseColor: 0x5aa867,
    territoryNames: [
      'Drachenkamm',
      'Jadeküste',
      'Purpursteppe',
      'Himmelsgrat',
      'Phönixtal',
      'Schwertküste',
      'Lotusbucht',
      'Donnergipfel',
      'Schattenpass',
      'Mondklippe',
      'Bambusmark',
      'Kaiserfeste',
      'Tigerbucht',
      'Wolkengipfel',
      'Eisensteppe',
      'Feuerberg',
      'Kranichinsel',
      'Sternental',
    ],
  },
  {
    // Sun & Desert Dominions
    continentNames: [
      'Solaria',
      'Kharadun',
      'Sonnenreich',
      'Oasenbund',
      'Südmark',
      'Al-Qadim',
    ],
    baseColor: 0xb57c4a,
    territoryNames: [
      'Sonnenkap',
      'Goldküste',
      'Sandsturmoase',
      'Mirage-Plateau',
      'Skorpiontal',
      'Bernsteinbucht',
      'Feuerdüne',
      'Karmesinküste',
      'Saphiroase',
      'Heliopolis',
      'Wüstenfeste',
      'Qor-Zitadelle',
      'Dornensavanne',
      'Rotfels',
      'Karawanenpass',
      'Südwindkap',
    ],
  },
  {
    // Crimson / Volcanic / Jungle Continent
    continentNames: [
      'Sylvaria',
      'Verdantia',
      'Eldorado',
      'Smaragdbund',
      'Pyroklast',
      'Vulkanküste',
    ],
    baseColor: 0xc95b4b,
    territoryNames: [
      'Smaragdbucht',
      'Nebeldschungel',
      'Goldfluss',
      'Jaguarfels',
      'Regenwaldhochland',
      'Vulkanspitze',
      'Schlangenbucht',
      'Obsidianküste',
      'Sonnentempel',
      'Grünmark',
      'Orchideental',
      'Kondorhorst',
      'Flussdelta',
      'Bernsteinwald',
    ],
  },
  {
    // Maritime Archipelago & Coral Kingdoms
    continentNames: [
      'Thalassia',
      'Zephyria',
      'Nephria',
      'Korsaren-Archipel',
      'Südseebund',
      'Atlantis-Riff',
    ],
    baseColor: 0x9b5bc9,
    territoryNames: [
      'Korsarenriff',
      'Perlenbucht',
      'Sturminsel',
      'Korallenkap',
      'Dreizack-Atoll',
      'Schildkrötenbucht',
      'Albatrosklippe',
      'Tiefseewacht',
      'Seewindinsel',
      'Lagunenstadt',
      'Bernsteinriff',
      'Krakenbucht',
      'Südhorn',
      'Nautilusküste',
    ],
  },
];

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface PolyVertex {
  x: number;
  z: number;
  edgeNeighborSite: number; // Site index that generated the edge starting at this vertex
}

/**
 * Clips a convex polygon against the half-plane of points closer to (sx, sz) than (ox, oz).
 */
function clipPolygonByBisector(
  poly: PolyVertex[],
  sx: number,
  sz: number,
  ox: number,
  oz: number,
  otherSiteIdx: number,
  marginBias = 0
): PolyVertex[] {
  if (poly.length < 3) return poly;
  const nx = ox - sx;
  const nz = oz - sz;
  const len = Math.hypot(nx, nz);
  if (len < 1e-6) return poly;

  // Midpoint shifted by marginBias along normal
  const mx = (sx + ox) * 0.5 + (nx / len) * marginBias;
  const mz = (sz + oz) * 0.5 + (nz / len) * marginBias;

  // Inside condition: (p - m) . n <= 0
  const evalDist = (p: PolyVertex) => (p.x - mx) * nx + (p.z - mz) * nz;

  const out: PolyVertex[] = [];
  const n = poly.length;

  for (let i = 0; i < n; i++) {
    const curr = poly[i];
    const next = poly[(i + 1) % n];
    const dCurr = evalDist(curr);
    const dNext = evalDist(next);
    const currIn = dCurr <= 1e-6;
    const nextIn = dNext <= 1e-6;

    if (currIn && nextIn) {
      out.push({ ...curr });
    } else if (currIn && !nextIn) {
      out.push({ ...curr });
      const denom = dCurr - dNext;
      const t = Math.abs(denom) > 1e-9 ? dCurr / denom : 0.5;
      out.push({
        x: curr.x + (next.x - curr.x) * t,
        z: curr.z + (next.z - curr.z) * t,
        edgeNeighborSite: otherSiteIdx,
      });
    } else if (!currIn && nextIn) {
      const denom = dCurr - dNext;
      const t = Math.abs(denom) > 1e-9 ? dCurr / denom : 0.5;
      out.push({
        x: curr.x + (next.x - curr.x) * t,
        z: curr.z + (next.z - curr.z) * t,
        edgeNeighborSite: curr.edgeNeighborSite,
      });
    }
  }

  return out;
}

function computePolygonCentroid(pts: [number, number][]): [number, number] {
  if (pts.length === 0) return [0, 0];
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const cross = x1 * z2 - x2 * z1;
    area += cross;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  if (Math.abs(area) < 1e-4) {
    const sx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const sz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [Number(sx.toFixed(2)), Number(sz.toFixed(2))];
  }
  area *= 3;
  return [Number((cx / area).toFixed(2)), Number((cz / area).toFixed(2))];
}

function pointToSegmentDist(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-8) return Math.hypot(px - x1, pz - z1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

/**
 * Generates a complete, balanced 42-territory procedural world map with 6 fictional continents,
 * organic coastlines, islands, land borders, maritime sea lanes, and an East-West wrap-around crossing.
 */
export function generateRandomWorldMap(inputSeed?: number): GeneratedWorldMap {
  const seed =
    inputSeed !== undefined
      ? inputSeed
      : Math.floor(Math.random() * 899999) + 100000;
  const rng = createMulberry32(seed);

  // 1. Continent specs (always 42 total territories across the 6 ContinentIds)
  const continentSpecs: { id: ContinentId; count: number; bonus: number }[] = [
    { id: 'asia', count: 11, bonus: 7 },
    { id: 'north_america', count: 9, bonus: 5 },
    { id: 'europe', count: 7, bonus: 5 },
    { id: 'africa', count: 6, bonus: 3 },
    { id: 'south_america', count: 5, bonus: 2 },
    { id: 'australia', count: 4, bonus: 2 },
  ];

  // 6 Macro-slots on the war table (3 columns x 2 rows)
  const macroSlots: { col: number; row: number; cx: number; cz: number }[] = [
    {
      col: 0,
      row: 0,
      cx: -28.5 + (rng() - 0.5) * 3.2,
      cz: -10.5 + (rng() - 0.5) * 2.4,
    },
    {
      col: 1,
      row: 0,
      cx: 0.0 + (rng() - 0.5) * 3.5,
      cz: -10.8 + (rng() - 0.5) * 2.4,
    },
    {
      col: 2,
      row: 0,
      cx: 28.5 + (rng() - 0.5) * 3.2,
      cz: -10.5 + (rng() - 0.5) * 2.4,
    },
    {
      col: 0,
      row: 1,
      cx: -28.0 + (rng() - 0.5) * 3.2,
      cz: 10.8 + (rng() - 0.5) * 2.4,
    },
    {
      col: 1,
      row: 1,
      cx: 0.0 + (rng() - 0.5) * 3.5,
      cz: 11.0 + (rng() - 0.5) * 2.4,
    },
    {
      col: 2,
      row: 1,
      cx: 28.0 + (rng() - 0.5) * 3.2,
      cz: 10.8 + (rng() - 0.5) * 2.4,
    },
  ];

  // Randomly assign the 6 continents to the 6 geographic macro-slots
  const slotOrder = shuffleInPlace([0, 1, 2, 3, 4, 5], rng);
  const themes = shuffleInPlace([...CONTINENT_THEMES], rng);

  const continents = {} as Record<ContinentId, ContinentDef>;
  const continentSlotMap = {} as Record<ContinentId, number>;
  const continentTerritoryNames = {} as Record<ContinentId, string[]>;

  continentSpecs.forEach((spec, idx) => {
    const slotIdx = slotOrder[idx];
    continentSlotMap[spec.id] = slotIdx;

    // Slight horizontal adjustment if a large continent is in the middle vs edges
    const theme = themes[idx];
    const cName =
      theme.continentNames[Math.floor(rng() * theme.continentNames.length)];
    continents[spec.id] = {
      id: spec.id,
      name: cName,
      bonus: spec.bonus,
      baseColor: theme.baseColor,
    };

    const shuffledTerrNames = shuffleInPlace([...theme.territoryNames], rng);
    continentTerritoryNames[spec.id] = shuffledTerrNames.slice(0, spec.count);
  });

  // World Name
  const worldPrefix =
    WORLD_PREFIXES[Math.floor(rng() * WORLD_PREFIXES.length)];
  const worldRoot =
    WORLD_ROOT_NAMES[Math.floor(rng() * WORLD_ROOT_NAMES.length)];
  const worldName = `${worldPrefix} ${worldRoot}`;

  // 2. Place initial 42 Land Seeds around their assigned macro-slot centers
  interface LandSeed {
    index: number;
    id: string;
    name: string;
    continent: ContinentId;
    slotIdx: number;
    x: number;
    z: number;
    isIsland: boolean;
  }

  const landSeeds: LandSeed[] = [];
  for (const spec of continentSpecs) {
    const slotIdx = continentSlotMap[spec.id];
    const slot = macroSlots[slotIdx];
    const names = continentTerritoryNames[spec.id];
    const baseAngle = rng() * Math.PI * 2;

    for (let i = 0; i < spec.count; i++) {
      const r = 2.65 * Math.sqrt(i + 0.45);
      const theta = baseAngle + i * 2.39996 + (rng() - 0.5) * 0.35;
      const x = Math.max(
        -41.5,
        Math.min(41.5, slot.cx + Math.cos(theta) * r * 1.24)
      );
      const z = Math.max(
        -19.5,
        Math.min(20.5, slot.cz + Math.sin(theta) * r * 0.92)
      );
      const index = landSeeds.length;
      landSeeds.push({
        index,
        id: `fict_terr_${index + 1}`,
        name: names[i] ?? `${continents[spec.id].name}-${i + 1}`,
        continent: spec.id,
        slotIdx,
        x,
        z,
        isIsland: false,
      });
    }
  }

  // 3. Relax the 42 Land Seeds (strong intra-continent cohesion + inter-continent channel gap)
  const numLand = landSeeds.length;
  for (let iter = 0; iter < 48; iter++) {
    const fx = new Float64Array(numLand);
    const fz = new Float64Array(numLand);

    // Pairwise repulsion
    for (let i = 0; i < numLand; i++) {
      for (let j = i + 1; j < numLand; j++) {
        const sameCont = landSeeds[i].continent === landSeeds[j].continent;
        const minDist = sameCont ? 5.95 : 9.7;
        const dx = landSeeds[j].x - landSeeds[i].x;
        const dz = landSeeds[j].z - landSeeds[i].z;
        const d = Math.hypot(dx, dz) || 0.01;
        if (d < minDist) {
          const push = ((minDist - d) / minDist) * (sameCont ? 0.42 : 0.65);
          const ux = (dx / d) * push;
          const uz = (dz / d) * push;
          fx[i] -= ux;
          fz[i] -= uz;
          fx[j] += ux;
          fz[j] += uz;
        }
      }
    }

    // Intra-continent cohesion so no territory drifts away from its continent
    for (const spec of continentSpecs) {
      const members = landSeeds.filter((s) => s.continent === spec.id);
      const slot = macroSlots[continentSlotMap[spec.id]];
      const meanX = members.reduce((s, m) => s + m.x, 0) / members.length;
      const meanZ = members.reduce((s, m) => s + m.z, 0) / members.length;

      for (const m of members) {
        // Pull gently toward slot target and continent centroid
        fx[m.index] += (slot.cx - m.x) * 0.06 + (meanX - m.x) * 0.05;
        fz[m.index] += (slot.cz - m.z) * 0.06 + (meanZ - m.z) * 0.05;

        // Ensure proximity to nearest same-continent neighbor
        let nearestDist = Infinity;
        let nearestOther: LandSeed | null = null;
        for (const other of members) {
          if (other.index === m.index) continue;
          const d = Math.hypot(other.x - m.x, other.z - m.z);
          if (d < nearestDist) {
            nearestDist = d;
            nearestOther = other;
          }
        }
        if (nearestOther && nearestDist > 6.5) {
          const pull = (nearestDist - 6.5) * 0.25;
          const dx = nearestOther.x - m.x;
          const dz = nearestOther.z - m.z;
          fx[m.index] += (dx / nearestDist) * pull;
          fz[m.index] += (dz / nearestDist) * pull;
        }
      }
    }

    for (let i = 0; i < numLand; i++) {
      landSeeds[i].x = Math.max(-41.2, Math.min(41.2, landSeeds[i].x + fx[i]));
      landSeeds[i].z = Math.max(-19.2, Math.min(20.2, landSeeds[i].z + fz[i]));
    }
  }

  // Pick 1 or 2 inter-continental pairs to form natural Land Isthmuses (narrow land bridges),
  // while all other inter-continental boundaries become sea straits/channels!
  const landBridgeSeedPairs = new Set<string>();
  const macroAdjacencies: [number, number][] = [
    [0, 1],
    [1, 2],
    [3, 4],
    [4, 5],
    [0, 3],
    [1, 4],
    [2, 5],
  ];
  shuffleInPlace(macroAdjacencies, rng);
  let bridgesCreated = 0;
  for (const [slotA, slotB] of macroAdjacencies) {
    if (bridgesCreated >= 2) break;
    let bestI = -1;
    let bestJ = -1;
    let bestD = Infinity;
    for (let i = 0; i < numLand; i++) {
      if (landSeeds[i].slotIdx !== slotA) continue;
      for (let j = 0; j < numLand; j++) {
        if (landSeeds[j].slotIdx !== slotB) continue;
        const d = Math.hypot(
          landSeeds[i].x - landSeeds[j].x,
          landSeeds[i].z - landSeeds[j].z
        );
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI >= 0 && bestJ >= 0 && bestD < 12.2 && rng() < 0.65) {
      // Pull this pair slightly closer so they share a direct land isthmus
      const mx = (landSeeds[bestI].x + landSeeds[bestJ].x) * 0.5;
      const mz = (landSeeds[bestI].z + landSeeds[bestJ].z) * 0.5;
      landSeeds[bestI].x = landSeeds[bestI].x * 0.68 + mx * 0.32;
      landSeeds[bestI].z = landSeeds[bestI].z * 0.68 + mz * 0.32;
      landSeeds[bestJ].x = landSeeds[bestJ].x * 0.68 + mx * 0.32;
      landSeeds[bestJ].z = landSeeds[bestJ].z * 0.68 + mz * 0.32;
      const pairKey = [bestI, bestJ].sort((a, b) => a - b).join('--');
      landBridgeSeedPairs.add(pairKey);
      bridgesCreated++;
    }
  }

  // 4. Generate Water Seeds (Inter-continental Sea Channels + Coastal Ocean Ring)
  const waterSeeds: [number, number][] = [];

  const canAddWaterSeed = (
    wx: number,
    wz: number,
    minLandDist: number,
    minWaterDist: number
  ): boolean => {
    for (let i = 0; i < numLand; i++) {
      if (Math.hypot(wx - landSeeds[i].x, wz - landSeeds[i].z) < minLandDist) {
        return false;
      }
    }
    for (const [ox, oz] of waterSeeds) {
      if (Math.hypot(wx - ox, wz - oz) < minWaterDist) {
        return false;
      }
    }
    return true;
  };

  // 4a. Sea channel seeds between different continents (except chosen land bridges)
  for (let i = 0; i < numLand; i++) {
    for (let j = i + 1; j < numLand; j++) {
      if (landSeeds[i].continent === landSeeds[j].continent) continue;
      const pairKey = `${i}--${j}`;
      if (landBridgeSeedPairs.has(pairKey)) continue;

      const d = Math.hypot(
        landSeeds[i].x - landSeeds[j].x,
        landSeeds[i].z - landSeeds[j].z
      );
      if (d >= 7.6 && d <= 16.5) {
        const mx = (landSeeds[i].x + landSeeds[j].x) * 0.5;
        const mz = (landSeeds[i].z + landSeeds[j].z) * 0.5;
        if (canAddWaterSeed(mx, mz, 3.75, 2.5)) {
          waterSeeds.push([mx, mz]);
        }
      }
    }
  }

  // 4b. Radial coastal water seeds around every Land Seed so no coastal polygon balloons out
  const numDirs = 12;
  for (let i = 0; i < numLand; i++) {
    for (let dIdx = 0; dIdx < numDirs; dIdx++) {
      const angle = (dIdx / numDirs) * Math.PI * 2 + (rng() - 0.5) * 0.2;
      const dist = 5.9 + (rng() - 0.5) * 0.7;
      const wx = landSeeds[i].x + Math.cos(angle) * dist;
      const wz = landSeeds[i].z + Math.sin(angle) * dist;
      if (canAddWaterSeed(wx, wz, 5.15, 2.7)) {
        waterSeeds.push([wx, wz]);
      }
    }
  }

  // 4c. Background ocean grid seeds
  for (let gx = -45; gx <= 45; gx += 3.6) {
    for (let gz = -23; gz <= 24; gz += 3.6) {
      const wx = gx + (rng() - 0.5) * 1.1;
      const wz = gz + (rng() - 0.5) * 1.1;
      if (canAddWaterSeed(wx, wz, 5.2, 2.8)) {
        waterSeeds.push([wx, wz]);
      }
    }
  }

  // 5. Compute Exact Clipped Voronoi Polygons for the 42 Land Territories
  const allSites: [number, number][] = [
    ...landSeeds.map((s): [number, number] => [s.x, s.z]),
    ...waterSeeds,
  ];

  const rawTerritoryPolys: PolyVertex[][] = [];
  const landBorderSharedCount: Record<string, number> = {};

  for (let i = 0; i < numLand; i++) {
    const [sx, sz] = allSites[i];
    // Initial clockwise bounding box in (x right, z down)
    let poly: PolyVertex[] = [
      { x: -45.0, z: -22.8, edgeNeighborSite: -1 },
      { x: 45.0, z: -22.8, edgeNeighborSite: -1 },
      { x: 45.0, z: 23.8, edgeNeighborSite: -1 },
      { x: -45.0, z: 23.8, edgeNeighborSite: -1 },
    ];

    for (let j = 0; j < allSites.length; j++) {
      if (i === j) continue;
      const [ox, oz] = allSites[j];
      if (Math.hypot(ox - sx, oz - sz) > 22.0) continue;
      poly = clipPolygonByBisector(poly, sx, sz, ox, oz, j, 0);
    }

    rawTerritoryPolys.push(poly);
  }

  // 6. Canonical Vertex Snapping (eliminates tiny < 0.32 micro-edges and unifies shared vertices)
  const canonicalVertices: [number, number][] = [];
  const snapRadius = 0.34;

  const getCanonicalVertexId = (x: number, z: number): number => {
    for (let k = 0; k < canonicalVertices.length; k++) {
      const [cx, cz] = canonicalVertices[k];
      if (Math.hypot(x - cx, z - cz) <= snapRadius) {
        return k;
      }
    }
    const id = canonicalVertices.length;
    canonicalVertices.push([Number(x.toFixed(3)), Number(z.toFixed(3))]);
    return id;
  };

  interface SnappedPolyEdge {
    vStart: number;
    vEnd: number;
    neighborSite: number;
  }

  const snappedPolys: SnappedPolyEdge[][] = [];

  for (let i = 0; i < numLand; i++) {
    const poly = rawTerritoryPolys[i];
    const vIds = poly.map((v) => getCanonicalVertexId(v.x, v.z));
    const n = poly.length;
    const edges: SnappedPolyEdge[] = [];

    for (let k = 0; k < n; k++) {
      const vStart = vIds[k];
      const vEnd = vIds[(k + 1) % n];
      if (vStart === vEnd) continue; // Collapsed micro-edge
      edges.push({
        vStart,
        vEnd,
        neighborSite: poly[k].edgeNeighborSite,
      });
    }

    // Also remove consecutive back-and-forth degenerate spikes if any
    const cleaned: SnappedPolyEdge[] = [];
    for (const e of edges) {
      if (
        cleaned.length > 0 &&
        cleaned[cleaned.length - 1].vStart === e.vEnd &&
        cleaned[cleaned.length - 1].vEnd === e.vStart
      ) {
        cleaned.pop();
      } else {
        cleaned.push(e);
      }
    }

    snappedPolys.push(cleaned);
  }

  // 7. Subdivide Shared Edges & Coastlines for Organic Craggy Silhouettes
  // Cache midpoint displacements by undirected canonical vertex pair `minV--maxV`
  const edgeMidpointCache = new Map<string, [number, number][]>();

  const getSubdividedEdgePoints = (
    vStart: number,
    vEnd: number,
    isCoastal: boolean
  ): [number, number][] => {
    const low = Math.min(vStart, vEnd);
    const high = Math.max(vStart, vEnd);
    const key = `${low}--${high}`;
    const isForward = vStart < vEnd;

    if (!edgeMidpointCache.has(key)) {
      const [x1, z1] = canonicalVertices[low];
      const [x2, z2] = canonicalVertices[high];
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);

      // Normal vector
      const nx = -dz / (len || 1);
      const nz = dx / (len || 1);

      const mids: [number, number][] = [];
      if (isCoastal && len >= 2.2) {
        // Two-point craggy coastal subdivision
        const amp1 =
          ((rng() - 0.5) * 2) * Math.min(0.42, len * 0.13);
        const amp2 =
          ((rng() - 0.5) * 2) * Math.min(0.42, len * 0.13);
        mids.push([
          Number((x1 + dx * 0.34 + nx * amp1).toFixed(3)),
          Number((z1 + dz * 0.34 + nz * amp1).toFixed(3)),
        ]);
        mids.push([
          Number((x1 + dx * 0.68 + nx * amp2).toFixed(3)),
          Number((z1 + dz * 0.68 + nz * amp2).toFixed(3)),
        ]);
      } else if (len >= 2.3) {
        // Single subtle bend on internal land borders
        const amp = ((rng() - 0.5) * 2) * Math.min(0.28, len * 0.09);
        mids.push([
          Number((x1 + dx * 0.5 + nx * amp).toFixed(3)),
          Number((z1 + dz * 0.5 + nz * amp).toFixed(3)),
        ]);
      }
      edgeMidpointCache.set(key, mids);
    }

    const mids = edgeMidpointCache.get(key)!;
    if (mids.length === 0) return [];
    return isForward ? mids : [...mids].reverse();
  };

  // Track which pairs of Land Territories share a contiguous polygon border
  const contiguousLandPairs = new Set<string>();
  const neighborSets: Set<number>[] = Array.from(
    { length: numLand },
    () => new Set<number>()
  );

  const finalPolys: [number, number][][] = [];

  for (let i = 0; i < numLand; i++) {
    const edges = snappedPolys[i];
    const pts: [number, number][] = [];

    for (const e of edges) {
      const [sx, sz] = canonicalVertices[e.vStart];
      const [ex, ez] = canonicalVertices[e.vEnd];
      const segLen = Math.hypot(ex - sx, ez - sz);

      const isLandNeighbor =
        e.neighborSite >= 0 && e.neighborSite < numLand && segLen >= 0.45;
      if (isLandNeighbor) {
        const j = e.neighborSite;
        neighborSets[i].add(j);
        neighborSets[j].add(i);
        const pairKey = [landSeeds[i].id, landSeeds[j].id].sort().join('--');
        contiguousLandPairs.add(pairKey);
        landBorderSharedCount[pairKey] =
          (landBorderSharedCount[pairKey] ?? 0) + 1;
      }

      pts.push([sx, sz]);
      const subPts = getSubdividedEdgePoints(
        e.vStart,
        e.vEnd,
        !isLandNeighbor
      );
      for (const sp of subPts) {
        pts.push(sp);
      }
    }

    finalPolys.push(pts);
  }

  // 8. Generate Decorative Offshore Mini-Islands for ~9 Coastal Territories
  const territoryIslands: ([number, number][][] | undefined)[] = new Array(
    numLand
  ).fill(undefined);

  let islandsSpawned = 0;
  for (let i = 0; i < numLand && islandsSpawned < 10; i++) {
    if (rng() > 0.35) continue;
    const edges = snappedPolys[i];
    for (const e of edges) {
      if (e.neighborSite >= 0 && e.neighborSite < numLand) continue;
      const [x1, z1] = canonicalVertices[e.vStart];
      const [x2, z2] = canonicalVertices[e.vEnd];
      const segLen = Math.hypot(x2 - x1, z2 - z1);
      if (segLen < 2.6) continue;

      // Outward normal for clockwise polygon in (x right, z down) is (dz/len, -dx/len)
      const dx = x2 - x1;
      const dz = z2 - z1;
      const outX = dz / segLen;
      const outZ = -dx / segLen;
      const midX = (x1 + x2) * 0.5 + outX * 1.35;
      const midZ = (z1 + z2) * 0.5 + outZ * 1.35;

      if (Math.abs(midX) > 44.5 || Math.abs(midZ) > 22.5) continue;

      // Ensure the offshore mini-island is well clear of all other territories
      let clear = true;
      for (let j = 0; j < numLand; j++) {
        if (Math.hypot(midX - landSeeds[j].x, midZ - landSeeds[j].z) < 3.6) {
          clear = false;
          break;
        }
        const polyJ = finalPolys[j];
        for (let k = 0; k < polyJ.length; k++) {
          const pA = polyJ[k];
          const pB = polyJ[(k + 1) % polyJ.length];
          if (pointToSegmentDist(midX, midZ, pA[0], pA[1], pB[0], pB[1]) < 0.75) {
            clear = false;
            break;
          }
        }
        if (!clear) break;
      }

      if (clear) {
        const tx = dx / segLen;
        const tz = dz / segLen;
        const hw = 0.65;
        const hh = 0.36;
        const isl: [number, number][] = [
          [
            Number((midX - tx * hw - outX * hh).toFixed(2)),
            Number((midZ - tz * hw - outZ * hh).toFixed(2)),
          ],
          [
            Number((midX + tx * hw - outX * hh * 0.8).toFixed(2)),
            Number((midZ + tz * hw - outZ * hh * 0.8).toFixed(2)),
          ],
          [
            Number((midX + tx * hw * 0.85 + outX * hh).toFixed(2)),
            Number((midZ + tz * hw * 0.85 + outZ * hh).toFixed(2)),
          ],
          [
            Number((midX - tx * hw * 0.9 + outX * hh * 0.7).toFixed(2)),
            Number((midZ - tz * hw * 0.9 + outZ * hh * 0.7).toFixed(2)),
          ],
        ];
        territoryIslands[i] = [isl];
        islandsSpawned++;
        break;
      }
    }
  }

  // 9. Build Strategic Connectivity Graph (Intra-Continent + Cross-Strait + East-West Wrap)
  const seaCrossingKeys = new Set<string>();
  const wrapCrossingKeys = new Set<string>();

  const linkTerritories = (idxA: number, idxB: number, isWrap = false) => {
    if (idxA === idxB) return;
    neighborSets[idxA].add(idxB);
    neighborSets[idxB].add(idxA);
    const pairKey = [landSeeds[idxA].id, landSeeds[idxB].id].sort().join('--');
    if (!contiguousLandPairs.has(pairKey) || isWrap) {
      seaCrossingKeys.add(pairKey);
    }
    if (isWrap) {
      wrapCrossingKeys.add(pairKey);
    }
  };

  // 9a. Ensure every continent is 100% internally connected
  for (const spec of continentSpecs) {
    const memberIndices = landSeeds
      .filter((s) => s.continent === spec.id)
      .map((s) => s.index);

    // Find connected components inside this continent
    const getContinentComponents = (): number[][] => {
      const visited = new Set<number>();
      const comps: number[][] = [];
      for (const idx of memberIndices) {
        if (visited.has(idx)) continue;
        const comp: number[] = [];
        const q = [idx];
        visited.add(idx);
        while (q.length > 0) {
          const curr = q.shift()!;
          comp.push(curr);
          for (const nIdx of neighborSets[curr]) {
            if (
              landSeeds[nIdx].continent === spec.id &&
              !visited.has(nIdx)
            ) {
              visited.add(nIdx);
              q.push(nIdx);
            }
          }
        }
        comps.push(comp);
      }
      return comps;
    };

    let comps = getContinentComponents();
    while (comps.length > 1) {
      let bestU = comps[0][0];
      let bestV = comps[1][0];
      let bestDist = Infinity;
      for (const u of comps[0]) {
        for (let cIdx = 1; cIdx < comps.length; cIdx++) {
          for (const v of comps[cIdx]) {
            const d = Math.hypot(
              landSeeds[u].x - landSeeds[v].x,
              landSeeds[u].z - landSeeds[v].z
            );
            if (d < bestDist) {
              bestDist = d;
              bestU = u;
              bestV = v;
            }
          }
        }
      }
      linkTerritories(bestU, bestV);
      comps = getContinentComponents();
    }

    // Ensure no territory has < 2 neighbors within or near its continent
    for (const idx of memberIndices) {
      if (neighborSets[idx].size < 2) {
        let bestOther = -1;
        let bestDist = Infinity;
        for (const otherIdx of memberIndices) {
          if (otherIdx === idx || neighborSets[idx].has(otherIdx)) continue;
          const d = Math.hypot(
            landSeeds[idx].x - landSeeds[otherIdx].x,
            landSeeds[idx].z - landSeeds[otherIdx].z
          );
          if (d < bestDist) {
            bestDist = d;
            bestOther = otherIdx;
          }
        }
        if (bestOther >= 0) {
          linkTerritories(idx, bestOther);
        }
      }
    }
  }

  // 9b. Connect neighboring macro-slots across sea straits so all 6 continents form a tactical network
  const slotPairsToConnect: [number, number, number][] = [
    // [slotA, slotB, numConnections]
    [0, 1, 2], // NW <-> NC
    [1, 2, 2], // NC <-> NE
    [3, 4, 2], // SW <-> SC
    [4, 5, 1], // SC <-> SE
    [0, 3, 1], // NW <-> SW
    [1, 4, 2], // NC <-> SC
    [2, 5, 1], // NE <-> SE
  ];

  // Optional diagonal sea lane for tactical variety
  if (rng() < 0.5) {
    slotPairsToConnect.push([1, 3, 1]); // NC <-> SW
  } else {
    slotPairsToConnect.push([0, 4, 1]); // NW <-> SC
  }

  for (const [slotA, slotB, targetLinks] of slotPairsToConnect) {
    const groupA = landSeeds.filter((s) => s.slotIdx === slotA);
    const groupB = landSeeds.filter((s) => s.slotIdx === slotB);

    // Count existing links between slotA and slotB
    let existingLinks = 0;
    for (const a of groupA) {
      for (const b of groupB) {
        if (neighborSets[a.index].has(b.index)) {
          existingLinks++;
        }
      }
    }

    // Candidate pairs sorted by distance
    const candidates: { a: number; b: number; dist: number }[] = [];
    for (const a of groupA) {
      for (const b of groupB) {
        if (neighborSets[a.index].has(b.index)) continue;
        const dist = Math.hypot(a.x - b.x, a.z - b.z);
        candidates.push({ a: a.index, b: b.index, dist });
      }
    }
    candidates.sort((x, y) => x.dist - y.dist);

    const usedA = new Set<number>();
    const usedB = new Set<number>();
    for (const cand of candidates) {
      if (existingLinks >= targetLinks) break;
      if (usedA.has(cand.a) && usedB.has(cand.b)) continue;
      linkTerritories(cand.a, cand.b);
      usedA.add(cand.a);
      usedB.add(cand.b);
      existingLinks++;
    }
  }

  // 9c. East-West Wrap-Around Sea Crossing (connecting westernmost & easternmost edges like Alaska <-> Kamchatka)
  let bestWestIdx = 0;
  let bestEastIdx = 0;
  let bestWrapScore = Infinity;

  for (let i = 0; i < numLand; i++) {
    if (landSeeds[i].x > -28) continue;
    for (let j = 0; j < numLand; j++) {
      if (landSeeds[j].x < 28) continue;
      const score =
        (landSeeds[i].x - -42) * 1.4 +
        (42 - landSeeds[j].x) * 1.4 +
        Math.abs(landSeeds[i].z - landSeeds[j].z) * 0.85;
      if (score < bestWrapScore) {
        bestWrapScore = score;
        bestWestIdx = i;
        bestEastIdx = j;
      }
    }
  }
  linkTerritories(bestWestIdx, bestEastIdx, true);

  // 9d. Global BFS connectivity guarantee (in case any component is still isolated)
  const ensureGlobalConnectivity = () => {
    const visited = new Set<number>([0]);
    const q = [0];
    while (q.length > 0) {
      const curr = q.shift()!;
      for (const nIdx of neighborSets[curr]) {
        if (!visited.has(nIdx)) {
          visited.add(nIdx);
          q.push(nIdx);
        }
      }
    }
    if (visited.size === numLand) return;

    for (let i = 0; i < numLand; i++) {
      if (visited.has(i)) continue;
      let nearestInVisited = 0;
      let minDist = Infinity;
      for (const v of visited) {
        const d = Math.hypot(
          landSeeds[i].x - landSeeds[v].x,
          landSeeds[i].z - landSeeds[v].z
        );
        if (d < minDist) {
          minDist = d;
          nearestInVisited = v;
        }
      }
      linkTerritories(i, nearestInVisited);
      visited.add(i);
    }
  };
  ensureGlobalConnectivity();

  // 10. Assemble Final TerritoryDef Array
  const territories: TerritoryDef[] = landSeeds.map((seed, idx) => {
    const poly = finalPolys[idx];
    const center = computePolygonCentroid(poly);
    const neighbors = Array.from(neighborSets[idx]).map(
      (nIdx) => landSeeds[nIdx].id
    );

    return {
      id: seed.id,
      name: seed.name,
      continent: seed.continent,
      center,
      polygon: poly,
      islands: territoryIslands[idx],
      neighbors,
    };
  });

  return {
    worldName,
    seed,
    continents,
    territories,
    seaCrossingKeys,
    wrapCrossingKeys,
  };
}

