import * as THREE from 'three';

export interface TacticalTextureSet {
  terrainColorMap: THREE.CanvasTexture;
  terrainBumpMap: THREE.CanvasTexture;
  bedrockMap: THREE.CanvasTexture;
  bedrockBumpMap: THREE.CanvasTexture;
  shelfWaterMap: THREE.CanvasTexture;
  frameMetalMap: THREE.CanvasTexture;
  frameMetalBumpMap: THREE.CanvasTexture;
  unitArmorMap: THREE.CanvasTexture;
  unitArmorBumpMap: THREE.CanvasTexture;
  reticleRingMap: THREE.CanvasTexture;
  compassRingMap: THREE.CanvasTexture;
}

/**
 * Deterministic pseudo-random value noise for procedural 2D texture generation.
 */
function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);

  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);

  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

function fbm(x: number, y: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * smoothNoise(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return val;
}

function configureRepeatingTexture(
  canvas: HTMLCanvasElement,
  repeatX: number,
  repeatY: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates high-detail procedural textures & bump maps for the 3D War Table,
 * Territories, Continental Bedrock, Coastal Shelves, Military Units, and Reticle Rings.
 */
export function createTacticalTextures(maxAnisotropy = 8): TacticalTextureSet {
  // 1. TOPOGRAPHIC TERRAIN TEXTURE & BUMP MAP (for Territory Plateaus)
  const tSize = 512;
  const terrainColorCanvas = document.createElement('canvas');
  terrainColorCanvas.width = tSize;
  terrainColorCanvas.height = tSize;
  const tcCtx = terrainColorCanvas.getContext('2d')!;

  const terrainBumpCanvas = document.createElement('canvas');
  terrainBumpCanvas.width = tSize;
  terrainBumpCanvas.height = tSize;
  const tbCtx = terrainBumpCanvas.getContext('2d')!;

  const tcImg = tcCtx.createImageData(tSize, tSize);
  const tbImg = tbCtx.createImageData(tSize, tSize);

  for (let y = 0; y < tSize; y++) {
    for (let x = 0; x < tSize; x++) {
      const nx = (x / tSize) * 8;
      const ny = (y / tSize) * 8;
      const h = fbm(nx, ny, 5);
      const micro = fbm(nx * 6, ny * 6, 2);

      // Topographic contour lines every ~0.08 elevation step
      const contourPhase = (h * 14) % 1;
      const isContour = contourPhase < 0.085;

      // Subtle tactical cartography grid
      const isGrid = x % 64 === 0 || y % 64 === 0;
      const isSubGrid = x % 16 === 0 || y % 16 === 0;

      // Albedo stays near white/light-gray so material.color tints cleanly
      let shade = 212 + (h - 0.5) * 58 + (micro - 0.5) * 22;
      if (isContour) shade -= 26;
      if (isGrid) shade -= 18;
      else if (isSubGrid) shade -= 6;
      shade = Math.max(145, Math.min(255, Math.round(shade)));

      const idx = (y * tSize + x) * 4;
      tcImg.data[idx] = shade;
      tcImg.data[idx + 1] = shade;
      tcImg.data[idx + 2] = shade;
      tcImg.data[idx + 3] = 255;

      // Bump height
      let bump = Math.round(h * 195 + micro * 50);
      if (isContour) bump = Math.max(0, bump - 30);
      tbImg.data[idx] = bump;
      tbImg.data[idx + 1] = bump;
      tbImg.data[idx + 2] = bump;
      tbImg.data[idx + 3] = 255;
    }
  }
  tcCtx.putImageData(tcImg, 0, 0);
  tbCtx.putImageData(tbImg, 0, 0);

  // ExtrudeGeometry UVs are in world units (~0.15 repeat scales nicely across territories)
  const terrainColorMap = configureRepeatingTexture(
    terrainColorCanvas,
    0.16,
    0.16,
    maxAnisotropy
  );
  const terrainBumpMap = configureRepeatingTexture(
    terrainBumpCanvas,
    0.16,
    0.16,
    maxAnisotropy
  );

  // 2. CONTINENTAL BEDROCK SLATE/STONE TEXTURE
  const bSize = 256;
  const bedrockCanvas = document.createElement('canvas');
  bedrockCanvas.width = bSize;
  bedrockCanvas.height = bSize;
  const bCtx = bedrockCanvas.getContext('2d')!;
  const bImg = bCtx.createImageData(bSize, bSize);

  for (let y = 0; y < bSize; y++) {
    for (let x = 0; x < bSize; x++) {
      const n = fbm((x / bSize) * 12, (y / bSize) * 12, 4);
      const strata = Math.sin((y / bSize) * Math.PI * 16 + n * 4) * 0.5 + 0.5;
      const v = Math.round(140 + n * 75 + strata * 35);
      const idx = (y * bSize + x) * 4;
      bImg.data[idx] = v;
      bImg.data[idx + 1] = v;
      bImg.data[idx + 2] = v;
      bImg.data[idx + 3] = 255;
    }
  }
  bCtx.putImageData(bImg, 0, 0);
  const bedrockMap = configureRepeatingTexture(
    bedrockCanvas,
    0.25,
    0.25,
    maxAnisotropy
  );
  const bedrockBumpMap = configureRepeatingTexture(
    bedrockCanvas,
    0.25,
    0.25,
    maxAnisotropy
  );

  // 3. SHALLOW COASTAL REEF / SHOAL TEXTURE
  const sSize = 256;
  const shelfCanvas = document.createElement('canvas');
  shelfCanvas.width = sSize;
  shelfCanvas.height = sSize;
  const sCtx = shelfCanvas.getContext('2d')!;
  const sImg = sCtx.createImageData(sSize, sSize);

  for (let y = 0; y < sSize; y++) {
    for (let x = 0; x < sSize; x++) {
      const n1 = fbm((x / sSize) * 10, (y / sSize) * 10, 3);
      const n2 = fbm((x / sSize) * 20 + 3.1, (y / sSize) * 20 + 1.7, 2);
      const caustic = Math.pow(Math.abs(n1 - n2) * 2.2, 0.7);
      const v = Math.max(150, Math.min(255, Math.round(175 + caustic * 80)));
      const idx = (y * sSize + x) * 4;
      sImg.data[idx] = v;
      sImg.data[idx + 1] = v;
      sImg.data[idx + 2] = v;
      sImg.data[idx + 3] = 255;
    }
  }
  sCtx.putImageData(sImg, 0, 0);
  const shelfWaterMap = configureRepeatingTexture(
    shelfCanvas,
    0.22,
    0.22,
    maxAnisotropy
  );

  // 4. WAR TABLE BRUSHED METAL & RIVETED PANEL TEXTURE
  const fSize = 256;
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = fSize;
  frameCanvas.height = fSize;
  const fCtx = frameCanvas.getContext('2d')!;

  fCtx.fillStyle = '#c8d0da';
  fCtx.fillRect(0, 0, fSize, fSize);

  // Horizontal brushed steel streaks
  for (let y = 0; y < fSize; y++) {
    const streak = 195 + Math.round((hash2D(y, 1.3) - 0.5) * 34);
    fCtx.fillStyle = `rgb(${streak},${streak},${streak})`;
    fCtx.fillRect(0, y, fSize, 1);
  }

  // Armor panel seams
  fCtx.strokeStyle = '#64748b';
  fCtx.lineWidth = 3;
  fCtx.strokeRect(4, 4, fSize - 8, fSize - 8);
  fCtx.beginPath();
  fCtx.moveTo(fSize / 2, 0);
  fCtx.lineTo(fSize / 2, fSize);
  fCtx.stroke();

  // Corner rivets
  const rivets = [
    [18, 18],
    [fSize - 18, 18],
    [18, fSize - 18],
    [fSize - 18, fSize - 18],
    [fSize / 2 - 14, 18],
    [fSize / 2 + 14, 18],
    [fSize / 2 - 14, fSize - 18],
    [fSize / 2 + 14, fSize - 18],
  ];
  for (const [rx, ry] of rivets) {
    fCtx.fillStyle = '#475569';
    fCtx.beginPath();
    fCtx.arc(rx, ry, 5, 0, Math.PI * 2);
    fCtx.fill();
    fCtx.fillStyle = '#e2e8f0';
    fCtx.beginPath();
    fCtx.arc(rx - 1, ry - 1, 2.5, 0, Math.PI * 2);
    fCtx.fill();
  }

  const frameMetalMap = configureRepeatingTexture(
    frameCanvas,
    6,
    1,
    maxAnisotropy
  );
  const frameMetalBumpMap = configureRepeatingTexture(
    frameCanvas,
    6,
    1,
    maxAnisotropy
  );

  // 5. MILITARY UNIT ARMOR HEX-WEAVE / PLATING TEXTURE
  const uSize = 128;
  const unitCanvas = document.createElement('canvas');
  unitCanvas.width = uSize;
  unitCanvas.height = uSize;
  const uCtx = unitCanvas.getContext('2d')!;

  uCtx.fillStyle = '#dcdcdc';
  uCtx.fillRect(0, 0, uSize, uSize);

  // Subtle diagonal armor ridges & metallic grain
  uCtx.strokeStyle = '#a8a8a8';
  uCtx.lineWidth = 2;
  for (let i = -uSize; i < uSize * 2; i += 16) {
    uCtx.beginPath();
    uCtx.moveTo(i, 0);
    uCtx.lineTo(i + uSize, uSize);
    uCtx.stroke();
  }
  uCtx.strokeStyle = '#ececec';
  uCtx.lineWidth = 1;
  for (let i = -uSize; i < uSize * 2; i += 16) {
    uCtx.beginPath();
    uCtx.moveTo(i + 3, 0);
    uCtx.lineTo(i + 3 + uSize, uSize);
    uCtx.stroke();
  }

  const unitArmorMap = configureRepeatingTexture(
    unitCanvas,
    2,
    2,
    maxAnisotropy
  );
  const unitArmorBumpMap = configureRepeatingTexture(
    unitCanvas,
    2,
    2,
    maxAnisotropy
  );

  // 6. TACTICAL SEGMENTED RETICLE RING TEXTURE (for territory selection/target rings)
  const rSize = 256;
  const reticleCanvas = document.createElement('canvas');
  reticleCanvas.width = rSize;
  reticleCanvas.height = rSize;
  const rCtx = reticleCanvas.getContext('2d')!;
  rCtx.clearRect(0, 0, rSize, rSize);

  const cx = rSize / 2;
  const cy = rSize / 2;
  rCtx.strokeStyle = '#ffffff';
  rCtx.lineWidth = 18;
  const segments = 12;
  for (let i = 0; i < segments; i++) {
    const startAngle = (i / segments) * Math.PI * 2 + 0.06;
    const endAngle = ((i + 1) / segments) * Math.PI * 2 - 0.06;
    rCtx.beginPath();
    rCtx.arc(cx, cy, 98, startAngle, endAngle);
    rCtx.stroke();
  }
  rCtx.lineWidth = 4;
  rCtx.beginPath();
  rCtx.arc(cx, cy, 114, 0, Math.PI * 2);
  rCtx.stroke();

  const reticleRingMap = new THREE.CanvasTexture(reticleCanvas);
  reticleRingMap.anisotropy = maxAnisotropy;

  // 7. COMPASS DEGREE RING TEXTURE
  const cSize = 512;
  const compassCanvas = document.createElement('canvas');
  compassCanvas.width = cSize;
  compassCanvas.height = cSize;
  const cCtx = compassCanvas.getContext('2d')!;
  cCtx.clearRect(0, 0, cSize, cSize);

  const ccx = cSize / 2;
  const ccy = cSize / 2;
  cCtx.strokeStyle = '#ffffff';
  for (let deg = 0; deg < 360; deg += 3) {
    const rad = (deg * Math.PI) / 180;
    const isMajor = deg % 15 === 0;
    cCtx.lineWidth = isMajor ? 4 : 2;
    const rInner = isMajor ? 228 : 236;
    const rOuter = 250;
    cCtx.beginPath();
    cCtx.moveTo(ccx + Math.cos(rad) * rInner, ccy + Math.sin(rad) * rInner);
    cCtx.lineTo(ccx + Math.cos(rad) * rOuter, ccy + Math.sin(rad) * rOuter);
    cCtx.stroke();
  }

  const compassRingMap = new THREE.CanvasTexture(compassCanvas);
  compassRingMap.anisotropy = maxAnisotropy;

  return {
    terrainColorMap,
    terrainBumpMap,
    bedrockMap,
    bedrockBumpMap,
    shelfWaterMap,
    frameMetalMap,
    frameMetalBumpMap,
    unitArmorMap,
    unitArmorBumpMap,
    reticleRingMap,
    compassRingMap,
  };
}
