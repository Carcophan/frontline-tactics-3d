import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DiceRollResult } from './combatMath';
import { GameState } from './gameState';
import {
  CONTINENTS,
  isMaritimeConnection,
  isWrapAroundConnection,
  offsetPolygon,
  TERRITORIES,
  TERRITORY_MAP,
  TerritoryDef,
} from './mapData';
import { sound } from './sound';

interface TerritoryMeshData {
  id: string;
  def: TerritoryDef;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  borderLine: THREE.LineSegments;
  armyGroup: THREE.Group;
  ringMesh: THREE.Mesh;
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
  onHit?: () => void;
}

interface ActiveParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
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
  private mapRootGroup = new THREE.Group();
  private territoryMeshes: Record<string, TerritoryMeshData> = {};
  private labelElements: Record<
    string,
    { root: HTMLDivElement; countEl: HTMLSpanElement; nameEl: HTMLSpanElement }
  > = {};

  private hoveredTerritoryId: string | null = null;
  private selectedTerritoryId: string | null = null;
  private highlightedTargets = new Set<string>();
  private onTerritoryClick: (territoryId: string) => void;
  private onTerritoryHover: (territoryId: string | null) => void;

  // Dynamic 3D animation entities
  private projectiles: ActiveProjectile[] = [];
  private particles: ActiveParticle[] = [];
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
    this.scene.background = new THREE.Color(0x07111e);
    this.scene.fog = new THREE.FogExp2(0x07111e, 0.0045);

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      1,
      300
    );
    this.camera.position.set(0, 58, 44);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.minPolarAngle = 0.25;
    this.controls.minDistance = 22;
    this.controls.maxDistance = 95;
    this.controls.target.set(0, 0, 2);

    this.battleArrowGroup = new THREE.Group();
    this.scene.add(this.battleArrowGroup);
    this.scene.add(this.mapRootGroup);

    this.setupLights();
    this.buildBoardAndOcean();
    this.buildTerritories();
    this.buildConnectionBridges();
    this.setupEvents();

    this.animate();
  }

  /**
   * Rebuilds all 3D territory plateaus, shelves, maritime bridges, and HTML labels
   * when switching between the Classic World Map and a newly generated Random Map.
   */
  public rebuildMap(): void {
    this.showBattleArrow(null, null);
    this.clearActiveDice();

    // Dispose geometries and materials in mapRootGroup
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

    // Remove old territory HTML labels
    for (const lbl of Object.values(this.labelElements)) {
      lbl.root.remove();
    }
    this.labelElements = {};
    this.territoryMeshes = {};
    this.hoveredTerritoryId = null;
    this.selectedTerritoryId = null;
    this.highlightedTargets.clear();

    this.buildTerritories();
    this.buildConnectionBridges();
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.75);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfffbeb, 1.45);
    sun.position.set(25, 65, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 150;
    const d = 55;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
    rimLight.position.set(-40, 30, -35);
    this.scene.add(rimLight);
  }

  private buildBoardAndOcean(): void {
    // Ocean surface
    const oceanGeo = new THREE.PlaneGeometry(130, 85, 64, 48);
    oceanGeo.rotateX(-Math.PI / 2);
    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0c2442,
      roughness: 0.3,
      metalness: 0.35,
    });
    this.oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
    this.oceanMesh.receiveShadow = true;
    this.scene.add(this.oceanMesh);

    // Subtle tactical grid over the ocean
    const grid = new THREE.GridHelper(120, 40, 0x1e3a5f, 0x132845);
    grid.position.y = 0.03;
    grid.scale.z = 0.65;
    this.scene.add(grid);

    // War Table Rim Frame
    const frameGroup = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.6,
    });
    const topBar = new THREE.Mesh(new THREE.BoxGeometry(102, 2.2, 2.5), frameMat);
    topBar.position.set(0, 0.5, -27.5);
    const botBar = new THREE.Mesh(new THREE.BoxGeometry(102, 2.2, 2.5), frameMat);
    botBar.position.set(0, 0.5, 29.5);
    const leftBar = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.2, 59.5), frameMat);
    leftBar.position.set(-49.75, 0.5, 1);
    const rightBar = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.2, 59.5), frameMat);
    rightBar.position.set(49.75, 0.5, 1);

    frameGroup.add(topBar, botBar, leftBar, rightBar);
    this.scene.add(frameGroup);
  }

  private buildTerritories(): void {
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 1.35,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.05,
      bevelThickness: 0.18,
    };

    // Shared materials for the continental shelf (shallow water reef) and continental bedrock base
    const shelfMat = new THREE.MeshStandardMaterial({
      color: 0x134e6f,
      roughness: 0.35,
      metalness: 0.2,
      transparent: true,
      opacity: 0.72,
    });
    const bedrockMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.7,
      metalness: 0.25,
    });

    const shelfExtrude: THREE.ExtrudeGeometryOptions = {
      depth: 0.08,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.18,
      bevelThickness: 0.04,
    };

    const bedrockExtrude: THREE.ExtrudeGeometryOptions = {
      depth: 0.32,
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
        // Shape is in XY plane; rotateX(-Math.PI / 2) maps +Y to -Z, so -pz maps to +Z
        if (idx === 0) s.moveTo(px, -pz);
        else s.lineTo(px, -pz);
      });
      s.closePath();
      return s;
    };

    for (const tDef of TERRITORIES) {
      const rawPolys = [tDef.polygon, ...(tDef.islands ?? [])];

      // 1. Shallow coastal water shelf around continents & islands
      const shelfShapes = rawPolys.map((p, idx) =>
        polyToShape(offsetPolygon(p, idx === 0 ? -0.42 : -0.28))
      );
      const shelfGeo = new THREE.ExtrudeGeometry(shelfShapes, shelfExtrude);
      shelfGeo.rotateX(-Math.PI / 2);
      const shelfMesh = new THREE.Mesh(shelfGeo, shelfMat);
      shelfMesh.position.y = 0.02;
      shelfMesh.receiveShadow = true;
      shelfGroup.add(shelfMesh);

      // 2. Continental bedrock layer that fuses contiguous land territories into seamless continents
      const bedrockShapes = rawPolys.map((p, idx) =>
        polyToShape(offsetPolygon(p, idx === 0 ? -0.06 : -0.02))
      );
      const bedrockGeo = new THREE.ExtrudeGeometry(bedrockShapes, bedrockExtrude);
      bedrockGeo.rotateX(-Math.PI / 2);
      const bedrockMesh = new THREE.Mesh(bedrockGeo, bedrockMat);
      bedrockMesh.position.y = 0.06;
      bedrockMesh.receiveShadow = true;
      shelfGroup.add(bedrockMesh);

      // 3. Elevated Territory Plateau + Islands with crisp border inset
      const territoryPolys = rawPolys.map((p, idx) =>
        offsetPolygon(p, idx === 0 ? 0.07 : 0.03)
      );
      const shapes = territoryPolys.map((p) => polyToShape(p));

      const geo = new THREE.ExtrudeGeometry(shapes, extrudeSettings);
      geo.rotateX(-Math.PI / 2);

      const contColor = new THREE.Color(CONTINENTS[tDef.continent].baseColor);
      const mat = new THREE.MeshStandardMaterial({
        color: contColor,
        roughness: 0.46,
        metalness: 0.16,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { territoryId: tDef.id };

      // Crisp 3D edge outline + explicit top plateau border loop
      const edgesGeo = new THREE.EdgesGeometry(geo, 28);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x0f172a,
        transparent: true,
        opacity: 0.72,
      });
      const borderLine = new THREE.LineSegments(edgesGeo, lineMat);
      mesh.add(borderLine);

      const topLoopMat = new THREE.LineBasicMaterial({
        color: 0x090d16,
        transparent: true,
        opacity: 0.85,
      });
      for (const polyPts of territoryPolys) {
        const loopPts = polyPts.map(
          ([px, pz]) => new THREE.Vector3(px, 1.54, pz)
        );
        const loopGeo = new THREE.BufferGeometry().setFromPoints(loopPts);
        const loop = new THREE.LineLoop(loopGeo, topLoopMat);
        mesh.add(loop);
      }

      // Tactical highlight ring on top of territory center
      const ringGeo = new THREE.RingGeometry(1.15, 1.58, 32);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.0,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(tDef.center[0], 1.58, tDef.center[1]);

      // Group for 3D Army figurines standing on this territory
      const armyGroup = new THREE.Group();
      armyGroup.position.set(tDef.center[0], 1.55, tDef.center[1]);

      const group = new THREE.Group();
      group.add(mesh);
      group.add(ringMesh);
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

  /**
   * Samples perimeter points along a territory's main polygon and islands to find
   * the closest coastal points for maritime sea-lane bridges.
   */
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

  /**
   * Builds nautical sea-lane dotted bridges across maritime/strait crossings.
   * Contiguous land territories meet along shared borders and don't need cluttering lines.
   */
  private buildConnectionBridges(): void {
    const drawnPairs = new Set<string>();
    const lineMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.55,
      gapSize: 0.35,
      transparent: true,
      opacity: 0.75,
    });
    const portGeo = new THREE.RingGeometry(0.14, 0.3, 16);
    portGeo.rotateX(-Math.PI / 2);
    const portMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });

    for (const tDef of TERRITORIES) {
      for (const nId of tDef.neighbors) {
        const pairKey = [tDef.id, nId].sort().join('--');
        if (drawnPairs.has(pairKey)) continue;
        drawnPairs.add(pairKey);

        if (!isMaritimeConnection(tDef.id, nId)) continue;

        const nDef = TERRITORY_MAP[nId];
        // East-West wrap-around sea crossing (e.g. Alaska <-> Kamchatka or random map Pacific edge)
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
          portW.position.set(westPt[0], 1.56, westPt[1]);
          const portE = new THREE.Mesh(portGeo, portMat);
          portE.position.set(eastPt[0], 1.56, eastPt[1]);
          this.mapRootGroup.add(portW, portE);
          continue;
        }

        // Find closest coastal points between tDef and nDef
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

        // Add subtle coastal port markers at both ends of the sea lane
        const port1 = new THREE.Mesh(portGeo, portMat);
        port1.position.set(bestA[0], 1.56, bestA[1]);
        const port2 = new THREE.Mesh(portGeo, portMat);
        port2.position.set(bestB[0], 1.56, bestB[1]);
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

  /**
   * Creates 3D miniature military units (Infantry, Cavalry Tank, Artillery Cannon)
   * on the territory plateau representing the troop count.
   */
  private rebuildArmyFigures(
    armyGroup: THREE.Group,
    troops: number,
    colorHex: number
  ): void {
    while (armyGroup.children.length > 0) {
      armyGroup.remove(armyGroup.children[0]);
    }

    const unitMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.3,
      metalness: 0.45,
      emissive: new THREE.Color(colorHex).multiplyScalar(0.15),
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.6,
    });

    // Decompose troop count into visual miniatures (max ~7 figures so it looks neat)
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
      // Base pedestal + body cone + helmet sphere
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
      // Armored hull + turret + barrel (represents 5 troops)
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
      // Heavy Artillery / Star Citadel (represents 10 troops)
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
   * Synchronizes the 3D board colors, troop miniatures, and floating labels with GameState.
   */
  public syncWithGameState(
    state: GameState,
    selectedId: string | null,
    validTargets: string[]
  ): void {
    this.selectedTerritoryId = selectedId;
    this.highlightedTargets = new Set(validTargets);

    for (const tDef of TERRITORIES) {
      const tState = state.territories[tDef.id];
      const tm = this.territoryMeshes[tDef.id];
      const player = state.players[tState.ownerId];

      // Blend player faction color (78%) with continent color (22%) for tactical clarity
      const pColor = new THREE.Color(player.colorHex);
      const cColor = new THREE.Color(CONTINENTS[tDef.continent].baseColor);
      tm.targetColor.copy(pColor).lerp(cColor, 0.22);

      const isSelected = selectedId === tDef.id;
      const isTarget = this.highlightedTargets.has(tDef.id);
      const isHovered = this.hoveredTerritoryId === tDef.id;

      if (isSelected) {
        tm.targetY = 0.75;
        tm.material.emissive.setHex(player.colorHex).multiplyScalar(0.35);
      } else if (isTarget) {
        tm.targetY = isHovered ? 0.55 : 0.3;
        tm.material.emissive.setHex(0xfacc15).multiplyScalar(isHovered ? 0.35 : 0.18);
      } else if (isHovered) {
        tm.targetY = 0.35;
        tm.material.emissive.setHex(0xffffff).multiplyScalar(0.12);
      } else {
        tm.targetY = 0;
        tm.material.emissive.setHex(0x000000);
      }

      // Update tactical ring
      const isCapital = state.isCapitalTerritory(tDef.id);
      const ringMat = tm.ringMesh.material as THREE.MeshBasicMaterial;
      if (isSelected) {
        ringMat.color.setHex(0xffffff);
        ringMat.opacity = 0.9;
      } else if (isTarget) {
        ringMat.color.setHex(0xfacc15);
        ringMat.opacity = 0.85;
      } else if (isCapital) {
        ringMat.color.setHex(0xfbbf24);
        ringMat.opacity = 0.72;
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
        this.rebuildArmyFigures(tm.armyGroup, tState.troops, player.colorHex);
      }

      // Update HTML badge content
      const lbl = this.labelElements[tDef.id];
      if (lbl) {
        lbl.countEl.textContent = isCapital
          ? `🏛️ ${tState.troops}`
          : String(tState.troops);
        lbl.countEl.style.backgroundColor = player.colorCss;
        lbl.nameEl.textContent = isCapital ? `★ ${tDef.name}` : tDef.name;
        lbl.root.classList.toggle('selected', isSelected);
        lbl.root.classList.toggle('target', isTarget);
        lbl.root.classList.toggle('capital', isCapital);
      }
    }
  }

  /**
   * Draws a glowing 3D attack arc between two territories during battle or selection.
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
    const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.22, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.85,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    this.battleArrowGroup.add(tube);

    // Arrowhead cone at p2
    const dir = new THREE.Vector3().subVectors(p2, mid).normalize();
    const coneGeo = new THREE.ConeGeometry(0.6, 1.4, 12);
    coneGeo.rotateX(Math.PI / 2);
    const cone = new THREE.Mesh(coneGeo, tubeMat);
    cone.position.copy(p2);
    cone.lookAt(p2.clone().add(dir));
    this.battleArrowGroup.add(cone);
  }

  /**
   * Animates 3D troops marching along a path of territories (for reinforcement, conquest move, or fortification).
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

      // Handle Alaska-Kamchatka wrap cleanly by high arc
      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      mid.y = p1.distanceTo(p2) > 40 ? 12.0 : 4.8;

      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      const segPts = curve.getPoints(16);
      if (i > 0) segPts.shift();
      points.push(...segPts);
    }

    const unitMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: new THREE.Color(colorHex).multiplyScalar(0.4),
      roughness: 0.2,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });

    const group = new THREE.Group();
    const uType =
      troopCount >= 8 ? 'cannon' : troopCount >= 4 ? 'tank' : 'soldier';
    const fig = this.createUnitMiniature(uType, unitMat, darkMat);
    fig.scale.setScalar(1.35);
    group.add(fig);

    // Glowing base ring under moving squad
    const glowRing = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.75, 20),
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
   * Animates a full 3D combat dice roll + artillery exchange + explosions & casualty popups!
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

    // 2. Fire 3D projectiles between attacker and defender
    const pFrom = new THREE.Vector3(fromCenter[0], 2.2, fromCenter[1]);
    const pTo = new THREE.Vector3(toCenter[0], 2.2, toCenter[1]);

    // Attacker fires at defender
    this.spawnProjectile(pFrom, pTo, attackerColor, () => {
      if (roll.defenderLosses > 0) {
        sound.playExplosion(roll.defenderLosses);
        this.spawnExplosion(pTo.x, pTo.z, 0xff6b35);
        this.spawnShockwave(pTo.x, pTo.z, attackerColor, 3.0);
        this.addFloatingPopup(
          new THREE.Vector3(pTo.x, 3.8, pTo.z),
          `-${roll.defenderLosses}`,
          '#ef4444'
        );
      }
    });

    // Defender fires counter-salvo
    this.spawnProjectile(pTo, pFrom, defenderColor, () => {
      if (roll.attackerLosses > 0) {
        sound.playExplosion(roll.attackerLosses);
        this.spawnExplosion(pFrom.x, pFrom.z, 0x38bdf8);
        this.spawnShockwave(pFrom.x, pFrom.z, defenderColor, 3.0);
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
    this.spawnShockwave(c[0], c[1], colorHex, 4.5);
    this.spawnExplosion(c[0], c[1], colorHex);
    this.addFloatingPopup(
      new THREE.Vector3(c[0], 4.5, c[1]),
      'EROBERT!',
      '#facc15'
    );
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

    // Orient top face (+Y, material index 2 in BoxGeometry) to show `value`
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

    // BoxGeometry face order: 0:+X (1), 1:-X (6), 2:+Y (2), 3:-Y (5), 4:+Z (3), 5:-Z (4)
    const faceValues = [1, 6, 2, 5, 3, 4];
    const bgColor = isAttacker ? '#dc2626' : '#2563eb';
    const borderColor = isAttacker ? '#fca5a5' : '#93c5fd';

    const mats = faceValues.map((v) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 120, 120);

      ctx.fillStyle = '#ffffff';
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
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }

      const tex = new THREE.CanvasTexture(canvas);
      return new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.25,
        metalness: 0.1,
      });
    });

    this.diceMaterialsCache[key] = mats;
    return mats;
  }

  private getRotationForDieTopValue(value: number): THREE.Euler {
    // Face mapping: 0:+X=1, 1:-X=6, 2:+Y=2, 3:-Y=5, 4:+Z=3, 5:-Z=4
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
    const geo = new THREE.SphereGeometry(0.32, 10, 10);
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
      onHit,
    });
  }

  private spawnExplosion(x: number, z: number, colorHex: number): void {
    const count = 18;
    const geo = new THREE.SphereGeometry(0.18, 6, 6);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? colorHex : 0xfacc15,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 1.8, z);

      const angle = Math.random() * Math.PI * 2;
      const speed = 2.5 + Math.random() * 5.5;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        3.5 + Math.random() * 5.0,
        Math.sin(angle) * speed
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vel,
        life: 0,
        maxLife: 0.55,
      });
    }
  }

  private spawnShockwave(
    x: number,
    z: number,
    colorHex: number,
    maxRadius: number
  ): void {
    const geo = new THREE.RingGeometry(0.3, 0.65, 28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 1.75, z);
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
      maxLife: 1.1,
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
      if (dist > 6) return; // Ignore camera drag

      if (this.hoveredTerritoryId) {
        this.onTerritoryClick(this.hoveredTerritoryId);
      }
    });
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.getElapsedTime();

    this.controls.update();

    // Smooth territory elevation & color transitions
    for (const tm of Object.values(this.territoryMeshes)) {
      tm.group.position.y += (tm.targetY - tm.group.position.y) * Math.min(1, dt * 12);
      tm.currentColor.lerp(tm.targetColor, Math.min(1, dt * 10));
      tm.material.color.copy(tm.currentColor);

      if (this.highlightedTargets.has(tm.id)) {
        const pulse = 1 + Math.sin(elapsed * 6) * 0.14;
        tm.ringMesh.scale.set(pulse, 1, pulse);
      } else {
        tm.ringMesh.scale.set(1, 1, 1);
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
      // Bounce arc on Y
      d.mesh.position.y += Math.sin(d.progress * Math.PI) * 3.0 * (1 - d.progress);

      d.mesh.rotation.x += (d.targetRot.x - d.mesh.rotation.x) * 0.25;
      d.mesh.rotation.y += (d.targetRot.y - d.mesh.rotation.y) * 0.25;
      d.mesh.rotation.z += (d.targetRot.z - d.mesh.rotation.z) * 0.25;
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.progress += dt * p.speed;
      if (p.progress >= 1) {
        this.scene.remove(p.mesh);
        p.onHit?.();
        this.projectiles.splice(i, 1);
      } else {
        p.mesh.position.lerpVectors(p.start, p.end, p.progress);
        p.mesh.position.y += Math.sin(p.progress * Math.PI) * 4.2;
      }
    }

    // Update explosion particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life += dt * this.animationSpeed;
      if (pt.life >= pt.maxLife) {
        this.scene.remove(pt.mesh);
        this.particles.splice(i, 1);
      } else {
        pt.vel.y -= 14 * dt;
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
        1.75 + tm.group.position.y,
        tDef.center[1] + 0.95
      );
      tempV.project(this.camera);

      const x = (tempV.x * 0.5 + 0.5) * w;
      const y = (-(tempV.y * 0.5) + 0.5) * h;

      lbl.root.style.transform = `translate(-50%, -50%) translate(${x.toFixed(
        1
      )}px, ${y.toFixed(1)}px)`;
    }

    // Update floating popups
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
