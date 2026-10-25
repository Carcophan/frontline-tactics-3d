import { generateRandomWorldMap } from './randomMapGenerator';

export type MapType = 'CLASSIC' | 'RANDOM';

export type ContinentId =
  | 'north_america'
  | 'south_america'
  | 'europe'
  | 'africa'
  | 'asia'
  | 'australia';

export interface ContinentDef {
  id: ContinentId;
  name: string;
  bonus: number;
  baseColor: number;
}

export interface TerritoryDef {
  id: string;
  name: string;
  continent: ContinentId;
  center: [number, number]; // [x, z] on the 3D board (-46..46, -24..26)
  polygon: [number, number][]; // Main landmass polygon in board coords [x, z]
  islands?: [number, number][][]; // Optional secondary islands (archipelagos, Tasmania, Ireland, etc.)
  neighbors: string[];
}

export const CLASSIC_CONTINENTS: Record<ContinentId, ContinentDef> = {
  north_america: {
    id: 'north_america',
    name: 'Nordamerika',
    bonus: 5,
    baseColor: 0xd9a441,
  },
  south_america: {
    id: 'south_america',
    name: 'Südamerika',
    bonus: 2,
    baseColor: 0xc95b4b,
  },
  europe: {
    id: 'europe',
    name: 'Europa',
    bonus: 5,
    baseColor: 0x4b7bc9,
  },
  africa: {
    id: 'africa',
    name: 'Afrika',
    bonus: 3,
    baseColor: 0xb57c4a,
  },
  asia: {
    id: 'asia',
    name: 'Asien',
    bonus: 7,
    baseColor: 0x5aa867,
  },
  australia: {
    id: 'australia',
    name: 'Australien',
    bonus: 2,
    baseColor: 0x9b5bc9,
  },
};

export const CONTINENTS: Record<ContinentId, ContinentDef> = {
  north_america: { ...CLASSIC_CONTINENTS.north_america },
  south_america: { ...CLASSIC_CONTINENTS.south_america },
  europe: { ...CLASSIC_CONTINENTS.europe },
  africa: { ...CLASSIC_CONTINENTS.africa },
  asia: { ...CLASSIC_CONTINENTS.asia },
  australia: { ...CLASSIC_CONTINENTS.australia },
};

/**
 * Computes the signed area of a 2D polygon in [x, z] coordinates.
 * Positive when vertices are ordered clockwise in (x right, z down).
 */
function signedArea(poly: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    area += x1 * z2 - x2 * z1;
  }
  return area * 0.5;
}

/**
 * Ensures a polygon is wound clockwise in [x, z] (where +x is East, +z is South),
 * and optionally offsets edges inward (positive inset) or outward (negative inset)
 * so neighboring territories sharing exact border coordinates have a uniform crisp border trench.
 */
export function offsetPolygon(
  rawPoly: [number, number][],
  insetAmount: number
): [number, number][] {
  if (rawPoly.length < 3) return rawPoly;
  const poly =
    signedArea(rawPoly) < 0 ? [...rawPoly].reverse() : [...rawPoly];
  if (Math.abs(insetAmount) < 1e-5) return poly;

  const n = poly.length;
  const normals: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    // Inward unit normal for clockwise polygon in (x right, z down) is (-dz/len, dx/len)
    normals.push([-dz / len, dx / len]);
  }

  const result: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [nPrevX, nPrevZ] = normals[(i - 1 + n) % n];
    const [nCurrX, nCurrZ] = normals[i];
    let mx = nPrevX + nCurrX;
    let mz = nPrevZ + nCurrZ;
    const mLen = Math.hypot(mx, mz);
    if (mLen < 1e-4) {
      mx = nCurrX;
      mz = nCurrZ;
    } else {
      mx /= mLen;
      mz /= mLen;
    }
    const dot = mx * nCurrX + mz * nCurrZ;
    // Clamp miter multiplier so sharp peninsulas don't spike
    const miterScale = Math.min(1.85, 1 / Math.max(0.45, dot));
    const [px, pz] = poly[i];
    result.push([
      Number((px + mx * insetAmount * miterScale).toFixed(3)),
      Number((pz + mz * insetAmount * miterScale).toFixed(3)),
    ]);
  }

  return result;
}

/**
 * Maritime / Strait crossings where a dotted sea-lane line should be drawn.
 * Contiguous land borders touch directly and do not need sea-lane lines.
 */
const CLASSIC_SEA_CROSSING_KEYS = [
  'alaska--kamchatka',
  'greenland--nw_territory',
  'greenland--ontario',
  'greenland--quebec',
  'greenland--iceland',
  'great_britain--iceland',
  'iceland--scandinavia',
  'great_britain--scandinavia',
  'great_britain--northern_europe',
  'great_britain--western_europe',
  'northern_europe--scandinavia',
  'brazil--north_africa',
  'north_africa--western_europe',
  'north_africa--southern_europe',
  'egypt--southern_europe',
  'middle_east--southern_europe',
  'east_africa--middle_east',
  'east_africa--madagascar',
  'madagascar--south_africa',
  'japan--kamchatka',
  'japan--mongolia',
  'indonesia--siam',
  'indonesia--new_guinea',
  'indonesia--western_australia',
  'new_guinea--western_australia',
  'eastern_australia--new_guinea',
];

const SEA_CROSSING_KEYS = new Set<string>(CLASSIC_SEA_CROSSING_KEYS);
const WRAP_CROSSING_KEYS = new Set<string>(['alaska--kamchatka']);

export function isMaritimeConnection(idA: string, idB: string): boolean {
  const key = [idA, idB].sort().join('--');
  return SEA_CROSSING_KEYS.has(key);
}

export function isWrapAroundConnection(idA: string, idB: string): boolean {
  const key = [idA, idB].sort().join('--');
  return WRAP_CROSSING_KEYS.has(key);
}

