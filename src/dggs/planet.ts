import * as THREE from 'three';
import { DGGSStructure, DGGSCell, getBiomeForNormal, DEFAULT_DGGS_DEPTH } from './icosahedron';
import { getNetTriangle, NET_EDGE_CHORD } from './net';

// Where the flat icosahedral-net view sits in world space, well clear of the
// sphere so the two views never visually overlap while switching between them.
export const NET_WORLD_OFFSET = new THREE.Vector3(0, -600, 0);

const BIOME_TEXTURE_URLS: Record<string, string> = {
  'Calcite Polar Glade': '/textures/calcite-polar-glade.png',
  'Basalt Abyssal Basin': '/textures/basalt-abyssal-basin.png',
  'Geodesic Moss Steppes': '/textures/geodesic-moss-steppes.png',
  'Amber Quartz Plateau': '/textures/amber-quartz-plateau.png',
  'Crystalline Crags': '/textures/crystalline-crags.png',
};

const textureLoader = new THREE.TextureLoader();

// Buffer capacity for the local flat patch: tiles with a corner within the fade radius
// (~2.4 leaf edges) number about 60, so this leaves headroom.
const LOCAL_PATCH_MAX_TILES = 96;

// Net-view walking trail: caps out after this many recorded points (oldest drop off),
// enough for a long session (planet circumference is ~264 units at radius 42).
const NET_TRAIL_MAX_POINTS = 5000;

// World-space size (in scene units) one texture tile covers — tuned against the
// ~6-unit edge length of a depth-3 leaf cell at radius 42.
const TRIPLANAR_TILE_SIZE = 12;

/**
 * A MeshStandardMaterial patched (via onBeforeCompile) to sample its texture
 * triplanar-projected from world position, blended by the surface normal,
 * instead of from UVs. Every fragment samples a pure function of world
 * position, so adjacent facets of the same biome — which share an edge in
 * actual 3D space even though their vertices aren't deduplicated — sample
 * identically along that edge. That's what removes the per-facet seams the
 * plain per-triangle UV mapping had.
 */
function createTriplanarMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.08,
    flatShading: true,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.triplanarMap = { value: texture };
    shader.uniforms.triplanarScale = { value: 1 / TRIPLANAR_TILE_SIZE };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTriplanarWorldPosition;
