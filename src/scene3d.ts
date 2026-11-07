import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DiceRollResult } from './combatMath';
import { GameState } from './gameState';
import {
  CONTINENTS,
  ContinentId,
  isMaritimeConnection,
  isWrapAroundConnection,
  offsetPolygon,
  TERRITORIES,
  TERRITORY_MAP,
  TerritoryDef,
} from './mapData';
import { sound } from './sound';
import { createTacticalTextures, TacticalTextureSet } from './textures';

export type MapLensMode = 'FACTIONS' | 'CONTINENTS' | 'HEATMAP';

interface TerritoryMeshData {
  id: string;
  def: TerritoryDef;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  borderLine: THREE.LineSegments;
  armyGroup: THREE.Group;
  ringMesh: THREE.Mesh;
  beaconMesh: THREE.Mesh;
  capitalCrownGroup: THREE.Group;
  baseY: number;
  targetY: number;
  currentColor: THREE.Color;
  targetColor: THREE.Color;
  lastTroopCount: number;
  lastOwnerId: number;
}

interface ActiveProjectile {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  end: THREE.Vector3;
  progress: number;
  speed: number;
  color: number;
  trailTimer: number;
  onHit?: () => void;
}

interface ActiveParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
}

interface ActiveLightFlash {
  light: THREE.PointLight;
  life: number;
  maxLife: number;
  startIntensity: number;
}

interface ActiveShockwave {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  progress: number;
  maxRadius: number;
}

interface ActiveDice {
  mesh: THREE.Mesh;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  targetRot: THREE.Euler;
  progress: number;
}

export interface FloatingPopup {
  id: number;
  worldPos: THREE.Vector3;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export class Scene3D {
  private container: HTMLElement;
  private labelOverlay: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private oceanMesh!: THREE.Mesh;
  private oceanUniforms!: {
    uTime: { value: number };
    uAccentColor: { value: THREE.Color };
  };
  private textures!: TacticalTextureSet;
  private cornerBeacons: THREE.MeshStandardMaterial[] = [];

  private mapRootGroup = new THREE.Group();
  private territoryMeshes: Record<string, TerritoryMeshData> = {};
  private labelElements: Record<
    string,
    { root: HTMLDivElement; countEl: HTMLSpanElement; nameEl: HTMLSpanElement }
  > = {};

  private hoveredTerritoryId: string | null = null;
  private highlightedTargets = new Set<string>();
  private highlightedContinent: ContinentId | null = null;
  public mapLens: MapLensMode = 'FACTIONS';

  private onTerritoryClick: (territoryId: string) => void;
  private onTerritoryHover: (territoryId: string | null) => void;

  // Dynamic 3D animation entities
  private projectiles: ActiveProjectile[] = [];
  private particles: ActiveParticle[] = [];
  private lightFlashes: ActiveLightFlash[] = [];
  private shockwaves: ActiveShockwave[] = [];
  private activeDice: ActiveDice[] = [];
  private marchingUnits: {
    group: THREE.Group;
    points: THREE.Vector3[];
    progress: number;
    speed: number;
    onDone?: () => void;
  }[] = [];
  private popups: FloatingPopup[] = [];
  private popupElements = new Map<number, HTMLDivElement>();
  private nextPopupId = 1;

  // Battle arrow between attacker and defender
  private battleArrowGroup: THREE.Group;
  private diceMaterialsCache: Record<string, THREE.MeshStandardMaterial[]> = {};

  // Camera shake & smooth fly-to state
  private shakeIntensity = 0;
  private isTopDownView = false;
  private cameraLerpTargetPos: THREE.Vector3 | null = null;
  private cameraLerpLookAt: THREE.Vector3 | null = null;
  private isGameOverCelebration = false;
  private fireworkTimer = 0;

  public animationSpeed = 1.0; // 1x, 2x, 4x
  private clock = new THREE.Clock();

  constructor(
    container: HTMLElement,
    labelOverlay: HTMLElement,
    onTerritoryClick: (territoryId: string) => void,
    onTerritoryHover: (territoryId: string | null) => void
  ) {
    this.container = container;
    this.labelOverlay = labelOverlay;
    this.onTerritoryClick = onTerritoryClick;
    this.onTerritoryHover = onTerritoryHover;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050d1a);
    this.scene.fog = new THREE.FogExp2(0x050d1a, 0.0042);

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      1,
      320
    );
    this.camera.position.set(0, 58, 44);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI / 2.22;
    this.controls.minPolarAngle = 0.15;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 98;
    this.controls.target.set(0, 0, 2);

    // Cancel automatic camera glide if user manually orbits
    this.controls.addEventListener('start', () => {
      this.cameraLerpTargetPos = null;
      this.cameraLerpLookAt = null;
    });

    this.battleArrowGroup = new THREE.Group();
    this.scene.add(this.battleArrowGroup);
    this.scene.add(this.mapRootGroup);

    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.textures = createTacticalTextures(maxAniso);

    this.setupLights();
    this.buildBoardAndOcean();
    this.buildTerritories();
    this.buildConnectionBridges();
    this.setupEvents();