export const CLASSIC_TERRITORIES: TerritoryDef[] = [
  // =========================================================================
  // NORTH AMERICA (9 Territories)
  // Geographically accurate silhouettes: Alaska Peninsula, Mackenzie/Arctic
  // Archipelago, Hudson Bay indentation, Greenland wedge, Labrador/Nova Scotia,
  // Great Lakes, Florida Peninsula, Baja California, Yucatan & Panama Isthmus.
  // =========================================================================
  {
    id: 'alaska',
    name: 'Alaska',
    continent: 'north_america',
    center: [-41.2, -16.2],
    polygon: [
      [-44.5, -18.8], // Point Barrow / Chukchi coast
      [-40.5, -19.5], // Prudhoe Bay / Beaufort Sea
      [-36.8, -19.0], // Border with NW Territory (North)
      [-36.5, -14.2], // Border with NW Territory / Alberta corner
      [-35.2, -12.0], // Southeast Alaska Panhandle (Juneau)
      [-36.5, -11.8], // Sitka / Alexander Archipelago
      [-38.5, -13.6], // Gulf of Alaska (Anchorage)
      [-41.2, -14.2], // Kodiak / Cook Inlet
      [-44.8, -12.4], // Aleutian / Alaska Peninsula tip
      [-45.5, -13.2], // Bristol Bay
      [-44.0, -14.6], // Yukon-Kuskokwim Delta
      [-46.2, -16.4], // Seward Peninsula (Bering Strait facing Kamchatka)
      [-44.2, -17.3], // Kotzebue Sound
    ],
    neighbors: ['nw_territory', 'alberta', 'kamchatka'],
  },
  {
    id: 'nw_territory',
    name: 'Nordwest-Territorium',
    continent: 'north_america',
    center: [-31.5, -16.5],
    polygon: [
      [-36.8, -19.0], // Shared with Alaska (North)
      [-33.5, -19.6], // Mackenzie Delta / Tuktoyaktuk
      [-30.0, -19.2], // Amundsen Gulf
      [-26.2, -19.8], // Boothia Peninsula (Arctic North)
      [-24.5, -18.2], // Melville Peninsula
      [-25.5, -16.2], // Northwest Hudson Bay (Chesterfield Inlet)
      [-26.8, -14.5], // Hudson Bay West coast (Churchill)
      [-29.8, -14.2], // Border with Ontario / Alberta corner
      [-36.5, -14.2], // Shared with Alaska / Alberta
    ],
    islands: [
      // Victoria & Banks Island
      [
        [-33.2, -22.2],
        [-28.0, -22.4],
        [-27.5, -20.5],
        [-32.8, -20.4],
      ],
      // Baffin Island (stretching toward Greenland)
      [
        [-26.0, -23.0],
        [-21.2, -21.5],
        [-20.5, -18.2],
        [-23.2, -17.8],
        [-25.8, -20.8],
      ],
    ],
    neighbors: ['alaska', 'alberta', 'ontario', 'greenland'],
  },
  {
    id: 'greenland',
    name: 'Grönland',
    continent: 'north_america',
    center: [-15.8, -19.5],
    polygon: [
      [-19.5, -23.4], // Nares Strait / NW Greenland
      [-15.0, -24.2], // Peary Land (Northernmost tip)
      [-11.2, -23.0], // Northeast Greenland National Park
      [-11.8, -20.2], // King Christian X Land
      [-12.2, -18.0], // Scoresby Sund (facing Iceland)
      [-14.2, -16.2], // Ammassalik / Southeast coast
      [-16.5, -14.2], // Cape Farewell (Southern tip)
      [-18.4, -15.8], // Nuuk / Southwest coast
      [-19.2, -18.5], // Disko Bay / Baffin Bay coast
      [-21.0, -21.2], // Thule / Qaanaaq
    ],
    neighbors: ['nw_territory', 'ontario', 'quebec', 'iceland'],
  },
  {
    id: 'alberta',
    name: 'Alberta',
    continent: 'north_america',
    center: [-33.2, -11.2],
    polygon: [
      [-36.5, -14.2], // Shared with Alaska & NW Territory
      [-29.8, -14.2], // Shared with NW Territory & Ontario
      [-29.5, -8.5], // Shared with Ontario & Western US (49th parallel)
      [-36.8, -8.5], // Shared with Western US (Vancouver / Washington border)
      [-37.5, -10.2], // Vancouver Island / BC Pacific coast
      [-35.2, -12.0], // Shared with Alaska Panhandle
    ],
    neighbors: ['alaska', 'nw_territory', 'ontario', 'western_us'],
  },
  {
    id: 'ontario',
    name: 'Ontario',
    continent: 'north_america',
    center: [-26.2, -10.8],
    polygon: [
      [-29.8, -14.2], // Shared with NW Territory & Alberta
      [-26.8, -14.5], // Hudson Bay SW shore (Churchill)
      [-24.5, -13.5], // Hudson Bay South shore (Winisk)
      [-22.8, -11.6], // James Bay South tip
      [-22.2, -7.8], // Shared with Quebec & Eastern US (St. Lawrence / Lake Ontario)
      [-24.5, -8.4], // Lake Erie / Lake Huron curve
      [-26.8, -8.5], // Lake Superior / Michigan border
      [-29.5, -8.5], // Shared with Alberta & Western US
    ],
    neighbors: [
      'nw_territory',
      'alberta',
      'quebec',
      'greenland',
      'western_us',
      'eastern_us',
    ],
  },
  {
    id: 'quebec',
    name: 'Quebec',
    continent: 'north_america',
    center: [-19.0, -10.8],
    polygon: [
      [-22.5, -15.5], // Cape Wolstenholme (Hudson Strait)
      [-20.2, -14.8], // Ungava Bay
      [-18.5, -15.6], // Torngat / Northern Labrador
      [-15.4, -12.2], // Cartwright / Belle Isle (Labrador East tip)
      [-17.5, -10.6], // Gulf of St. Lawrence North shore
      [-15.8, -8.8], // Nova Scotia / Cape Breton peninsula
      [-17.2, -7.2], // Halifax / Bay of Fundy
      [-18.8, -7.2], // Shared with Eastern US (Maine border)
      [-22.2, -7.8], // Shared with Eastern US & Ontario
      [-22.8, -11.6], // Shared with Ontario (James Bay)
      [-23.2, -13.6], // Hudson Bay East coast (Inukjuak)
    ],
    islands: [
      // Newfoundland Island
      [
        [-15.2, -11.2],
        [-13.4, -10.8],
        [-13.6, -9.2],
        [-15.4, -9.6],
      ],
    ],
    neighbors: ['ontario', 'greenland', 'eastern_us'],
  },
  {
    id: 'western_us',
    name: 'Weststaaten',
    continent: 'north_america',
    center: [-32.2, -5.2],
    polygon: [
      [-36.8, -8.5], // Shared with Alberta (Pacific NW)
      [-29.5, -8.5], // Shared with Alberta & Ontario
      [-26.8, -8.5], // Shared with Ontario & Eastern US
      [-27.5, -5.2], // Mississippi / Missouri river line
      [-28.0, -1.8], // Shared with Eastern US & Central America (Rio Grande)
      [-31.2, -2.2], // Chihuahua / Arizona border
      [-34.2, -2.0], // San Diego / Tijuana border
      [-35.8, -3.8], // Point Conception / Los Angeles
      [-37.0, -5.8], // San Francisco Bay / Cape Mendocino
      [-37.2, -7.2], // Oregon coast
    ],
    neighbors: ['alberta', 'ontario', 'eastern_us', 'central_america'],
  },
  {
    id: 'eastern_us',
    name: 'Oststaaten',
    continent: 'north_america',
    center: [-23.8, -4.8],
    polygon: [
      [-26.8, -8.5], // Shared with Ontario & Western US
      [-24.5, -8.4], // Shared with Ontario (Great Lakes)
      [-22.2, -7.8], // Shared with Ontario & Quebec
      [-18.8, -7.2], // Shared with Quebec (Maine)
      [-18.2, -6.0], // Cape Cod / Boston
      [-19.8, -4.8], // New York / Chesapeake Bay
      [-19.6, -3.5], // Cape Hatteras (Outer Banks)
      [-21.4, -2.0], // Charleston / Savannah
      [-21.0, 0.8], // Florida Peninsula East coast (Miami)
      [-21.8, 1.5], // Florida Keys / Key West
      [-22.5, 0.4], // Florida West coast (Tampa)
      [-23.2, -1.0], // Florida Panhandle (Apalachicola)
      [-25.2, -1.2], // Mississippi Delta (New Orleans)
      [-26.5, -1.5], // Texas Gulf Coast (Galveston / Corpus Christi)
      [-28.0, -1.8], // Shared with Central America & Western US
      [-27.5, -5.2], // Shared with Western US
    ],
    neighbors: ['ontario', 'quebec', 'western_us', 'central_america'],
  },
  {
    id: 'central_america',
    name: 'Mittelamerika',
    continent: 'north_america',
    center: [-28.8, 1.8],
    polygon: [
      [-34.2, -2.0], // Shared with Western US (Baja North)
      [-31.2, -2.2], // Shared with Western US
      [-28.0, -1.8], // Shared with Western US & Eastern US
      [-26.5, -1.5], // Shared with Eastern US (Brownsville)
      [-26.2, 0.8], // Tampico / Veracruz (Bay of Campeche)
      [-24.8, 1.4], // Campeche
      [-23.2, 0.5], // Yucatán Peninsula tip (Cancún)
      [-23.6, 2.5], // Belize / Gulf of Honduras
      [-22.2, 3.2], // Cape Gracias a Dios (Honduras/Nicaragua bulge)
      [-22.8, 4.8], // Costa Rica / Panama Canal North
      [-21.5, 5.5], // Shared with Venezuela (Darién Gap North)
      [-22.2, 6.4], // Shared with Venezuela (Darién Gap South)
      [-24.2, 5.2], // Panama / Costa Rica Pacific coast
      [-26.2, 3.5], // Guatemala / Chiapas coast
      [-29.2, 2.2], // Acapulco / Michoacán coast
      [-31.0, 0.6], // Cabo Corrientes (Jalisco)
      [-31.8, -1.0], // Gulf of California interior (Sonora)
      [-32.5, 0.5], // Baja California Sur tip (Cabo San Lucas)
      [-34.0, -0.8], // Baja California Pacific coast
    ],
    islands: [
      // Cuba (Caribbean Sea)
      [
        [-22.2, 2.0],
        [-18.2, 2.6],
        [-18.5, 3.4],
        [-22.4, 2.7],
      ],
    ],
    neighbors: ['western_us', 'eastern_us', 'venezuela'],
  },

  // =========================================================================
  // SOUTH AMERICA (4 Territories)
  // Geographically accurate silhouettes: Colombia/Venezuela Caribbean coast,
  // Orinoco/Guianas, Amazon & Brazilian Atlantic bulge (Cape São Roque),
  // Andean bend at Arica, and Patagonia tapering to Tierra del Fuego / Cape Horn.
  // =========================================================================
  {
    id: 'venezuela',
    name: 'Venezuela',
    continent: 'south_america',
    center: [-20.2, 7.6],
    polygon: [
      [-21.5, 5.5], // Shared with Central America (Panama Isthmus)
      [-19.8, 4.8], // Cartagena / Barranquilla
      [-18.5, 5.2], // Gulf of Venezuela / Maracaibo
      [-16.2, 5.8], // Caracas / Trinidad
      [-14.8, 7.2], // Orinoco Delta / Guyana coast
      [-16.8, 9.2], // Shared with Brazil (Roraima / Rio Negro)
      [-20.5, 9.5], // Shared with Brazil & Peru (Amazon headwaters)
      [-23.2, 9.2], // Shared with Peru (Ecuador border)
      [-22.8, 7.5], // Buenaventura (Colombia Pacific coast)
      [-22.2, 6.4], // Shared with Central America
    ],
    neighbors: ['central_america', 'peru', 'brazil'],
  },
  {
    id: 'peru',
    name: 'Peru',
    continent: 'south_america',
    center: [-21.8, 13.2],
    polygon: [
      [-23.2, 9.2], // Shared with Venezuela (Ecuador)
      [-20.5, 9.5], // Shared with Venezuela & Brazil
      [-18.8, 12.2], // Shared with Brazil (Acre / Rondônia)
      [-18.2, 15.8], // Shared with Brazil & Argentina (Bolivia / Chaco)
      [-21.4, 16.5], // Shared with Argentina (Arica / Atacama bend)
      [-23.2, 14.2], // Lima / Callao coast
      [-24.5, 11.2], // Piura / Talara (Westernmost point of South America)
      [-23.8, 9.8], // Gulf of Guayaquil
    ],
    neighbors: ['venezuela', 'brazil', 'argentina'],
  },
  {
    id: 'brazil',
    name: 'Brasilien',
    continent: 'south_america',
    center: [-15.2, 12.8],
    polygon: [
      [-16.8, 9.2], // Shared with Venezuela
      [-14.8, 7.2], // Shared with Venezuela (Guyana/French Guiana)
      [-13.2, 8.5], // Amazon River Mouth (Belém / Marajó)
      [-10.5, 9.8], // Fortaleza
      [-9.2, 11.2], // Cape São Roque / Natal (Easternmost bulge facing Africa)
      [-9.8, 13.2], // Recife / Salvador da Bahia
      [-11.8, 16.2], // Rio de Janeiro / Cabo Frio
      [-13.8, 17.5], // Santos / Santa Catarina
      [-15.2, 18.8], // Shared with Argentina (Uruguay / Rio Grande do Sul)
      [-17.2, 17.5], // Shared with Argentina (Paraná / Iguazu)
      [-18.2, 15.8], // Shared with Peru & Argentina
      [-18.8, 12.2], // Shared with Peru
      [-20.5, 9.5], // Shared with Peru & Venezuela
    ],
    neighbors: ['venezuela', 'peru', 'argentina', 'north_africa'],
  },
  {
    id: 'argentina',
    name: 'Argentinien',
    continent: 'south_america',
    center: [-18.8, 20.2],
    polygon: [
      [-21.4, 16.5], // Shared with Peru (Atacama)
      [-18.2, 15.8], // Shared with Peru & Brazil
      [-17.2, 17.5], // Shared with Brazil
      [-15.2, 18.8], // Shared with Brazil (Montevideo / Río de la Plata)
      [-15.8, 20.5], // Mar del Plata / Bahía Blanca
      [-17.4, 22.2], // Valdés Peninsula / Golfo San Jorge
      [-18.5, 24.2], // Río Gallegos (Santa Cruz)
      [-17.8, 25.6], // Tierra del Fuego / Cape Horn (Southern tip)
      [-19.8, 25.2], // Chilean Fjords / Magallanes
      [-20.8, 22.8], // Chiloé / Puerto Montt
      [-21.2, 19.5], // Valparaíso / Santiago coast
    ],
    islands: [
      // Falkland Islands (Malvinas)
      [
        [-16.2, 24.0],
        [-14.8, 24.0],
        [-14.8, 24.8],
        [-16.2, 24.8],
      ],
    ],
    neighbors: ['peru', 'brazil'],
  },

  // =========================================================================
  // EUROPE (7 Territories)
  // Geographically accurate silhouettes: Iceland, British Isles (GB + Ireland),
  // Fennoscandian Peninsula + Baltic Sea, Iberian Peninsula, Jutland/Central
  // Europe, Italian Boot + Balkan/Greek Peninsula, and Eastern European Plain.
  // =========================================================================
  {
    id: 'iceland',
    name: 'Island',
    continent: 'europe',
    center: [-9.2, -16.8],
    polygon: [
      [-11.2, -17.6], // Westfjords
      [-8.8, -17.8], // Akureyri / North coast
      [-7.0, -17.2], // Eastfjords
      [-7.4, -15.8], // Vatnajökull / Southeast coast
      [-9.5, -15.6], // Vik / South coast
      [-11.0, -16.2], // Reykjanes / Reykjavik
    ],
    neighbors: ['greenland', 'great_britain', 'scandinavia'],
  },
  {
    id: 'great_britain',
    name: 'Großbritannien',
    continent: 'europe',
    center: [-6.8, -10.2],
    polygon: [
      [-7.2, -13.2], // Scottish Highlands / Thurso
      [-5.6, -12.6], // Aberdeen
      [-6.0, -11.2], // Edinburgh / Newcastle
      [-5.0, -9.8], // East Anglia (Norfolk)
      [-5.2, -8.8], // Dover / Kent
      [-7.8, -9.2], // Cornwall / Land's End
      [-7.4, -10.2], // Wales (Pembrokeshire)
      [-7.6, -11.8], // Hebrides / Glasgow
    ],
    islands: [
      // Ireland
      [
        [-9.8, -11.4],
        [-8.2, -11.4],
        [-8.2, -9.6],
        [-9.9, -9.8],
      ],
    ],
    neighbors: ['iceland', 'scandinavia', 'northern_europe', 'western_europe'],
  },
  {
    id: 'scandinavia',
    name: 'Skandinavien',
    continent: 'europe',
    center: [-0.2, -15.5],
    polygon: [
      [-3.8, -14.2], // Bergen (Western Norway fjords)
      [-1.5, -17.5], // Trondheim / Lofoten
      [1.2, -19.8], // North Cape (Finnmark)
      [3.5, -19.5], // Shared with Ukraine (Varanger / Pechenga)
      [3.8, -13.5], // Shared with Ukraine (Karelia / Vyborg)
      [1.8, -13.5], // Helsinki (Gulf of Finland)
      [1.2, -14.8], // Turku / Gulf of Bothnia East
      [0.4, -16.2], // Bothnian Bay head (Oulu/Luleå)
      [0.2, -14.5], // Stockholm / East Sweden
      [-0.4, -12.0], // Scania / Malmö (Southern tip of Sweden)
      [-1.6, -12.5], // Gothenburg / Kattegat
      [-2.0, -13.5], // Oslo Fjord
      [-3.5, -12.8], // Stavanger / Kristiansand
    ],
    neighbors: ['iceland', 'great_britain', 'northern_europe', 'ukraine'],
  },
  {
    id: 'western_europe',
    name: 'Westeuropa',
    continent: 'europe',
    center: [-6.2, -4.2],
    polygon: [
      [-4.2, -7.8], // Shared with Northern Europe (Belgium / Rhine mouth)
      [-3.2, -5.2], // Shared with Northern Europe & Southern Europe (Switzerland/Alps)
      [-3.0, -3.5], // Shared with Southern Europe (Nice / Monaco)
      [-4.6, -3.4], // Gulf of Lion (Marseille)
      [-5.2, -2.0], // Barcelona / Valencia
      [-6.8, -0.8], // Strait of Gibraltar / Tarifa (facing North Africa)
      [-9.2, -1.2], // Cape St. Vincent (Algarve, Portugal)
      [-9.5, -3.2], // Lisbon / Porto
      [-9.2, -4.6], // Cape Finisterre (Galicia, NW Spain)
      [-5.2, -4.6], // Bay of Biscay (Bordeaux / Bilbao)
      [-7.2, -6.2], // Brittany Peninsula (Brest)
      [-5.6, -7.2], // Normandy / Cherbourg (English Channel)
    ],
    neighbors: [
      'great_britain',
      'northern_europe',
      'southern_europe',
      'north_africa',
    ],
  },
  {
    id: 'northern_europe',
    name: 'Mitteleuropa',
    continent: 'europe',
    center: [-0.4, -7.6],
    polygon: [
      [-4.2, -7.8], // Shared with Western Europe (Netherlands)
      [-2.4, -8.8], // German Bight (Hamburg)
      [-2.2, -11.0], // Jutland Peninsula tip (Skagen, Denmark)
      [-1.0, -9.6], // Kiel / Lübeck
      [1.2, -9.5], // Pomeranian Bay (Szczecin)
      [3.2, -9.8], // Shared with Ukraine (Gdansk / Kaliningrad)
      [3.4, -5.2], // Shared with Ukraine & Southern Europe (Carpathians)
      [-3.2, -5.2], // Shared with Southern Europe & Western Europe (Alps)
    ],
    neighbors: [
      'great_britain',
      'scandinavia',
      'ukraine',
      'southern_europe',
      'western_europe',
    ],
  },
  {
    id: 'southern_europe',
    name: 'Südeuropa',
    continent: 'europe',
    center: [0.8, -3.4],
    polygon: [
      [-3.2, -5.2], // Shared with Western & Northern Europe
      [3.4, -5.2], // Shared with Northern Europe & Ukraine
      [5.5, -4.8], // Shared with Ukraine (Danube Delta / Constanța)
      [5.2, -2.6], // Bosporus / Istanbul (facing Middle East)
      [3.6, -2.6], // Aegean North coast (Thessaloniki)
      [3.2, -0.4], // Greek Peloponnese / Athens
      [1.8, -1.8], // Albania / Corfu
      [0.4, -3.8], // Head of Adriatic Sea (Venice / Trieste)
      [1.5, -1.2], // Apulia (Heel of Italian Boot)
      [0.4, -0.4], // Calabria (Toe of Italian Boot)
      [-0.8, -1.8], // Naples / Rome
      [-2.2, -3.5], // Genoa (Ligurian Sea)
      [-3.0, -3.5], // Shared with Western Europe
    ],
    islands: [
      // Sicily
      [
        [-0.8, -0.6],
        [0.2, -0.4],
        [0.0, 0.2],
        [-0.8, 0.0],
      ],
    ],
    neighbors: [
      'western_europe',
      'northern_europe',
      'ukraine',
      'middle_east',
      'egypt',
      'north_africa',
    ],
  },
  {
    id: 'ukraine',
    name: 'Osteuropa',
    continent: 'europe',
    center: [7.2, -10.5],
    polygon: [
      [3.5, -19.5], // Shared with Scandinavia (Barents Sea / Murmansk)
      [6.5, -19.2], // Kola Peninsula East
      [5.8, -17.2], // White Sea (Arkhangelsk)
      [8.5, -18.8], // Kanin / Pechora Sea
      [11.2, -19.2], // Shared with Ural (Kara Gate / Arctic Ural)
      [11.5, -7.5], // Shared with Ural & Afghanistan (Ural River / Caspian North)
      [10.2, -4.2], // Shared with Afghanistan & Middle East (Caucasus / Baku)
      [7.5, -4.2], // Shared with Middle East (Georgia / Black Sea East)
      [6.8, -5.2], // Crimea / Sea of Azov
      [5.5, -4.8], // Shared with Southern Europe (Odessa / Danube)
      [3.4, -5.2], // Shared with Southern & Northern Europe
      [3.2, -9.8], // Shared with Northern Europe (Baltic)
      [2.8, -11.8], // Riga / Estonia coast
      [3.8, -13.5], // Shared with Scandinavia (St. Petersburg / Karelia)
    ],
    neighbors: [
      'scandinavia',
      'northern_europe',
      'southern_europe',
      'ural',
      'afghanistan',
      'middle_east',
    ],
  },

  // =========================================================================
  // AFRICA (6 Territories)
  // Geographically accurate silhouettes: West African bulge (Dakar to Gulf of
  // Guinea), Nile/Sinai connection, Somali Horn of Africa, Congo basin,
  // Cape of Good Hope, and Madagascar Island.
  // =========================================================================
  {
    id: 'north_africa',
    name: 'Nordwestafrika',
    continent: 'africa',
    center: [-4.2, 5.5],
    polygon: [
      [-6.8, 0.8], // Tangier / Morocco (facing Gibraltar)
      [-2.8, 0.8], // Algiers
      [-1.2, 1.0], // Tunis / Cape Bon (facing Sicily)
      [-0.5, 2.2], // Shared with Egypt (Gulf of Sidra / Cyrenaica)
      [0.5, 7.5], // Shared with Egypt & East Africa (Chad / Darfur border)
      [1.8, 9.2], // Shared with East Africa & Congo (Central African border)
      [-0.2, 9.5], // Shared with Congo (Cameroon / Gulf of Guinea corner)
      [-2.5, 9.2], // Lagos / Niger Delta
      [-5.8, 9.8], // Ivory Coast / Cape Palmas (Liberia)
      [-8.5, 8.2], // Freetown / Conakry
      [-9.6, 5.8], // Dakar / Cap-Vert (Westernmost tip facing Brazil)
      [-8.8, 3.2], // Nouakchott / Western Sahara
    ],
    neighbors: [
      'brazil',
      'western_europe',
      'southern_europe',
      'egypt',
      'east_africa',
      'congo',
    ],
  },
  {
    id: 'egypt',
    name: 'Ägypten',
    continent: 'africa',
    center: [2.8, 4.8],
    polygon: [
      [-0.5, 2.2], // Shared with North Africa (Cyrenaica)
      [1.8, 1.8], // Tobruk / Alexandria
      [3.8, 2.0], // Nile Delta (Port Said)
      [5.4, 2.2], // Shared with Middle East (Sinai North / Gaza)
      [5.8, 3.5], // Shared with Middle East (Gulf of Suez / Aqaba)
      [6.8, 7.5], // Shared with East Africa (Red Sea coast / Port Sudan)
      [0.5, 7.5], // Shared with East Africa & North Africa
    ],
    neighbors: ['southern_europe', 'middle_east', 'east_africa', 'north_africa'],
  },
  {
    id: 'east_africa',
    name: 'Ostafrika',
    continent: 'africa',
    center: [6.2, 11.5],
    polygon: [
      [0.5, 7.5], // Shared with North Africa & Egypt
      [6.8, 7.5], // Shared with Egypt (Red Sea)
      [8.2, 8.5], // Djibouti / Bab el-Mandeb (facing Yemen in Middle East)
      [11.8, 8.6], // Cape Guardafui (Tip of the Horn of Africa / Somalia)
      [10.2, 11.5], // Mogadishu
      [7.8, 13.8], // Mombasa / Dar es Salaam
      [7.2, 16.5], // Shared with South Africa (Mozambique coast)
      [3.8, 16.2], // Shared with South Africa & Congo (Zambezi / Malawi)
      [1.8, 9.2], // Shared with Congo & North Africa
    ],
    neighbors: [
      'egypt',
      'middle_east',
      'north_africa',
      'congo',
      'south_africa',
      'madagascar',
    ],
  },
  {
    id: 'congo',
    name: 'Kongo',
    continent: 'africa',
    center: [1.5, 12.8],
    polygon: [
      [-0.2, 9.5], // Shared with North Africa (Douala / Bight of Biafra)
      [1.8, 9.2], // Shared with North Africa & East Africa
      [3.8, 16.2], // Shared with East Africa & South Africa
      [0.2, 16.2], // Shared with South Africa (Cunene / Angola-Namibia border)
      [0.0, 13.5], // Luanda / Congo River mouth
      [-0.8, 11.5], // Libreville / Cape Lopez (Gabon)
    ],
    neighbors: ['north_africa', 'east_africa', 'south_africa'],
  },
  {
    id: 'south_africa',
    name: 'Südafrika',
    continent: 'africa',
    center: [3.2, 19.5],
    polygon: [
      [0.2, 16.2], // Shared with Congo (Namibia North)
      [3.8, 16.2], // Shared with Congo & East Africa
      [7.2, 16.5], // Shared with East Africa (Beira, Mozambique)
      [6.4, 19.2], // Maputo / Delagoa Bay
      [5.5, 21.5], // Durban (KwaZulu-Natal)
      [3.8, 23.4], // Port Elizabeth
      [2.0, 24.0], // Cape Agulhas / Cape of Good Hope
      [1.2, 22.0], // Namaqualand
      [0.5, 19.2], // Walvis Bay (Namibia coast)
    ],
    neighbors: ['congo', 'east_africa', 'madagascar'],
  },
  {
    id: 'madagascar',
    name: 'Madagaskar',
    continent: 'africa',
    center: [10.0, 19.2],
    polygon: [
      [10.6, 15.8], // Antsiranana (Northern tip)
      [11.4, 17.5], // Antongil Bay (Northeast)
      [10.2, 22.0], // Tolagnaro (Southeast tip)
      [8.8, 21.8], // Toliara (Southwest)
      [8.6, 18.8], // Morondava (Mozambique Channel coast)
      [9.4, 16.8], // Mahajanga (Northwest)
    ],
    neighbors: ['east_africa', 'south_africa'],
  },

  // =========================================================================
  // ASIA (12 Territories)
  // Geographically accurate silhouettes: Ural corridor, Taymyr Peninsula in
  // Siberia, Yakutsk Arctic coast, Chukotka & Kamchatka Peninsula + Sea of
  // Okhotsk, Baikal/Irkutsk, Mongolia/Manchuria, Japanese Archipelago,
  // Anatolia + Arabian Peninsula, Iranian/Afghan plateau, Indian Subcontinent
  // + Sri Lanka, China coast, and Indochina + Malay Peninsula.
  // =========================================================================
  {
    id: 'ural',
    name: 'Ural',
    continent: 'asia',
    center: [14.8, -13.2],
    polygon: [
      [11.2, -19.2], // Shared with Ukraine (Kara Gate)
      [13.8, -19.8], // Yamal Peninsula
      [15.2, -17.8], // Gulf of Ob indentation
      [18.0, -19.5], // Shared with Siberia (Gydan / Yenisei Gulf)
      [18.0, -9.0], // Shared with Siberia & China (Altai / Irtysh)
      [16.5, -7.5], // Shared with China & Afghanistan (Dzungaria / Balkhash)
      [11.5, -7.5], // Shared with Afghanistan & Ukraine (Caspian / Ural River)
    ],
    neighbors: ['ukraine', 'siberia', 'china', 'afghanistan'],
  },
  {
    id: 'siberia',
    name: 'Sibirien',
    continent: 'asia',
    center: [21.5, -14.5],
    polygon: [
      [18.0, -19.5], // Shared with Ural
      [20.8, -21.2], // Taymyr Peninsula / Cape Chelyuskin (Northernmost Asia!)
      [23.8, -20.5], // Khatanga Gulf
      [25.5, -19.8], // Shared with Yakutsk (Lena Delta West)
      [25.0, -14.0], // Shared with Yakutsk & Irkutsk
      [24.2, -9.8], // Shared with Irkutsk & Mongolia (Lake Baikal South)
      [21.0, -8.8], // Shared with Mongolia & China (Tuva / Altai)
      [18.0, -9.0], // Shared with China & Ural
    ],
    neighbors: ['ural', 'yakutsk', 'irkutsk', 'mongolia', 'china'],
  },
  {
    id: 'yakutsk',
    name: 'Jakutien',
    continent: 'asia',
    center: [29.8, -16.8],
    polygon: [
      [25.5, -19.8], // Shared with Siberia
      [28.5, -20.4], // Lena Delta / Laptev Sea
      [31.8, -19.8], // Indigirka / East Siberian Sea
      [34.8, -19.4], // Shared with Kamchatka (Kolyma mouth)
      [33.8, -14.0], // Shared with Kamchatka & Irkutsk (Stanovoy Range)
      [25.0, -14.0], // Shared with Irkutsk & Siberia
    ],
    islands: [
      // New Siberian Islands
      [
        [29.2, -22.0],
        [32.0, -21.8],
        [31.8, -20.8],
        [29.0, -21.0],
      ],
    ],
    neighbors: ['siberia', 'irkutsk', 'kamchatka'],
  },
  {
    id: 'irkutsk',
    name: 'Irkutsk',
    continent: 'asia',
    center: [29.0, -11.8],
    polygon: [
      [25.0, -14.0], // Shared with Siberia & Yakutsk
      [33.8, -14.0], // Shared with Yakutsk & Kamchatka
      [33.0, -9.8], // Shared with Kamchatka & Mongolia (Amur River)
      [24.2, -9.8], // Shared with Mongolia & Siberia
    ],
    neighbors: ['siberia', 'yakutsk', 'kamchatka', 'mongolia'],
  },
  {
    id: 'kamchatka',
    name: 'Kamtschatka',
    continent: 'asia',
    center: [38.2, -15.5],
    polygon: [
      [34.8, -19.4], // Shared with Yakutsk
      [39.5, -19.2], // Chaunskaya Bay / Chukotka North
      [44.2, -17.8], // Cape Dezhnev (Chukotka East tip facing Alaska!)
      [45.2, -16.2], // Bering Strait / Anadyrski Liman
      [42.0, -15.2], // Koryak coast
      [41.8, -12.0], // Kamchatka Peninsula East coast (Petropavlovsk)
      [39.8, -9.5], // Cape Lopatka (Southern tip of Kamchatka Peninsula!)
      [39.2, -12.5], // Kamchatka West coast (Sea of Okhotsk)
      [39.8, -14.8], // Shelikhov Gulf (Head of Sea of Okhotsk)
      [36.5, -14.2], // Magadan / Okhotsk coast
      [35.2, -11.5], // Shantar / Nikolayevsk-on-Amur
      [35.5, -8.5], // Sikhote-Alin / Tartary Strait
      [33.8, -8.2], // Shared with Mongolia (Vladivostok / Primorye border)
      [33.0, -9.8], // Shared with Mongolia & Irkutsk
      [33.8, -14.0], // Shared with Irkutsk & Yakutsk
    ],
    neighbors: ['yakutsk', 'irkutsk', 'mongolia', 'japan', 'alaska'],
  },
  {
    id: 'mongolia',
    name: 'Mongolei',
    continent: 'asia',
    center: [28.2, -7.2],
    polygon: [
      [21.0, -8.8], // Shared with Siberia & China
      [24.2, -9.8], // Shared with Siberia & Irkutsk
      [33.0, -9.8], // Shared with Irkutsk & Kamchatka
      [33.8, -8.2], // Shared with Kamchatka (Vladivostok)
      [32.5, -5.5], // Shared with China (North Korea / Yalu River coast)
      [28.5, -5.2], // Shared with China (Inner Mongolia / Gobi)
      [23.5, -5.8], // Shared with China (Altai / Gansu)
    ],
    neighbors: ['siberia', 'irkutsk', 'kamchatka', 'japan', 'china'],
  },
  {
    id: 'japan',
    name: 'Japan',
    continent: 'asia',
    center: [38.8, -4.5],
    polygon: [
      // Honshu (curved bow shape)
      [38.8, -6.5], // Aomori (Northern Honshu)
      [40.2, -4.8], // Sendai
      [40.0, -3.0], // Tokyo / Chiba
      [38.2, -3.2], // Nagoya / Osaka
      [36.2, -2.8], // Hiroshima / Shimonoseki
      [36.8, -4.0], // Matsue (Sea of Japan coast)
      [38.0, -4.8], // Noto Peninsula / Niigata
    ],
    islands: [
      // Hokkaido (North)
      [
        [39.0, -9.0],
        [41.2, -8.4],
        [40.8, -6.8],
        [38.8, -7.2],
      ],
      // Kyushu (South)
      [
        [35.2, -2.5],
        [36.6, -2.4],
        [36.2, -0.8],
        [35.0, -1.2],
      ],
    ],
    neighbors: ['kamchatka', 'mongolia'],
  },
  {
    id: 'afghanistan',
    name: 'Afghanistan',
    continent: 'asia',
    center: [14.0, -4.2],
    polygon: [
      [11.5, -7.5], // Shared with Ukraine & Ural
      [16.5, -7.5], // Shared with Ural & China
      [17.5, -2.2], // Shared with China & India (Pamirs / Kashmir)
      [14.2, -0.2], // Shared with India & Middle East (Balochistan)
      [10.2, -4.2], // Shared with Middle East & Ukraine (Caucasus / Azerbaijan)
    ],
    neighbors: ['ukraine', 'ural', 'china', 'india', 'middle_east'],
  },
  {
    id: 'middle_east',
    name: 'Mittlerer Osten',
    continent: 'asia',
    center: [9.8, 1.8],
    polygon: [
      [5.8, -2.4], // Anatolia West (Izmir / Aegean coast opposite Greece)
      [7.5, -4.2], // Shared with Ukraine (Black Sea / Pontic coast)
      [10.2, -4.2], // Shared with Ukraine & Afghanistan (Caucasus)
      [14.2, -0.2], // Shared with Afghanistan & India
      [14.0, 1.2], // Shared with India (Gwadar / Makran coast)
      [12.0, 1.5], // Strait of Hormuz (Iranian side)
      [10.2, 0.8], // Head of Persian Gulf (Basra / Kuwait)
      [11.8, 2.5], // Qatar / UAE (Persian Gulf South)
      [13.4, 3.8], // Ras al Hadd (Oman East tip of Arabian Peninsula)
      [11.5, 5.8], // Dhofar / Salalah (Oman South coast)
      [8.8, 6.8], // Aden / Bab el-Mandeb (Yemen tip facing East Africa)
      [7.2, 4.8], // Jeddah / Mecca (Red Sea East coast)
      [5.8, 3.5], // Shared with Egypt (Aqaba / Sinai South)
      [5.4, 2.2], // Shared with Egypt (Gaza / Sinai North)
      [6.2, -0.2], // Beirut / Latakia (Levant coast)
      [5.5, -0.8], // Antalya / Southern Turkey
    ],
    neighbors: [
      'ukraine',
      'southern_europe',
      'egypt',
      'east_africa',
      'india',
      'afghanistan',
    ],
  },
  {
    id: 'china',
    name: 'China',
    continent: 'asia',
    center: [24.8, -2.2],
    polygon: [
      [16.5, -7.5], // Shared with Ural & Afghanistan
      [18.0, -9.0], // Shared with Ural & Siberia
      [21.0, -8.8], // Shared with Siberia & Mongolia
      [23.5, -5.8], // Shared with Mongolia
      [28.5, -5.2], // Shared with Mongolia
      [32.5, -5.5], // Shared with Mongolia (Yalu River)
      [33.2, -3.5], // Korean Peninsula South tip (Busan)
      [31.8, -4.2], // Korea Bay
      [30.2, -3.8], // Bohai Sea / Beijing
      [31.5, -2.8], // Shandong Peninsula
      [32.0, -0.5], // Shanghai / East China Sea bulge
      [30.5, 1.8], // Fujian / Guangdong
      [28.0, 2.2], // Shared with Siam (Tonkin / Guangxi border)
      [23.2, 1.2], // Shared with Siam & India (Yunnan / Burma-Tibet corner)
      [17.5, -2.2], // Shared with India & Afghanistan (Himalayas / Aksai Chin)
    ],
    islands: [
      // Taiwan
      [
        [31.8, 0.8],
        [32.6, 1.0],
        [32.4, 2.2],
        [31.6, 2.0],
      ],
    ],
    neighbors: ['ural', 'siberia', 'mongolia', 'siam', 'india', 'afghanistan'],
  },
  {
    id: 'india',
    name: 'Indien',
    continent: 'asia',
    center: [18.5, 3.2],
    polygon: [
      [14.2, -0.2], // Shared with Afghanistan & Middle East
      [17.5, -2.2], // Shared with Afghanistan & China (Kashmir)
      [23.2, 1.2], // Shared with China & Siam (Assam / Arunachal)
      [22.5, 3.2], // Shared with Siam (Chittagong / Arakan coast)
      [21.0, 2.8], // Ganges Delta (Kolkata)
      [19.5, 5.2], // Visakhapatnam / Andhra coast
      [18.0, 8.8], // Kanyakumari / Cape Comorin (Southern tip of India!)
      [16.5, 6.2], // Goa / Mangalore (Malabar coast)
      [16.0, 3.5], // Mumbai
      [14.5, 2.5], // Gujarat / Kathiawar Peninsula
      [14.0, 1.2], // Shared with Middle East (Karachi / Indus Delta)
    ],
    islands: [
      // Sri Lanka
      [
        [18.8, 8.2],
        [19.8, 8.4],
        [19.6, 9.8],
        [18.6, 9.5],
      ],
    ],
    neighbors: ['middle_east', 'afghanistan', 'china', 'siam'],
  },
  {
    id: 'siam',
    name: 'Südostasien',
    continent: 'asia',
    center: [26.2, 4.5],
    polygon: [
      [23.2, 1.2], // Shared with India & China
      [28.0, 2.2], // Shared with China (Hanoi / Haiphong)
      [29.8, 4.2], // Da Nang / Central Vietnam bulge
      [28.8, 6.5], // Mekong Delta (Ho Chi Minh City)
      [26.8, 5.5], // Gulf of Thailand (Bangkok)
      [25.8, 7.2], // Isthmus of Kra
      [26.5, 9.2], // Singapore / Malay Peninsula tip (facing Sumatra/Borneo)
      [24.8, 7.8], // Penang / Phuket
      [24.2, 5.2], // Tenasserim / Andaman coast
      [22.8, 4.8], // Irrawaddy Delta (Yangon)
      [22.5, 3.2], // Shared with India
    ],
    neighbors: ['china', 'india', 'indonesia'],
  },

  // =========================================================================
  // AUSTRALIA / OCEANIA (4 Territories)
  // Geographically accurate silhouettes: Indonesian Archipelago (Borneo,
  // Sumatra, Java, Sulawesi), Bird-shaped New Guinea, and the Australian
  // Continent with Kimberley, Great Australian Bight, Gulf of Carpentaria,
  // Cape York Peninsula, and Tasmania.
  // =========================================================================
  {
    id: 'indonesia',
    name: 'Indonesien',
    continent: 'australia',
    center: [29.2, 11.4],
    polygon: [
      // Borneo (Kalimantan / Sarawak / Sabah) - Central main island for troops/label
      [29.8, 9.0], // Sabah North tip
      [31.2, 10.2], // East Kalimantan
      [30.6, 12.6], // Banjarmasin (South Borneo)
      [28.0, 12.4], // West Kalimantan (Pontianak)
      [27.6, 10.6], // Sarawak (Kuching)
    ],
    islands: [
      // Sumatra (stretching NW toward Malay Peninsula / Siam)
      [
        [23.2, 9.2],
        [25.2, 10.2],
        [26.8, 12.6],
        [25.6, 13.4],
        [23.0, 10.4],
      ],
      // Java & Lesser Sunda chain (stretching E toward Australia)
      [
        [26.6, 13.6],
        [31.8, 14.0],
        [31.6, 14.9],
        [26.4, 14.4],
      ],
      // Sulawesi (between Borneo and New Guinea)
      [
        [31.8, 10.0],
        [33.6, 10.2],
        [33.2, 12.8],
        [31.6, 12.5],
      ],
    ],
    neighbors: ['siam', 'new_guinea', 'western_australia'],
  },
  {
    id: 'new_guinea',
    name: 'Neuguinea',
    continent: 'australia',
    center: [38.0, 12.0],
    polygon: [
      [34.8, 10.5], // Bird's Head Peninsula (Vogelkop, West Papua)
      [36.8, 10.2], // Cenderawasih Bay / Jayapura
      [39.8, 11.0], // Madang / Lae
      [42.2, 13.2], // Milne Bay (Papuan Peninsula SE tail)
      [40.2, 13.8], // Port Moresby / Gulf of Papua
      [38.0, 13.2], // Torres Strait North shore (Merauke)
      [35.5, 12.0], // Fakfak / Arafura coast
    ],
    neighbors: ['indonesia', 'western_australia', 'eastern_australia'],
  },
  {
    id: 'western_australia',
    name: 'Westaustralien',
    continent: 'australia',
    center: [30.8, 19.8],
    polygon: [
      [32.5, 15.5], // Darwin / Arnhem Land West
      [34.8, 16.2], // Shared with Eastern Australia (Gulf of Carpentaria West)
      [34.8, 22.0], // Shared with Eastern Australia (Eucla / Nullarbor Plain)
      [31.8, 22.2], // Great Australian Bight curve
      [29.5, 23.2], // Esperance / Albany
      [27.4, 23.2], // Cape Leeuwin / Perth (Southwest corner)
      [26.8, 20.5], // Shark Bay
      [26.8, 18.5], // North West Cape / Exmouth (Pilbara)
      [29.2, 17.2], // Broome
      [30.5, 15.8], // Kimberley coast / Joseph Bonaparte Gulf
    ],
    neighbors: ['indonesia', 'new_guinea', 'eastern_australia'],
  },
  {
    id: 'eastern_australia',
    name: 'Ostaustralien',
    continent: 'australia',
    center: [38.2, 20.0],
    polygon: [
      [34.8, 16.2], // Shared with Western Australia
      [36.2, 17.5], // Bottom of Gulf of Carpentaria (Karumba)
      [37.5, 14.8], // Cape York Peninsula tip (facing New Guinea!)
      [39.2, 16.8], // Cairns (Great Barrier Reef coast)
      [41.5, 18.8], // Rockhampton / Fraser Island
      [42.2, 20.5], // Brisbane / Gold Coast (Easternmost mainland point)
      [41.2, 22.5], // Sydney
      [39.8, 24.0], // Cape Howe / Gippsland
      [37.8, 24.0], // Melbourne / Port Phillip
      [36.0, 23.0], // Adelaide / Spencer Gulf
      [34.8, 22.0], // Shared with Western Australia
    ],
    islands: [
      // Tasmania
      [
        [37.8, 24.8],
        [39.6, 24.8],
        [39.2, 26.0],
        [38.0, 25.8],
      ],
    ],
    neighbors: ['new_guinea', 'western_australia'],
  },
];