varying vec3 vTriplanarObjectNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTriplanarWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vTriplanarObjectNormal = normal;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D triplanarMap;
uniform float triplanarScale;
varying vec3 vTriplanarWorldPosition;
varying vec3 vTriplanarObjectNormal;`,
      )
      .replace(
        '#include <map_fragment>',
        `
{
  vec3 blendWeights = pow( abs( normalize( vTriplanarObjectNormal ) ), vec3( 4.0 ) );
  blendWeights /= ( blendWeights.x + blendWeights.y + blendWeights.z + 1e-5 );

  vec2 uvX = vTriplanarWorldPosition.zy * triplanarScale;
  vec2 uvY = vTriplanarWorldPosition.xz * triplanarScale;
  vec2 uvZ = vTriplanarWorldPosition.xy * triplanarScale;

  vec4 texX = texture2D( triplanarMap, uvX );
  vec4 texY = texture2D( triplanarMap, uvY );
  vec4 texZ = texture2D( triplanarMap, uvZ );

  diffuseColor *= texX * blendWeights.x + texY * blendWeights.y + texZ * blendWeights.z;
}
`,
      );
  };

  return material;
}

// Color/opacity per wireframe depth layer, outermost (coarsest) to innermost (finest).
// Falls back to repeating the last entry if maxDepth ever exceeds this list.
const WIREFRAME_STYLE_BY_DEPTH: { color: number; opacity: number }[] = [
  { color: 0xf59e0b, opacity: 0.9 }, // Gold
  { color: 0x06b6d4, opacity: 0.6 }, // Cyan
  { color: 0xa855f7, opacity: 0.45 }, // Violet
  { color: 0xffffff, opacity: 0.3 }, // White/grid
  { color: 0xec4899, opacity: 0.2 }, // Pink
  { color: 0x94a3b8, opacity: 0.15 }, // Slate
];

export interface BeaconState {
  index: number;
  position: THREE.Vector3;
  activated: boolean;
  meshGroup: THREE.Group;
  light: THREE.PointLight;
  beamMesh: THREE.Mesh;
}

export class DGGSPlanet {
  public group: THREE.Group;
  public dggs: DGGSStructure;
  public radius: number;
  public terrainGroup: THREE.Group;
  public wireframeLayers: THREE.LineSegments[] = [];
  public activeCellHighlight: THREE.LineLoop;
  public beacons: BeaconState[] = [];
  public netGroup: THREE.Group;
  public netActiveCellHighlight: THREE.LineLoop;
  public netTrailLine: THREE.LineSegments;
  private netTrailPoints: THREE.Vector2[] = [];
  // Local flat patch: the current leaf tile + the 12 tiles sharing a corner with it,
  // flattened onto the plane tangent to the sphere at the character and rebuilt every frame.
  public localPatchGroup: THREE.Group;
  private localPatchMeshes = new Map<string, THREE.Mesh>();
  private localPatchEdges: THREE.LineSegments;
  private localPatchCenterOutline: THREE.LineLoop;
  private localPatchTints = new Map<DGGSCell, THREE.Color>();
  public localPatchTiles: DGGSCell[] = [];

  constructor(radius = 42, depth: number = DEFAULT_DGGS_DEPTH) {
    this.radius = radius;
    this.group = new THREE.Group();
    this.dggs = new DGGSStructure(depth);

    // 1. Build Terrain Mesh (one sub-mesh per biome, each with its own texture)
    this.terrainGroup = this.buildTerrainGroup();
    this.group.add(this.terrainGroup);

    // 2. Build a DGGS wireframe layer for every depth this structure actually has
    for (let d = 0; d <= this.dggs.maxDepth; d++) {
      const style = WIREFRAME_STYLE_BY_DEPTH[Math.min(d, WIREFRAME_STYLE_BY_DEPTH.length - 1)];
      const lines = this.buildWireframeForDepth(d, style.color, style.opacity);
      this.wireframeLayers.push(lines);
      this.group.add(lines);
    }

    // 3. Build Active Cell Highlight
    this.activeCellHighlight = this.buildActiveCellHighlight();
    this.group.add(this.activeCellHighlight);

    // 4. Build 12 Geodesic Beacons at the 12 icosahedron base vertices
    this.buildBeacons();

    // 5. Build the flat unfolded icosahedral-net view, hidden until selected
    this.netGroup = this.buildNetGroup();
    this.netGroup.position.copy(NET_WORLD_OFFSET);
    this.netGroup.visible = false;
    this.group.add(this.netGroup);

    // 6. "You are here" — outlines the character's actual current cell on the net,
    // the same way activeCellHighlight does on the sphere, instead of a floating
    // icon that doesn't read as a place on the map.
    this.netActiveCellHighlight = this.buildActiveCellHighlight();
    this.netGroup.add(this.netActiveCellHighlight);

    // 7. Walking trail: builds up as the character moves, so opening the net view
    // shows where you've actually been, not just where you are right now.
    this.netTrailLine = this.buildNetTrailLine();
    this.netGroup.add(this.netTrailLine);

    // 8. Local flat patch (current tile + surrounding 12), hidden until selected
    this.localPatchGroup = this.buildLocalPatchGroup();
    this.localPatchGroup.visible = false;
    this.localPatchEdges = this.localPatchGroup.getObjectByName('patchEdges') as THREE.LineSegments;
    this.localPatchCenterOutline = this.localPatchGroup.getObjectByName('patchCenter') as THREE.LineLoop;
    this.group.add(this.localPatchGroup);
  }

  private buildLocalPatchGroup(): THREE.Group {
    const group = new THREE.Group();
    const maxVerts = LOCAL_PATCH_MAX_TILES * 3;

    for (const biomeName of Object.keys(BIOME_TEXTURE_URLS)) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3));
      // RGBA: alpha carries the distance fade toward the patch's outer edge.
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxVerts * 4), 4));
      geometry.setDrawRange(0, 0);

      const texture = textureLoader.load(BIOME_TEXTURE_URLS[biomeName]);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;

      const material = createTriplanarMaterial(texture);
      material.transparent = true;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.localPatchMeshes.set(biomeName, mesh);
      group.add(mesh);
    }

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LOCAL_PATCH_MAX_TILES * 6 * 3), 3));
    edgeGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LOCAL_PATCH_MAX_TILES * 6 * 3), 3));
    edgeGeometry.setDrawRange(0, 0);
    const edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }),
    );
    edges.name = 'patchEdges';
    edges.frustumCulled = false;
    group.add(edges);

    const center = this.buildActiveCellHighlight();
    center.name = 'patchCenter';
    group.add(center);

    return group;
  }

  /** Same per-cell tint as the sphere terrain, so a tile keeps its look in both views. */
  private getPatchTint(cell: DGGSCell): THREE.Color {
    let tint = this.localPatchTints.get(cell);
    if (!tint) {
      const hash = Math.sin(cell.faceIndex * 133.7 + (cell.path[0] || 0) * 17.3 + (cell.path[1] || 0) * 7.1) * 0.04;
      tint = getBiomeForNormal(cell.normal).color.clone().offsetHSL(hash, 0, hash);
      this.localPatchTints.set(cell, tint);
    }
    return tint;
  }

  /**
   * Re-flattens the ground around the character's exact position every frame, using an
   * azimuthal-equidistant projection onto the tangent plane there: each tile corner
   * keeps its true geodesic distance and bearing from the character. The 5-valent
   * beacon corners need no special case — the 5 tiles around one genuinely span 360°,
   * so they come out fatter in angle (72° vs 60°) automatically.
   *
   * Which tiles are drawn is decided purely by distance (any tile with a corner inside
   * the fade radius), roughly the current tile plus the ring of 12 around it. Choosing
   * them by "shares a corner with the current tile" instead made tiles pop in and out at
   * full opacity every time the current tile changed; by distance, a tile only starts
   * being drawn when its nearest corner is at alpha 0.
   */
  public updateLocalPatch(unitPos: THREE.Vector3, centerCell: DGGSCell) {
    if (!this.localPatchGroup.visible) return;

    const R = this.radius;
    const leafEdge = (R * NET_EDGE_CHORD) / 2 ** this.dggs.maxDepth;
    const fadeStart = leafEdge * 1.2;
    const fadeEnd = leafEdge * 2.4;

    const cosMax = Math.cos(fadeEnd / R);
    const tiles = this.localPatchTiles;
    tiles.length = 0;
    for (const cell of this.dggs.leafCells) {
      const v = cell.vertices;
      if (unitPos.dot(v[0]) >= cosMax || unitPos.dot(v[1]) >= cosMax || unitPos.dot(v[2]) >= cosMax) {
        tiles.push(cell);
        if (tiles.length >= LOCAL_PATCH_MAX_TILES) break;
      }
    }

    const base = unitPos.clone().multiplyScalar(R);
    const lift = unitPos.clone().multiplyScalar(0.06);

    const project = (v: THREE.Vector3): { pos: THREE.Vector3; alpha: number } => {
      const cosT = THREE.MathUtils.clamp(unitPos.dot(v), -1, 1);
      const dist = R * Math.acos(cosT);
      const tangent = v.clone().addScaledVector(unitPos, -cosT);
      const len = tangent.length();
      const pos = base.clone();
      if (len > 1e-9) pos.addScaledVector(tangent, dist / len);
      const alpha = THREE.MathUtils.clamp((fadeEnd - dist) / (fadeEnd - fadeStart), 0, 1);
      return { pos, alpha };
    };

    const counts = new Map<string, number>();
    const edgePos = this.localPatchEdges.geometry.getAttribute('position') as THREE.BufferAttribute;
    const edgeCol = this.localPatchEdges.geometry.getAttribute('color') as THREE.BufferAttribute;
    let edgeVerts = 0;

    for (const cell of tiles) {
      const mesh = this.localPatchMeshes.get(cell.biome);
      if (!mesh) continue;
      const tint = this.getPatchTint(cell);
      const geom = mesh.geometry;
      const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
      const nrmAttr = geom.getAttribute('normal') as THREE.BufferAttribute;
      const colAttr = geom.getAttribute('color') as THREE.BufferAttribute;
      const start = (counts.get(cell.biome) ?? 0) * 3;

      const pts = cell.vertices.map(project);
      for (let k = 0; k < 3; k++) {
        const { pos, alpha } = pts[k];
        posAttr.setXYZ(start + k, pos.x, pos.y, pos.z);
        nrmAttr.setXYZ(start + k, unitPos.x, unitPos.y, unitPos.z);
        colAttr.setXYZW(start + k, tint.r, tint.g, tint.b, alpha);
      }
      counts.set(cell.biome, start / 3 + 1);

      for (let k = 0; k < 3; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % 3];
        const pa = a.pos.clone().add(lift);
        const pb = b.pos.clone().add(lift);
        edgePos.setXYZ(edgeVerts, pa.x, pa.y, pa.z);
        edgeCol.setXYZ(edgeVerts, a.alpha, a.alpha, a.alpha);
        edgeVerts++;
        edgePos.setXYZ(edgeVerts, pb.x, pb.y, pb.z);
        edgeCol.setXYZ(edgeVerts, b.alpha, b.alpha, b.alpha);
        edgeVerts++;
      }
    }

    for (const [name, mesh] of this.localPatchMeshes) {
      const n = counts.get(name) ?? 0;
      mesh.geometry.setDrawRange(0, n * 3);
      for (const attr of ['position', 'normal', 'color']) {
        (mesh.geometry.getAttribute(attr) as THREE.BufferAttribute).needsUpdate = true;
      }
    }
    edgePos.needsUpdate = true;
    edgeCol.needsUpdate = true;
    this.localPatchEdges.geometry.setDrawRange(0, edgeVerts);

    const outline = this.localPatchCenterOutline.geometry.getAttribute('position') as THREE.BufferAttribute;
    centerCell.vertices.forEach((v, k) => {
      const p = project(v).pos.add(lift).addScaledVector(unitPos, 0.04);
      outline.setXYZ(k, p.x, p.y, p.z);
    });
    outline.needsUpdate = true;
  }

  /** Shows/hides the local flat patch; entering it hides the sphere view's terrain, grid and beacons. */
  public setLocalPatchActive(active: boolean) {
    this.localPatchGroup.visible = active;
    if (!active) return;
    this.terrainGroup.visible = false;
    for (const lines of this.wireframeLayers) lines.visible = false;
    this.activeCellHighlight.visible = false;
    for (const beacon of this.beacons) beacon.meshGroup.visible = false;
  }

  private buildNetTrailLine(): THREE.LineSegments {
    // Sized for up to (MAX_POINTS - 1) independent 2-vertex segments.
    const positions = new Float32Array(NET_TRAIL_MAX_POINTS * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.Float32BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', posAttr);
    geometry.setDrawRange(0, 0);

    const material = new THREE.LineBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });

    const line = new THREE.LineSegments(geometry, material);
    line.renderOrder = 9; // under the active-cell highlight (10), above the terrain
    line.frustumCulled = false;
    return line;
  }

  /**
   * Appends one point (net-local, already scaled) to the walking trail, dropping the
   * oldest once full. Rendered as independent 2-vertex segments rather than one
   * continuous polyline, and any consecutive pair farther apart than a normal walking
   * step is simply not connected — that large a jump only happens when the character
   * crosses one of the net's unavoidable "cut" seams (e.g. Face 4 into Face 0: genuinely
   * adjacent in 3D, but separate, disconnected flaps once unfolded flat), not from
   * actually walking there.
   */
  public appendNetTrailPoint(x: number, y: number) {
    this.netTrailPoints.push(new THREE.Vector2(x, y));
    if (this.netTrailPoints.length > NET_TRAIL_MAX_POINTS) {
      this.netTrailPoints.shift();
    }

    const netScale = this.radius * NET_EDGE_CHORD;
    const leafEdge = netScale / 2 ** this.dggs.maxDepth;
    const gapThreshold = leafEdge * 1.5; // well above a normal per-sample step, far below a seam jump

    const posAttr = this.netTrailLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    let vertCount = 0;
    for (let i = 1; i < this.netTrailPoints.length; i++) {
      const a = this.netTrailPoints[i - 1];
      const b = this.netTrailPoints[i];
      if (a.distanceTo(b) > gapThreshold) continue;
      posAttr.setXYZ(vertCount++, a.x, a.y, 2.5);
      posAttr.setXYZ(vertCount++, b.x, b.y, 2.5);
    }
    posAttr.needsUpdate = true;
    this.netTrailLine.geometry.setDrawRange(0, vertCount);
  }

  public clearNetTrail() {
    this.netTrailPoints = [];
    this.netTrailLine.geometry.setDrawRange(0, 0);
  }

  /** Mirrors updateActiveCell, but for the flat net's leaf-cell outline. */
  public updateNetActiveCell(cell: DGGSCell) {
    const netScale = this.radius * NET_EDGE_CHORD;
    const { vertex, west, east } = getNetTriangle(cell.faceIndex, cell.path);
    const posAttr = this.netActiveCellHighlight.geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.setXYZ(0, vertex.x * netScale, vertex.y * netScale, 3);
    posAttr.setXYZ(1, west.x * netScale, west.y * netScale, 3);
    posAttr.setXYZ(2, east.x * netScale, east.y * netScale, 3);
    posAttr.needsUpdate = true;
  }

  /** Swaps visibility between the sphere (terrain/wireframes/beacons) and the flat net view. */
  public setNetViewActive(active: boolean) {
    this.terrainGroup.visible = !active;
    for (const lines of this.wireframeLayers) lines.visible = !active;
    this.activeCellHighlight.visible = !active;
    for (const beacon of this.beacons) beacon.meshGroup.visible = !active;
    this.netGroup.visible = active;
  }

  public getTerrainHeight(_unitDir: THREE.Vector3): number {
    // Uniform sphere — no elevation variation, biome differences are color-only.
    return this.radius;
  }

  private buildTerrainGroup(): THREE.Group {
    const cellsByBiome = new Map<string, DGGSCell[]>();
    for (const cell of this.dggs.leafCells) {
      const biomeName = getBiomeForNormal(cell.normal).name;
      const bucket = cellsByBiome.get(biomeName);
      if (bucket) bucket.push(cell);
      else cellsByBiome.set(biomeName, [cell]);
    }

    const group = new THREE.Group();
    const tempColor = new THREE.Color();

    for (const [biomeName, cells] of cellsByBiome) {
      const positions: number[] = [];
      const colors: number[] = [];
      const normals: number[] = [];

      for (const cell of cells) {
        const [v0, v1, v2] = cell.vertices;
        const biome = getBiomeForNormal(cell.normal);

        // Uniform sphere — every vertex sits at the same radius.
        const p0 = v0.clone().multiplyScalar(this.radius);
        const p1 = v1.clone().multiplyScalar(this.radius);
        const p2 = v2.clone().multiplyScalar(this.radius);
        const faceNormal = cell.tileNormal;

        positions.push(p0.x, p0.y, p0.z);
        positions.push(p1.x, p1.y, p1.z);
        positions.push(p2.x, p2.y, p2.z);

        // Slight cell color variation for crisp DGGS facet legibility (tints the texture)
        const hash = Math.sin(cell.faceIndex * 133.7 + (cell.path[0] || 0) * 17.3 + (cell.path[1] || 0) * 7.1) * 0.04;
        tempColor.copy(biome.color).offsetHSL(hash, 0, hash);

        for (let i = 0; i < 3; i++) {
          colors.push(tempColor.r, tempColor.g, tempColor.b);
          normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

      const texture = textureLoader.load(BIOME_TEXTURE_URLS[biomeName]);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;

      const material = createTriplanarMaterial(texture);

      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    return group;
  }

  /**
   * Flat unfolded icosahedral net: the same leaf cells, biome colors, and
   * textures as the sphere, but laid out as 20 flat triangles (see net.ts)
   * instead of projected onto the globe. Scaled so one net edge equals one
   * real base-face edge on the sphere, so texture density matches.
   */
  private buildNetGroup(): THREE.Group {
    const netScale = this.radius * NET_EDGE_CHORD;

    const cellsByBiome = new Map<string, DGGSCell[]>();
    for (const cell of this.dggs.leafCells) {
      const biomeName = getBiomeForNormal(cell.normal).name;
      const bucket = cellsByBiome.get(biomeName);
      if (bucket) bucket.push(cell);
      else cellsByBiome.set(biomeName, [cell]);
    }

    const group = new THREE.Group();
    const tempColor = new THREE.Color();

    for (const [biomeName, cells] of cellsByBiome) {
      const positions: number[] = [];
      const colors: number[] = [];
      const normals: number[] = [];

      for (const cell of cells) {
        const { vertex, west, east } = getNetTriangle(cell.faceIndex, cell.path);
        const biome = getBiomeForNormal(cell.normal);

        // Slight cell color variation for crisp DGGS facet legibility (tints the texture) —
        // identical formula to buildTerrainGroup, so the same cell reads the same color in both views.
        const hash = Math.sin(cell.faceIndex * 133.7 + (cell.path[0] || 0) * 17.3 + (cell.path[1] || 0) * 7.1) * 0.04;
        tempColor.copy(biome.color).offsetHSL(hash, 0, hash);

        for (const p of [vertex, west, east]) {
          positions.push(p.x * netScale, p.y * netScale, 0);
          colors.push(tempColor.r, tempColor.g, tempColor.b);
          normals.push(0, 0, 1);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

      const texture = textureLoader.load(BIOME_TEXTURE_URLS[biomeName]);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;

      const material = createTriplanarMaterial(texture);

      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    return group;
  }

  private buildWireframeForDepth(depth: number, colorHex: number, opacity: number): THREE.LineSegments {
    const cells = this.dggs.cellsByDepth.get(depth) || [];
    const points: number[] = [];
    const edgeSet = new Set<string>();

    const makeKey = (a: THREE.Vector3, b: THREE.Vector3) => {
      const p1 = `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}`;
      const p2 = `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`;
      return p1 < p2 ? `${p1}_${p2}` : `${p2}_${p1}`;
    };

    const r = this.radius + 0.08 + depth * 0.02;

    for (const cell of cells) {
      const [v0, v1, v2] = cell.vertices;
      const edges: [THREE.Vector3, THREE.Vector3][] = [
        [v0, v1],
        [v1, v2],
        [v2, v0],
      ];

      for (const [ea, eb] of edges) {
        const key = makeKey(ea, eb);
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          const pa = ea.clone().multiplyScalar(r);
          const pb = eb.clone().multiplyScalar(r);
          points.push(pa.x, pa.y, pa.z);
          points.push(pb.x, pb.y, pb.z);
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));

    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: opacity,
      linewidth: depth === 0 ? 2 : 1,
    });

    const lineSegments = new THREE.LineSegments(geom, mat);
    lineSegments.frustumCulled = false;
    return lineSegments;
  }

  private buildActiveCellHighlight(): THREE.LineLoop {
    const geom = new THREE.BufferGeometry();
    // 3 vertices for current cell
    const positions = new Float32Array(9);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({
      color: 0xff3b30,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    const line = new THREE.LineLoop(geom, mat);
    line.renderOrder = 10;
    line.frustumCulled = false;
    return line;
  }

  public updateActiveCell(cell: DGGSCell) {
    const posAttr = this.activeCellHighlight.geometry.getAttribute('position') as THREE.BufferAttribute;
    const r = this.radius + 0.18;
    const [v0, v1, v2] = cell.vertices;
    const p0 = v0.clone().multiplyScalar(r);
    const p1 = v1.clone().multiplyScalar(r);
    const p2 = v2.clone().multiplyScalar(r);

    posAttr.setXYZ(0, p0.x, p0.y, p0.z);
    posAttr.setXYZ(1, p1.x, p1.y, p1.z);
    posAttr.setXYZ(2, p2.x, p2.y, p2.z);
    posAttr.needsUpdate = true;
  }

  private buildBeacons() {
    this.beacons = [];
    const baseVerts = this.dggs.baseVertices;

    for (let i = 0; i < baseVerts.length; i++) {
      const v = baseVerts[i];
      const pos = v.clone().multiplyScalar(this.radius);

      const beaconGroup = new THREE.Group();
      beaconGroup.position.copy(pos);

      // Align beacon Y to sphere normal
      const normal = v.clone().normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
      beaconGroup.quaternion.copy(quat);

      // Base plinth (octagonal stepped pedestal)
      const plinthGeom = new THREE.CylinderGeometry(0.8, 1.1, 0.4, 6);
      const plinthMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        roughness: 0.6,
        metalness: 0.8,
      });
      const plinth = new THREE.Mesh(plinthGeom, plinthMat);
      plinth.position.y = 0.2;
      beaconGroup.add(plinth);

      // Monolith Spire
      const spireGeom = new THREE.ConeGeometry(0.4, 2.4, 4);
      spireGeom.rotateY(Math.PI / 4);
      const spireMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.2,
        metalness: 0.9,
      });
      const spire = new THREE.Mesh(spireGeom, spireMat);
      spire.position.y = 1.4;
      beaconGroup.add(spire);

      // Levitating Crystal Core
      const crystalGeom = new THREE.OctahedronGeometry(0.35, 0);
      const crystalMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 0.4,
        roughness: 0.1,
        metalness: 0.9,
      });
      const crystal = new THREE.Mesh(crystalGeom, crystalMat);
      crystal.position.y = 2.8;
      crystal.name = 'crystal';
      beaconGroup.add(crystal);

      // Light beam (cylinder pointing skyward, hidden until activated)
      const beamGeom = new THREE.CylinderGeometry(0.15, 0.6, 25, 12, 1, true);
      beamGeom.translate(0, 12.5, 0);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      });
      const beamMesh = new THREE.Mesh(beamGeom, beamMat);
      beaconGroup.add(beamMesh);

      // Beacon light
      const pointLight = new THREE.PointLight(0xf59e0b, 1.2, 8);
      pointLight.position.y = 3.0;
      beaconGroup.add(pointLight);

      this.group.add(beaconGroup);

      this.beacons.push({
        index: i,
        position: pos,
        activated: false,
        meshGroup: beaconGroup,
        light: pointLight,
        beamMesh,
      });
    }
  }

  public activateBeacon(index: number): boolean {
    const beacon = this.beacons[index];
    if (!beacon || beacon.activated) return false;

    beacon.activated = true;
    beacon.light.color.setHex(0x38bdf8);
    beacon.light.intensity = 4.5;
    (beacon.beamMesh.material as THREE.MeshBasicMaterial).opacity = 0.65;

    const crystal = beacon.meshGroup.getObjectByName('crystal') as THREE.Mesh;
    if (crystal) {
      const mat = crystal.material as THREE.MeshStandardMaterial;
      mat.color.setHex(0x38bdf8);
      mat.emissive.setHex(0x0284c7);
      mat.emissiveIntensity = 1.0;
    }

    return true;
  }

  public updateBeacons(delta: number, time: number) {
    for (const b of this.beacons) {
      const crystal = b.meshGroup.getObjectByName('crystal');
      if (crystal) {
        crystal.rotation.y += delta * 1.5;
        crystal.position.y = 2.8 + Math.sin(time * 2 + b.index) * 0.12;
      }
      if (b.activated) {
        b.beamMesh.rotation.y += delta * 0.5;
      }
    }
  }

  public setWireframeVisibility(visibleByDepth: boolean[]) {
    for (let d = 0; d < this.wireframeLayers.length; d++) {
      this.wireframeLayers[d].visible = visibleByDepth[d] ?? true;
    }
  }
}