    this.animate();
  }

  public get hoveredId(): string | null {
    return this.hoveredTerritoryId;
  }

  public setHighlightedContinent(cId: ContinentId | null): void {
    this.highlightedContinent = cId;
  }

  public toggleCameraView(): boolean {
    this.isTopDownView = !this.isTopDownView;
    if (this.isTopDownView) {
      this.cameraLerpTargetPos = new THREE.Vector3(0, 76, 4);
      this.cameraLerpLookAt = new THREE.Vector3(0, 0, 1);
    } else {
      this.cameraLerpTargetPos = new THREE.Vector3(0, 58, 44);
      this.cameraLerpLookAt = new THREE.Vector3(0, 0, 2);
    }
    return this.isTopDownView;
  }

  public focusOnTerritory(territoryId: string): void {
    const tDef = TERRITORY_MAP[territoryId];
    if (!tDef) return;
    const [cx, cz] = tDef.center;
    this.cameraLerpLookAt = new THREE.Vector3(cx * 0.65, 0, cz * 0.65);
    this.cameraLerpTargetPos = new THREE.Vector3(
      cx * 0.65,
      this.isTopDownView ? 52 : 38,
      cz * 0.65 + (this.isTopDownView ? 3 : 26)
    );
  }

  public triggerCameraShake(intensity = 0.65): void {
    this.shakeIntensity = Math.min(1.6, Math.max(this.shakeIntensity, intensity));
  }

  /**
   * Rebuilds all 3D territory plateaus, shelves, maritime bridges, and HTML labels
   * when switching between the Classic World Map and a newly generated Random Map.
   */
  public rebuildMap(): void {
    this.showBattleArrow(null, null);
    this.clearActiveDice();

    this.mapRootGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });
    this.mapRootGroup.clear();

    for (const lbl of Object.values(this.labelElements)) {
      lbl.root.remove();
    }
    this.labelElements = {};
    this.territoryMeshes = {};
    this.hoveredTerritoryId = null;
    this.highlightedTargets.clear();

    this.buildTerritories();
    this.buildConnectionBridges();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfffbeb, 1.55);
    sun.position.set(25, 68, 36);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 150;
    const d = 56;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.55);
    rimLight.position.set(-42, 32, -38);
    this.scene.add(rimLight);

    const warmFill = new THREE.DirectionalLight(0xf59e0b, 0.25);
    warmFill.position.set(40, 22, -30);
    this.scene.add(warmFill);
  }

  private buildBoardAndOcean(): void {
    // Custom GLSL Tactical Ocean Shader with animated waves, caustics & sonar radar sweep
    const oceanGeo = new THREE.PlaneGeometry(140, 95, 128, 84);
    oceanGeo.rotateX(-Math.PI / 2);

    this.oceanUniforms = {
      uTime: { value: 0 },
      uAccentColor: { value: new THREE.Color(0x38bdf8) },
    };

    const oceanMat = new THREE.ShaderMaterial({
      uniforms: this.oceanUniforms,
      vertexShader: `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec2 vUv;
        varying float vElevation;

        void main() {
          vUv = uv;
          vec3 pos = position;
          float w1 = sin(pos.x * 0.14 + uTime * 1.35) * cos(pos.z * 0.14 + uTime * 1.05) * 0.18;
          float w2 = sin(pos.x * 0.32 - uTime * 1.9 + pos.z * 0.25) * 0.07;
          pos.y += w1 + w2;
          vElevation = pos.y;
          vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uAccentColor;
        varying vec3 vWorldPos;
        varying vec2 vUv;
        varying float vElevation;

        void main() {
          // Deep ocean gradient
          float dist = length(vWorldPos.xz) * 0.015;
          vec3 deepColor = vec3(0.025, 0.08, 0.16);
          vec3 midColor = vec3(0.05, 0.16, 0.30);
          vec3 crestColor = vec3(0.11, 0.34, 0.56);

          vec3 col = mix(midColor, deepColor, clamp(dist, 0.0, 1.0));
          col = mix(col, crestColor, smoothstep(-0.15, 0.24, vElevation) * 0.55);

          // Subtle procedural caustic interference pattern
          float c1 = sin(vWorldPos.x * 0.45 + uTime * 0.9) * sin(vWorldPos.z * 0.45 - uTime * 0.7);
          float c2 = cos((vWorldPos.x - vWorldPos.z) * 0.35 + uTime * 1.1);
          float caustics = smoothstep(0.45, 0.95, (c1 + c2) * 0.5);
          col += vec3(0.06, 0.22, 0.38) * caustics * 0.28;

          // Tactical holographic coordinate grid lines
          vec2 grid = abs(fract(vWorldPos.xz * 0.25 - 0.5) - 0.5) / fwidth(vWorldPos.xz * 0.25);
          float line = min(grid.x, grid.y);
          float gridAlpha = 1.0 - min(line, 1.0);
          col += uAccentColor * gridAlpha * 0.08 * (1.0 - clamp(dist * 0.75, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.position.y = -0.05;
    this.scene.add(this.oceanMesh);

    // War Table Rim Frame with Brushed Steel / Riveted Armor Texture & Glowing Faction Pylons
    const frameGroup = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x24344d,
      map: this.textures.frameMetalMap,
      bumpMap: this.textures.frameMetalBumpMap,
      bumpScale: 0.14,
      roughness: 0.36,
      metalness: 0.72,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.8,
    });

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(102.5, 2.3, 2.6), frameMat);
    topBar.position.set(0, 0.5, -27.5);
    const botBar = new THREE.Mesh(new THREE.BoxGeometry(102.5, 2.3, 2.6), frameMat);
    botBar.position.set(0, 0.5, 29.5);
    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.3, 59.5), frameMat);
    leftBar.position.set(-49.9, 0.5, 1);
    const rightBar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.3, 59.5), frameMat);
    rightBar.position.set(49.9, 0.5, 1);

    // Inner neon trim strips along the war table frame
    const topTrim = new THREE.Mesh(new THREE.BoxGeometry(97, 0.15, 0.18), trimMat);
    topTrim.position.set(0, 1.66, -26.25);
    const botTrim = new THREE.Mesh(new THREE.BoxGeometry(97, 0.15, 0.18), trimMat);
    botTrim.position.set(0, 1.66, 28.25);

    frameGroup.add(topBar, botBar, leftBar, rightBar, topTrim, botTrim);

    // 4 Corner Command Pylons with active player color beacons
    const corners: [number, number][] = [
      [-49.9, -27.5],
      [49.9, -27.5],
      [-49.9, 29.5],
      [49.9, 29.5],
    ];
    this.cornerBeacons = [];
    for (const [cx, cz] of corners) {
      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(1.9, 2.2, 2.9, 8),
        frameMat
      );
      pylon.position.set(cx, 0.75, cz);
      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        emissive: 0x3b82f6,
        emissiveIntensity: 0.9,
        roughness: 0.15,
        metalness: 0.3,
      });
      this.cornerBeacons.push(beaconMat);
      const beacon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.85, 0),
        beaconMat
      );
      beacon.position.set(cx, 2.9, cz);
      frameGroup.add(pylon, beacon);
    }

    this.scene.add(frameGroup);
  }

  private buildTerritories(): void {
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 1.38,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 0.06,
      bevelThickness: 0.2,
    };

    const shelfMat = new THREE.MeshStandardMaterial({
      color: 0x1a7299,
      map: this.textures.shelfWaterMap,
      bumpMap: this.textures.terrainBumpMap,
      bumpScale: 0.06,
      roughness: 0.28,
      metalness: 0.22,
      transparent: true,
      opacity: 0.8,
    });
    const bedrockMat = new THREE.MeshStandardMaterial({
      color: 0x26354a,
      map: this.textures.bedrockMap,
      bumpMap: this.textures.bedrockBumpMap,
      bumpScale: 0.18,
      roughness: 0.68,
      metalness: 0.28,
    });

    const shelfExtrude: THREE.ExtrudeGeometryOptions = {
      depth: 0.08,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.2,
      bevelThickness: 0.04,
    };

    const bedrockExtrude: THREE.ExtrudeGeometryOptions = {
      depth: 0.34,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.06,
      bevelThickness: 0.06,
    };

    const shelfGroup = new THREE.Group();
    this.mapRootGroup.add(shelfGroup);

    const polyToShape = (pts: [number, number][]): THREE.Shape => {
      const s = new THREE.Shape();
      pts.forEach(([px, pz], idx) => {
        if (idx === 0) s.moveTo(px, -pz);
        else s.lineTo(px, -pz);
      });
      s.closePath();
      return s;
    };

    for (const tDef of TERRITORIES) {
      const rawPolys = [tDef.polygon, ...(tDef.islands ?? [])];

      // 1. Shallow coastal water shelf
      const shelfShapes = rawPolys.map((p, idx) =>
        polyToShape(offsetPolygon(p, idx === 0 ? -0.44 : -0.28))
      );
      const shelfGeo = new THREE.ExtrudeGeometry(shelfShapes, shelfExtrude);
      shelfGeo.rotateX(-Math.PI / 2);
      const shelfMesh = new THREE.Mesh(shelfGeo, shelfMat);
      shelfMesh.position.y = 0.03;
      shelfMesh.receiveShadow = true;
      shelfGroup.add(shelfMesh);

      // 2. Continental bedrock layer
      const bedrockShapes = rawPolys.map((p, idx) =>
        polyToShape(offsetPolygon(p, idx === 0 ? -0.06 : -0.02))
      );
      const bedrockGeo = new THREE.ExtrudeGeometry(bedrockShapes, bedrockExtrude);
      bedrockGeo.rotateX(-Math.PI / 2);
      const bedrockMesh = new THREE.Mesh(bedrockGeo, bedrockMat);
      bedrockMesh.position.y = 0.07;
      bedrockMesh.receiveShadow = true;
      shelfGroup.add(bedrockMesh);

      // 3. Elevated Territory Plateau + Islands
      const territoryPolys = rawPolys.map((p, idx) =>
        offsetPolygon(p, idx === 0 ? 0.07 : 0.03)
      );
      const shapes = territoryPolys.map((p) => polyToShape(p));

      const geo = new THREE.ExtrudeGeometry(shapes, extrudeSettings);
      geo.rotateX(-Math.PI / 2);

      const contColor = new THREE.Color(CONTINENTS[tDef.continent].baseColor);
      const mat = new THREE.MeshStandardMaterial({
        color: contColor,
        map: this.textures.terrainColorMap,
        bumpMap: this.textures.terrainBumpMap,
        bumpScale: 0.16,
        roughness: 0.45,
        metalness: 0.18,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { territoryId: tDef.id };

      // Crisp 3D edge outline + top plateau border loop
      const edgesGeo = new THREE.EdgesGeometry(geo, 28);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x0f172a,
        transparent: true,
        opacity: 0.75,
      });
      const borderLine = new THREE.LineSegments(edgesGeo, lineMat);
      mesh.add(borderLine);

      const topLoopMat = new THREE.LineBasicMaterial({
        color: 0x090d16,
        transparent: true,
        opacity: 0.88,
      });
      for (const polyPts of territoryPolys) {
        const loopPts = polyPts.map(
          ([px, pz]) => new THREE.Vector3(px, 1.59, pz)
        );
        const loopGeo = new THREE.BufferGeometry().setFromPoints(loopPts);
        const loop = new THREE.LineLoop(loopGeo, topLoopMat);
        mesh.add(loop);
      }

      // Clean solid highlight ring on top of territory center
      const ringGeo = new THREE.RingGeometry(1.15, 1.55, 32);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.0,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(tDef.center[0], 1.62, tDef.center[1]);

      // Holographic vertical command beacon cylinder for selected territory
      const beaconGeo = new THREE.CylinderGeometry(1.1, 1.45, 7.5, 24, 1, true);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
      beaconMesh.position.set(tDef.center[0], 5.3, tDef.center[1]);

      // 3D Golden Capital Citadel / Crown (visible in CAPITALS mode)
      const capitalCrownGroup = this.createCapitalCitadelMesh();
      capitalCrownGroup.position.set(tDef.center[0], 1.6, tDef.center[1]);
      capitalCrownGroup.visible = false;

      // Group for 3D Army figurines standing on this territory
      const armyGroup = new THREE.Group();
      armyGroup.position.set(tDef.center[0], 1.58, tDef.center[1]);

      const group = new THREE.Group();
      group.add(mesh);
      group.add(ringMesh);
      group.add(beaconMesh);
      group.add(capitalCrownGroup);
      group.add(armyGroup);
      this.mapRootGroup.add(group);

      this.territoryMeshes[tDef.id] = {
        id: tDef.id,
        def: tDef,
        group,
        mesh,
        material: mat,
        borderLine,
        armyGroup,
        ringMesh,
        beaconMesh,
        capitalCrownGroup,
        baseY: 0,
        targetY: 0,
        currentColor: contColor.clone(),
        targetColor: contColor.clone(),
        lastTroopCount: -1,
        lastOwnerId: -1,
      };

      // Create crisp HTML label in overlay
      const labelEl = document.createElement('div');
      labelEl.className = 'territory-label';
      const countEl = document.createElement('span');
      countEl.className = 'territory-troops';
      countEl.textContent = '1';
      const nameEl = document.createElement('span');
      nameEl.className = 'territory-name';
      nameEl.textContent = tDef.name;
      labelEl.appendChild(countEl);
      labelEl.appendChild(nameEl);
      this.labelOverlay.appendChild(labelEl);

      this.labelElements[tDef.id] = {
        root: labelEl,
        countEl,
        nameEl,
      };
    }
  }

  private createCapitalCitadelMesh(): THREE.Group {
    const g = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xd97706,
      emissiveIntensity: 0.45,
      roughness: 0.2,
      metalness: 0.85,
    });
    const baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.38, 0.09, 10, 28),
      goldMat
    );
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.08;

    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.38, 0),
      goldMat
    );
    crystal.position.y = 2.15;
    crystal.name = 'capitalCrystal';

    g.add(baseRing, crystal);
    return g;
  }

  private getCoastalSamplePoints(tDef: TerritoryDef): [number, number][] {
    const polys = [tDef.polygon, ...(tDef.islands ?? [])];
    const samples: [number, number][] = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [x1, z1] = poly[i];
        const [x2, z2] = poly[(i + 1) % poly.length];
        const steps = 4;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          samples.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t]);
        }
      }
    }
    return samples;
  }

  private buildConnectionBridges(): void {
    const drawnPairs = new Set<string>();
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.55,
      gapSize: 0.35,
      transparent: true,
      opacity: 0.78,
    });
    const portGeo = new THREE.RingGeometry(0.14, 0.32, 16);
    portGeo.rotateX(-Math.PI / 2);
    const portMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });

    for (const tDef of TERRITORIES) {
      for (const nId of tDef.neighbors) {
        const pairKey = [tDef.id, nId].sort().join('--');
        if (drawnPairs.has(pairKey)) continue;
        drawnPairs.add(pairKey);

        if (!isMaritimeConnection(tDef.id, nId)) continue;

        const nDef = TERRITORY_MAP[nId];
        if (isWrapAroundConnection(tDef.id, nId)) {
          const westDef = tDef.center[0] < nDef.center[0] ? tDef : nDef;
          const eastDef = tDef.center[0] < nDef.center[0] ? nDef : tDef;

          let westPt = westDef.center;
          for (const p of westDef.polygon) {
            if (p[0] < westPt[0]) westPt = p;
          }
          let eastPt = eastDef.center;
          for (const p of eastDef.polygon) {
            if (p[0] > eastPt[0]) eastPt = p;
          }

          this.createWrapEdgeLine(
            new THREE.Vector3(westPt[0], 0.65, westPt[1]),
            new THREE.Vector3(-48.5, 0.65, westPt[1])
          );
          this.createWrapEdgeLine(
            new THREE.Vector3(eastPt[0], 0.65, eastPt[1]),
            new THREE.Vector3(48.5, 0.65, eastPt[1])
          );
          const portW = new THREE.Mesh(portGeo, portMat);
          portW.position.set(westPt[0], 1.6, westPt[1]);
          const portE = new THREE.Mesh(portGeo, portMat);
          portE.position.set(eastPt[0], 1.6, eastPt[1]);
          this.mapRootGroup.add(portW, portE);
          continue;
        }

        const ptsA = this.getCoastalSamplePoints(tDef);
        const ptsB = this.getCoastalSamplePoints(nDef);
        let bestA = tDef.center;
        let bestB = nDef.center;
        let minDist = Infinity;

        for (const a of ptsA) {
          for (const b of ptsB) {
            const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
            if (d < minDist) {
              minDist = d;
              bestA = a;
              bestB = b;
            }
          }
        }

        const p1 = new THREE.Vector3(bestA[0], 0.45, bestA[1]);
        const p2 = new THREE.Vector3(bestB[0], 0.45, bestB[1]);
        const mid = p1.clone().add(p2).multiplyScalar(0.5);
        mid.y = Math.min(1.45, 0.55 + minDist * 0.08);

        const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
        const points = curve.getPoints(16);
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, lineMat);
        line.computeLineDistances();
        this.mapRootGroup.add(line);

        const port1 = new THREE.Mesh(portGeo, portMat);
        port1.position.set(bestA[0], 1.6, bestA[1]);
        const port2 = new THREE.Mesh(portGeo, portMat);
        port2.position.set(bestB[0], 1.6, bestB[1]);
        this.mapRootGroup.add(port1, port2);
      }
    }
  }

  private createWrapEdgeLine(p1: THREE.Vector3, p2: THREE.Vector3): void {
    const mat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.7,
      gapSize: 0.4,
    });
    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    this.mapRootGroup.add(line);
  }

  private rebuildArmyFigures(
    armyGroup: THREE.Group,
    troops: number,
    colorHex: number
  ): void {
    while (armyGroup.children.length > 0) {
      armyGroup.remove(armyGroup.children[0]);
    }
    if (troops <= 0) return;

    const unitMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      map: this.textures.unitArmorMap,
      bumpMap: this.textures.unitArmorBumpMap,
      bumpScale: 0.08,
      roughness: 0.28,
      metalness: 0.55,
      emissive: new THREE.Color(colorHex).multiplyScalar(0.18),
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x26354a,
      map: this.textures.bedrockMap,
      bumpMap: this.textures.bedrockBumpMap,
      bumpScale: 0.08,
      roughness: 0.45,
      metalness: 0.68,
    });

    let rem = troops;
    const units: ('cannon' | 'tank' | 'soldier')[] = [];
    while (rem >= 10 && units.length < 4) {
      units.push('cannon');
      rem -= 10;
    }
    while (rem >= 5 && units.length < 5) {
      units.push('tank');
      rem -= 5;
    }
    while (rem >= 1 && units.length < 6) {
      units.push('soldier');
      rem -= 1;
    }
    if (units.length === 0) units.push('soldier');

    const radius = units.length === 1 ? 0 : 1.05;
    units.forEach((uType, idx) => {
      const angle = (idx / units.length) * Math.PI * 2;
      const ux = Math.cos(angle) * radius;
      const uz = Math.sin(angle) * radius - 0.35;

      const uMesh = this.createUnitMiniature(uType, unitMat, darkMat);
      uMesh.position.set(ux, 0, uz);
      uMesh.rotation.y = -angle + Math.PI / 2;
      armyGroup.add(uMesh);
    });
  }

  private createUnitMiniature(
    uType: 'cannon' | 'tank' | 'soldier',
    unitMat: THREE.Material,
    darkMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();

    if (uType === 'soldier') {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.38, 0.14, 12),
        darkMat
      );
      base.position.y = 0.07;
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(0.28, 0.65, 12),
        unitMat
      );
      body.position.y = 0.42;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 12),
        unitMat
      );
      head.position.y = 0.82;
      g.add(base, body, head);
    } else if (uType === 'tank') {
      const hull = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.3, 0.52),
        unitMat
      );
      hull.position.y = 0.18;
      const turret = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.28, 0.24, 12),
        unitMat
      );
      turret.position.y = 0.42;
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8),
        darkMat
      );
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0.32, 0.42, 0);
      g.add(hull, turret, barrel);
    } else {
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.56, 0.25, 8),
        darkMat
      );
      base.position.y = 0.12;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.44, 0.55, 8),
        unitMat
      );
      body.position.y = 0.48;
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 0.75, 10),
        darkMat
      );
      barrel.rotation.z = Math.PI / 3;
      barrel.position.set(0.28, 0.72, 0);
      g.add(base, body, barrel);
    }

    return g;
  }

  /**
   * Synchronizes the 3D board colors, troop miniatures, beacons, and floating labels with GameState.
   */
  public syncWithGameState(
    state: GameState,
    selectedId: string | null,
    validTargets: string[]
  ): void {
    this.highlightedTargets = new Set(validTargets);
    this.isGameOverCelebration = state.phase === 'GAME_OVER';

    // Sync War Table corner beacons & ocean radar tint with current player
    const activePlayer = state.currentPlayer;
    if (activePlayer) {
      for (const bm of this.cornerBeacons) {
        bm.color.setHex(activePlayer.colorHex);
        bm.emissive.setHex(activePlayer.colorHex);
      }
      this.oceanUniforms.uAccentColor.value
        .setHex(activePlayer.colorHex)
        .lerp(new THREE.Color(0x38bdf8), 0.55);
    }

    // Calculate max troops for Heatmap lens normalization
    let maxTroopsOnMap = 8;
    for (const t of Object.values(state.territories)) {
      if (t.troops > maxTroopsOnMap) maxTroopsOnMap = t.troops;
    }

    for (const tDef of TERRITORIES) {
      const tState = state.territories[tDef.id];
      const tm = this.territoryMeshes[tDef.id];
      const isUnclaimed = tState.ownerId === -1;
      const player = isUnclaimed ? null : state.players[tState.ownerId];

      const cColor = new THREE.Color(CONTINENTS[tDef.continent].baseColor);

      if (this.mapLens === 'CONTINENTS') {
        tm.targetColor.copy(cColor);
        if (player) {
          tm.targetColor.lerp(new THREE.Color(player.colorHex), 0.22);
        }
      } else if (this.mapLens === 'HEATMAP') {
        // Cool blue -> amber -> fiery red based on troop garrison & enemy border pressure
        const ratio = Math.min(1, tState.troops / Math.max(6, maxTroopsOnMap));
        const heatColor = new THREE.Color(0x1e3a8a);
        if (ratio < 0.5) {
          heatColor.lerp(new THREE.Color(0xf59e0b), ratio * 2);
        } else {
          heatColor
            .setHex(0xf59e0b)
            .lerp(new THREE.Color(0xef4444), (ratio - 0.5) * 2);
        }
        tm.targetColor.copy(heatColor);
      } else {
        // Default FACTIONS view
        if (isUnclaimed || !player) {
          const neutralColor = new THREE.Color(0x283548);
          tm.targetColor.copy(neutralColor).lerp(cColor, 0.45);
        } else {
          const pColor = new THREE.Color(player.colorHex);
          tm.targetColor.copy(pColor).lerp(cColor, 0.22);
        }
      }

      const isSelected = selectedId === tDef.id;
      const isTarget = this.highlightedTargets.has(tDef.id);
      const isHovered = this.hoveredTerritoryId === tDef.id;
      const isContinentHighlighted =
        this.highlightedContinent !== null &&
        tDef.continent === this.highlightedContinent;

      if (isSelected && player) {
        tm.targetY = 0.82;
        tm.material.emissive.setHex(player.colorHex).multiplyScalar(0.38);
      } else if (isContinentHighlighted) {
        tm.targetY = 0.62;
        tm.material.emissive
          .setHex(CONTINENTS[tDef.continent].baseColor)
          .multiplyScalar(0.45);
      } else if (isTarget) {
        tm.targetY = isHovered ? 0.58 : isUnclaimed ? 0.16 : 0.32;
        tm.material.emissive
          .setHex(isUnclaimed ? 0x38bdf8 : 0xfacc15)
          .multiplyScalar(isHovered ? 0.4 : 0.16);
      } else if (isHovered) {
        tm.targetY = 0.38;
        tm.material.emissive.setHex(0xffffff).multiplyScalar(0.14);
      } else {
        tm.targetY = 0;
        tm.material.emissive.setHex(0x000000);
      }

      // Holographic Command Beacon on selected territory
      const beaconMat = tm.beaconMesh.material as THREE.MeshBasicMaterial;
      if (isSelected && player) {
        beaconMat.color.setHex(player.colorHex);
        beaconMat.opacity = 0.24;
      } else if (isHovered && isTarget) {
        beaconMat.color.setHex(0xfacc15);
        beaconMat.opacity = 0.16;
      } else {
        beaconMat.opacity = 0.0;
      }

      // Update tactical ring & 3D Capital Crown
      const isCapital = state.isCapitalTerritory(tDef.id);
      tm.capitalCrownGroup.visible = isCapital;

      const ringMat = tm.ringMesh.material as THREE.MeshBasicMaterial;
      const isSetupPhase =
        state.phase === 'SETUP_CLAIM' || state.phase === 'SETUP_DEPLOY';
      if (isSelected) {
        ringMat.color.setHex(0xffffff);
        ringMat.opacity = 0.9;
      } else if (isTarget && (!isSetupPhase || isHovered)) {
        ringMat.color.setHex(isUnclaimed ? 0x38bdf8 : 0xfacc15);
        ringMat.opacity = 0.85;
      } else if (isContinentHighlighted) {
        ringMat.color.setHex(0xffffff);
        ringMat.opacity = 0.75;
      } else if (isCapital) {
        ringMat.color.setHex(0xfbbf24);
        ringMat.opacity = 0.78;
      } else {
        ringMat.opacity = 0.0;
      }

      // Update 3D army miniatures if troop count or owner changed
      if (
        tm.lastTroopCount !== tState.troops ||
        tm.lastOwnerId !== tState.ownerId
      ) {
        tm.lastTroopCount = tState.troops;
        tm.lastOwnerId = tState.ownerId;
        this.rebuildArmyFigures(
          tm.armyGroup,
          tState.troops,
          player ? player.colorHex : 0x64748b
        );
      }

      // Update HTML badge content
      const lbl = this.labelElements[tDef.id];
      if (lbl) {
        if (isUnclaimed || !player) {
          lbl.countEl.textContent = '🏳️ Frei';
          lbl.countEl.style.backgroundColor = 'rgba(30, 41, 59, 0.88)';
          lbl.nameEl.textContent = tDef.name;
        } else {
          lbl.countEl.textContent = isCapital
            ? `🏛️ ${tState.troops}`
            : String(tState.troops);
          lbl.countEl.style.backgroundColor = player.colorCss;
          lbl.nameEl.textContent = isCapital ? `★ ${tDef.name}` : tDef.name;
        }
        lbl.root.classList.toggle('selected', isSelected);
        lbl.root.classList.toggle('target', isTarget);
        lbl.root.classList.toggle('capital', isCapital);
        lbl.root.classList.toggle('unclaimed', isUnclaimed);
      }
    }
  }

  /**
   * Draws a glowing 3D attack arc with animated energy pulses between two territories.
   */
  public showBattleArrow(fromId: string | null, toId: string | null): void {
    while (this.battleArrowGroup.children.length > 0) {
      this.battleArrowGroup.remove(this.battleArrowGroup.children[0]);
    }
    if (!fromId || !toId) return;

    const fromCenter = TERRITORY_MAP[fromId].center;
    const toCenter = TERRITORY_MAP[toId].center;

    const p1 = new THREE.Vector3(fromCenter[0], 2.2, fromCenter[1]);
    const p2 = new THREE.Vector3(toCenter[0], 2.2, toCenter[1]);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    mid.y = p1.distanceTo(p2) > 40 ? 12.0 : 6.5;

    const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);

    const tubeGeo = new THREE.TubeGeometry(curve, 28, 0.2, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.82,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    this.battleArrowGroup.add(tube);

    // Arrowhead cone at p2
    const dir = new THREE.Vector3().subVectors(p2, mid).normalize();
    const coneGeo = new THREE.ConeGeometry(0.65, 1.5, 12);
    coneGeo.rotateX(Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(p2);
    cone.lookAt(p2.clone().add(dir));
    this.battleArrowGroup.add(cone);
  }

  /**
   * Animates 3D troops marching along a path of territories.
   */
  public animateTroopMovement(
    pathIds: string[],
    colorHex: number,
    troopCount: number,
    onComplete?: () => void
  ): void {
    if (pathIds.length < 2) {
      onComplete?.();
      return;
    }

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < pathIds.length - 1; i++) {
      const c1 = TERRITORY_MAP[pathIds[i]].center;
      const c2 = TERRITORY_MAP[pathIds[i + 1]].center;
      const p1 = new THREE.Vector3(c1[0], 2.0, c1[1]);
      const p2 = new THREE.Vector3(c2[0], 2.0, c2[1]);

      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      mid.y = p1.distanceTo(p2) > 40 ? 12.0 : 4.8;

      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      const segPts = curve.getPoints(16);
      if (i > 0) segPts.shift();
      points.push(...segPts);
    }

    const unitMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      map: this.textures.unitArmorMap,
      bumpMap: this.textures.unitArmorBumpMap,
      bumpScale: 0.08,
      emissive: new THREE.Color(colorHex).multiplyScalar(0.45),
      roughness: 0.22,
      metalness: 0.5,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      map: this.textures.bedrockMap,
      bumpMap: this.textures.bedrockBumpMap,
      bumpScale: 0.08,
    });

    const group = new THREE.Group();
    const uType =
      troopCount >= 8 ? 'cannon' : troopCount >= 4 ? 'tank' : 'soldier';
    const fig = this.createUnitMiniature(uType, unitMat, darkMat);
    fig.scale.setScalar(1.38);
    group.add(fig);

    const glowRing = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.78, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
      })
    );
    glowRing.rotateX(-Math.PI / 2);
    glowRing.position.y = 0.05;
    group.add(glowRing);

    group.position.copy(points[0]);
    this.scene.add(group);
    sound.playMarch();

    this.marchingUnits.push({
      group,
      points,
      progress: 0,
      speed: 2.2 * this.animationSpeed,
      onDone: () => {
        this.scene.remove(group);
        this.spawnShockwave(
          points[points.length - 1].x,
          points[points.length - 1].z,
          colorHex,
          2.2
        );
        onComplete?.();
      },
    });
  }

  /**
   * Animates a full 3D combat dice roll + artillery exchange + explosions, light flashes & camera shake!
   */
  public animateCombatExchange(
    fromId: string,
    toId: string,
    roll: DiceRollResult,
    attackerColor: number,
    defenderColor: number,
    onComplete: () => void
  ): void {
    this.showBattleArrow(fromId, toId);

    const fromCenter = TERRITORY_MAP[fromId].center;
    const toCenter = TERRITORY_MAP[toId].center;
    const midX = (fromCenter[0] + toCenter[0]) * 0.5;
    const midZ = (fromCenter[1] + toCenter[1]) * 0.5;

    // 1. Spawn 3D tumbling Attack & Defense Dice above the battle zone
    this.clearActiveDice();
    sound.playDiceRoll(roll.attackerDice.length + roll.defenderDice.length);
    sound.playCannonFire();
    roll.attackerDice.forEach((val, idx) => {
      const targetPos = new THREE.Vector3(
        midX - 2.2,
        4.2,
        midZ + (idx - (roll.attackerDice.length - 1) / 2) * 1.65
      );
      const startPos = targetPos.clone().add(new THREE.Vector3(-3, 6, 0));
      this.spawn3DDie(val, true, startPos, targetPos);
    });

    roll.defenderDice.forEach((val, idx) => {
      const targetPos = new THREE.Vector3(
        midX + 2.2,
        4.2,
        midZ + (idx - (roll.defenderDice.length - 1) / 2) * 1.65
      );
      const startPos = targetPos.clone().add(new THREE.Vector3(3, 6, 0));
      this.spawn3DDie(val, false, startPos, targetPos);
    });

    // 2. Fire 3D projectiles with smoke trails & muzzle flashes
    const pFrom = new THREE.Vector3(fromCenter[0], 2.2, fromCenter[1]);
    const pTo = new THREE.Vector3(toCenter[0], 2.2, toCenter[1]);

    this.spawnLightFlash(pFrom.x, 3.2, pFrom.z, 0xfef08a, 4.5, 0.18);

    this.spawnProjectile(pFrom, pTo, attackerColor, () => {
      if (roll.defenderLosses > 0) {
        sound.playExplosion(roll.defenderLosses);
        this.triggerCameraShake(0.32 * roll.defenderLosses);
        this.spawnLightFlash(pTo.x, 3.8, pTo.z, 0xff6b35, 8.0, 0.35);
        this.spawnExplosion(pTo.x, pTo.z, 0xff6b35);
        this.spawnShockwave(pTo.x, pTo.z, attackerColor, 3.2);
        this.addFloatingPopup(
          new THREE.Vector3(pTo.x, 3.8, pTo.z),
          `-${roll.defenderLosses}`,
          '#ef4444'
        );
      }
    });

    this.spawnProjectile(pTo, pFrom, defenderColor, () => {
      if (roll.attackerLosses > 0) {
        sound.playExplosion(roll.attackerLosses);
        this.triggerCameraShake(0.32 * roll.attackerLosses);
        this.spawnLightFlash(pFrom.x, 3.8, pFrom.z, 0x38bdf8, 8.0, 0.35);
        this.spawnExplosion(pFrom.x, pFrom.z, 0x38bdf8);
        this.spawnShockwave(pFrom.x, pFrom.z, defenderColor, 3.2);
        this.addFloatingPopup(
          new THREE.Vector3(pFrom.x, 3.8, pFrom.z),
          `-${roll.attackerLosses}`,
          '#f97316'
        );
      }
    });

    const durationMs = Math.max(220, Math.round(780 / this.animationSpeed));
    window.setTimeout(() => {
      this.clearActiveDice();
      onComplete();
    }, durationMs);
  }

  public triggerCaptureCelebration(territoryId: string, colorHex: number): void {
    const c = TERRITORY_MAP[territoryId].center;
    sound.playCapture();
    this.triggerCameraShake(0.75);
    this.spawnLightFlash(c[0], 4.5, c[1], colorHex, 12.0, 0.55);
    this.spawnShockwave(c[0], c[1], colorHex, 5.2);
    this.spawnExplosion(c[0], c[1], colorHex, 28);
    this.addFloatingPopup(
      new THREE.Vector3(c[0], 4.5, c[1]),
      '⚡ EROBERT!',
      '#facc15'
    );
  }

  private spawnLightFlash(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    intensity: number,
    maxLife: number
  ): void {
    const light = new THREE.PointLight(colorHex, intensity, 22);
    light.position.set(x, y, z);
    this.scene.add(light);
    this.lightFlashes.push({
      light,
      life: 0,
      maxLife,
      startIntensity: intensity,
    });
  }

  private spawn3DDie(
    value: number,
    isAttacker: boolean,
    startPos: THREE.Vector3,
    targetPos: THREE.Vector3
  ): void {
    const mats = this.getDieMaterials(isAttacker);
    const geo = new THREE.BoxGeometry(1.25, 1.25, 1.25);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = true;
    mesh.position.copy(startPos);
    mesh.rotation.set(
      Math.random() * Math.PI * 4,
      Math.random() * Math.PI * 4,
      Math.random() * Math.PI * 4
    );

    const targetRot = this.getRotationForDieTopValue(value);
    this.scene.add(mesh);
    this.activeDice.push({
      mesh,
      startPos,
      targetPos,
      targetRot,
      progress: 0,
    });
  }

  private getDieMaterials(isAttacker: boolean): THREE.MeshStandardMaterial[] {
    const key = isAttacker ? 'atk' : 'def';
    if (this.diceMaterialsCache[key]) return this.diceMaterialsCache[key];

    const faceValues = [1, 6, 2, 5, 3, 4];
    const borderColor = isAttacker ? '#fca5a5' : '#93c5fd';

    const mats = faceValues.map((v) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      // Textured radial gradient & brushed surface for dice
      const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 85);
      grad.addColorStop(0, isAttacker ? '#ef4444' : '#3b82f6');
      grad.addColorStop(1, isAttacker ? '#991b1b' : '#1e3a8a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);

      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 120, 120);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, 108, 108);

      const r = 12;
      const pipCoords: Record<number, [number, number][]> = {
        1: [[64, 64]],
        2: [
          [36, 36],
          [92, 92],
        ],
        3: [
          [32, 32],
          [64, 64],
          [96, 96],
        ],
        4: [
          [36, 36],
          [92, 36],
          [36, 92],
          [92, 92],
        ],
        5: [
          [32, 32],
          [96, 32],
          [64, 64],
          [32, 96],
          [96, 96],
        ],
        6: [
          [36, 28],
          [92, 28],
          [36, 64],
          [92, 64],
          [36, 100],
          [92, 100],
        ],
      };

      for (const [px, py] of pipCoords[v]) {
        // Recessed shadow ring
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.arc(px + 1.5, py + 1.5, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }

      const tex = new THREE.CanvasTexture(canvas);
      return new THREE.MeshStandardMaterial({
        map: tex,
        bumpMap: tex,
        bumpScale: 0.05,
        roughness: 0.24,
        metalness: 0.18,
      });
    });

    this.diceMaterialsCache[key] = mats;
    return mats;
  }

  private getRotationForDieTopValue(value: number): THREE.Euler {
    switch (value) {
      case 1:
        return new THREE.Euler(0, 0, Math.PI / 2);
      case 6:
        return new THREE.Euler(0, 0, -Math.PI / 2);
      case 2:
        return new THREE.Euler(0, 0, 0);
      case 5:
        return new THREE.Euler(Math.PI, 0, 0);
      case 3:
        return new THREE.Euler(-Math.PI / 2, 0, 0);
      case 4:
      default:
        return new THREE.Euler(Math.PI / 2, 0, 0);
    }
  }

  public clearActiveDice(): void {
    for (const d of this.activeDice) {
      this.scene.remove(d.mesh);
    }
    this.activeDice = [];
  }

  private spawnProjectile(
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    onHit?: () => void
  ): void {
    const geo = new THREE.SphereGeometry(0.34, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start);
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      start: start.clone(),
      end: end.clone(),
      progress: 0,
      speed: 2.6 * this.animationSpeed,
      color,
      trailTimer: 0,
      onHit,
    });
  }

  private spawnExplosion(
    x: number,
    z: number,
    colorHex: number,
    count = 20
  ): void {
    const geo = new THREE.SphereGeometry(0.19, 6, 6);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? colorHex : 0xfacc15,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 1.85, z);

      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 6.0;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        3.8 + Math.random() * 5.5,
        Math.sin(angle) * speed
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vel,
        life: 0,
        maxLife: 0.6,
        gravity: 14,
      });
    }
  }

  public spawnShockwave(
    x: number,
    z: number,
    colorHex: number,
    maxRadius: number
  ): void {
    const geo = new THREE.RingGeometry(0.3, 0.68, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 1.78, z);
    this.scene.add(mesh);
    this.shockwaves.push({
      mesh,
      mat,
      progress: 0,
      maxRadius,
    });
  }

  public addFloatingPopup(
    worldPos: THREE.Vector3,
    text: string,
    color: string
  ): void {
    const id = this.nextPopupId++;
    const el = document.createElement('div');
    el.className = 'floating-popup';
    el.textContent = text;
    el.style.color = color;
    this.labelOverlay.appendChild(el);
    this.popupElements.set(id, el);

    this.popups.push({
      id,
      worldPos: worldPos.clone(),
      text,
      color,
      life: 0,
      maxLife: 1.15,
    });
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect =
        this.container.clientWidth / this.container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(
        this.container.clientWidth,
        this.container.clientHeight
      );
    });

    let pointerDownPos = { x: 0, y: 0 };

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const meshes = Object.values(this.territoryMeshes).map((t) => t.mesh);
      const hits = this.raycaster.intersectObjects(meshes, false);
      const hitId =
        hits.length > 0 ? (hits[0].object.userData.territoryId as string) : null;

      if (hitId !== this.hoveredTerritoryId) {
        this.hoveredTerritoryId = hitId;
        this.renderer.domElement.style.cursor = hitId ? 'pointer' : 'grab';
        this.onTerritoryHover(hitId);
      }
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(
        e.clientX - pointerDownPos.x,
        e.clientY - pointerDownPos.y
      );
      if (dist > 6) return;

      if (this.hoveredTerritoryId) {
        this.onTerritoryClick(this.hoveredTerritoryId);
      }
    });

    // Double-click any territory to smoothly focus the camera on it
    this.renderer.domElement.addEventListener('dblclick', () => {
      if (this.hoveredTerritoryId) {
        this.focusOnTerritory(this.hoveredTerritoryId);
      }
    });
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.getElapsedTime();

    // Update Ocean GLSL Shader time
    this.oceanUniforms.uTime.value = elapsed;

    // Smooth camera preset / focus glide
    if (this.cameraLerpTargetPos && this.cameraLerpLookAt) {
      this.camera.position.lerp(this.cameraLerpTargetPos, Math.min(1, dt * 6));
      this.controls.target.lerp(this.cameraLerpLookAt, Math.min(1, dt * 6));
      if (
        this.camera.position.distanceTo(this.cameraLerpTargetPos) < 0.25 &&
        this.controls.target.distanceTo(this.cameraLerpLookAt) < 0.25
      ) {
        this.cameraLerpTargetPos = null;
        this.cameraLerpLookAt = null;
      }
    }

    this.controls.update();

    // Apply subtle screen/camera shake during explosions
    if (this.shakeIntensity > 0.005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity * 0.7;
      this.shakeIntensity *= Math.pow(0.04, dt);
    } else {
      this.shakeIntensity = 0;
    }

    // Celebrate victory with periodic 3D fireworks over the war table
    if (this.isGameOverCelebration) {
      this.fireworkTimer -= dt;
      if (this.fireworkTimer <= 0) {
        this.fireworkTimer = 0.65 + Math.random() * 0.6;
        const fx = (Math.random() - 0.5) * 70;
        const fz = (Math.random() - 0.5) * 40;
        const colors = [0x3b82f6, 0xfacc15, 0x10b981, 0xef4444, 0xa855f7];
        const col = colors[Math.floor(Math.random() * colors.length)];
        this.spawnLightFlash(fx, 8, fz, col, 10, 0.45);
        this.spawnExplosion(fx, fz, col, 24);
        this.spawnShockwave(fx, fz, col, 4.0);
      }
    }

    // Smooth territory elevation, color transitions & capital crystal rotation
    for (const tm of Object.values(this.territoryMeshes)) {
      tm.group.position.y +=
        (tm.targetY - tm.group.position.y) * Math.min(1, dt * 12);
      tm.currentColor.lerp(tm.targetColor, Math.min(1, dt * 10));
      tm.material.color.copy(tm.currentColor);

      if (tm.capitalCrownGroup.visible) {
        tm.capitalCrownGroup.rotation.y = elapsed * 1.4;
      }
    }

    // Update marching 3D units
    for (let i = this.marchingUnits.length - 1; i >= 0; i--) {
      const m = this.marchingUnits[i];
      m.progress += dt * m.speed;
      if (m.progress >= 1) {
        m.onDone?.();
        this.marchingUnits.splice(i, 1);
      } else {
        const floatIdx = m.progress * (m.points.length - 1);
        const idx = Math.floor(floatIdx);
        const frac = floatIdx - idx;
        const pA = m.points[idx];
        const pB = m.points[Math.min(m.points.length - 1, idx + 1)];
        m.group.position.lerpVectors(pA, pB, frac);
        m.group.lookAt(pB);
      }
    }

    // Update 3D tumbling dice
    for (const d of this.activeDice) {
      d.progress = Math.min(1, d.progress + dt * 3.2 * this.animationSpeed);
      const t = 1 - Math.pow(1 - d.progress, 3);
      d.mesh.position.lerpVectors(d.startPos, d.targetPos, t);
      d.mesh.position.y +=
        Math.sin(d.progress * Math.PI) * 3.0 * (1 - d.progress);

      d.mesh.rotation.x += (d.targetRot.x - d.mesh.rotation.x) * 0.25;
      d.mesh.rotation.y += (d.targetRot.y - d.mesh.rotation.y) * 0.25;
      d.mesh.rotation.z += (d.targetRot.z - d.mesh.rotation.z) * 0.25;
    }

    // Update projectiles & spawn glowing trail particles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.progress += dt * p.speed;
      if (p.progress >= 1) {
        this.scene.remove(p.mesh);
        p.onHit?.();
        this.projectiles.splice(i, 1);
      } else {
        p.mesh.position.lerpVectors(p.start, p.end, p.progress);
        p.mesh.position.y += Math.sin(p.progress * Math.PI) * 4.4;

        p.trailTimer += dt;
        if (p.trailTimer >= 0.025) {
          p.trailTimer = 0;
          const trailMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.14, 6, 6),
            new THREE.MeshBasicMaterial({
              color: p.color,
              transparent: true,
              opacity: 0.75,
            })
          );
          trailMesh.position.copy(p.mesh.position);
          this.scene.add(trailMesh);
          this.particles.push({
            mesh: trailMesh,
            vel: new THREE.Vector3(0, 0.4, 0),
            life: 0,
            maxLife: 0.26,
            gravity: 0,
          });
        }
      }
    }

    // Update dynamic point light flashes
    for (let i = this.lightFlashes.length - 1; i >= 0; i--) {
      const lf = this.lightFlashes[i];
      lf.life += dt * this.animationSpeed;
      if (lf.life >= lf.maxLife) {
        this.scene.remove(lf.light);
        lf.light.dispose();
        this.lightFlashes.splice(i, 1);
      } else {
        lf.light.intensity = lf.startIntensity * (1 - lf.life / lf.maxLife);
      }
    }

    // Update explosion & trail particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life += dt * this.animationSpeed;
      if (pt.life >= pt.maxLife) {
        this.scene.remove(pt.mesh);
        this.particles.splice(i, 1);
      } else {
        pt.vel.y -= pt.gravity * dt;
        pt.mesh.position.addScaledVector(pt.vel, dt);
        const mat = pt.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 1 - pt.life / pt.maxLife;
      }
    }

    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.progress += dt * 2.4 * this.animationSpeed;
      if (sw.progress >= 1) {
        this.scene.remove(sw.mesh);
        this.shockwaves.splice(i, 1);
      } else {
        const s = 1 + sw.progress * sw.maxRadius;
        sw.mesh.scale.set(s, 1, s);
        sw.mat.opacity = (1 - sw.progress) * 0.9;
      }
    }

    // Project 3D territory labels & floating popups to 2D screen coordinates
    this.updateOverlayProjections(dt);

    this.renderer.render(this.scene, this.camera);
  };

  private updateOverlayProjections(dt: number): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const tempV = new THREE.Vector3();

    for (const tDef of TERRITORIES) {
      const tm = this.territoryMeshes[tDef.id];
      const lbl = this.labelElements[tDef.id];
      if (!lbl) continue;

      tempV.set(
        tDef.center[0],
        1.78 + tm.group.position.y,
        tDef.center[1] + 0.95
      );
      tempV.project(this.camera);

      const x = (tempV.x * 0.5 + 0.5) * w;
      const y = (-(tempV.y * 0.5) + 0.5) * h;

      lbl.root.style.transform = `translate(-50%, -50%) translate(${x.toFixed(
        1
      )}px, ${y.toFixed(1)}px)`;
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.life += dt;
      const el = this.popupElements.get(pop.id);
      if (pop.life >= pop.maxLife) {
        if (el) el.remove();
        this.popupElements.delete(pop.id);
        this.popups.splice(i, 1);
        continue;
      }
      if (el) {
        pop.worldPos.y += dt * 2.4;
        tempV.copy(pop.worldPos).project(this.camera);
        const x = (tempV.x * 0.5 + 0.5) * w;
        const y = (-(tempV.y * 0.5) + 0.5) * h;
        el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(
          1
        )}px, ${y.toFixed(1)}px)`;
        el.style.opacity = String(1 - pop.life / pop.maxLife);
      }
    }
  }
}