export const TERRITORIES: TerritoryDef[] = [...CLASSIC_TERRITORIES];

export const TERRITORY_MAP: Record<string, TerritoryDef> = Object.fromEntries(
  TERRITORIES.map((t) => [t.id, t])
);

export let mapVersion = 1;
export let currentMapType: MapType = 'CLASSIC';
export let currentWorldName = 'Klassische Erde';
export let currentMapSeed: number | null = null;

function syncTerritoryMapInPlace(): void {
  for (const key of Object.keys(TERRITORY_MAP)) {
    delete TERRITORY_MAP[key];
  }
  for (const t of TERRITORIES) {
    TERRITORY_MAP[t.id] = t;
  }
}

export function applyClassicMap(): void {
  currentMapType = 'CLASSIC';
  currentWorldName = 'Klassische Erde';
  currentMapSeed = null;

  for (const cId of Object.keys(CLASSIC_CONTINENTS) as ContinentId[]) {
    CONTINENTS[cId] = { ...CLASSIC_CONTINENTS[cId] };
  }

  TERRITORIES.length = 0;
  TERRITORIES.push(...CLASSIC_TERRITORIES);
  syncTerritoryMapInPlace();

  SEA_CROSSING_KEYS.clear();
  for (const k of CLASSIC_SEA_CROSSING_KEYS) {
    SEA_CROSSING_KEYS.add(k);
  }

  WRAP_CROSSING_KEYS.clear();
  WRAP_CROSSING_KEYS.add('alaska--kamchatka');

  mapVersion++;
}

export function applyRandomMap(seed?: number): {
  worldName: string;
  seed: number;
} {
  const generated = generateRandomWorldMap(seed);
  currentMapType = 'RANDOM';
  currentWorldName = generated.worldName;
  currentMapSeed = generated.seed;

  for (const cId of Object.keys(generated.continents) as ContinentId[]) {
    CONTINENTS[cId] = { ...generated.continents[cId] };
  }

  TERRITORIES.length = 0;
  TERRITORIES.push(...generated.territories);
  syncTerritoryMapInPlace();

  SEA_CROSSING_KEYS.clear();
  for (const k of generated.seaCrossingKeys) {
    SEA_CROSSING_KEYS.add(k);
  }

  WRAP_CROSSING_KEYS.clear();
  for (const k of generated.wrapCrossingKeys) {
    WRAP_CROSSING_KEYS.add(k);
  }

  mapVersion++;
  return { worldName: generated.worldName, seed: generated.seed };
}

