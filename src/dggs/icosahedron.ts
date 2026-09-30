import * as THREE from 'three';

export interface DGGSCell {
  id: string; // e.g. "F12.1.3.2"
  faceIndex: number; // 0..19, see createBaseIcosahedron for the row layout
  path: number[]; // sub-triangle index at each depth: 0=medial, 1=vertex corner, 2=west corner, 3=east corner
  depth: number; // 0..3
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3]; // ordered [vertexCorner, westCorner, eastCorner]
  center: THREE.Vector3;
  normal: THREE.Vector3; // spherical centroid normal
  tileNormal: THREE.Vector3; // planar facet face normal
  biome: string;
}

/**
 * Face numbering (viewed pole to pole, left to right):
 *   Faces 0-4:   north cap    — vertex at N,        base edge on the upper ring   (vertex points north)
 *   Faces 5-9:   upper band   — vertex on lower ring, base edge on the upper ring (vertex points south)
 *   Faces 10-14: lower band   — vertex on upper ring, base edge on the lower ring (vertex points north)
 *   Faces 15-19: south cap    — vertex at S,         base edge on the lower ring  (vertex points south)
 * Face 5+i shares its base edge with face i; face 10+i sits to the right of face 5+i,
 * sharing i's right side with (5+i) and its own right side with (5+(i+1)%5); face 15+i
 * shares its base edge with face 10+i. Each face's vertex tuple is [vertexCorner, westCorner, eastCorner].
 */
function createBaseIcosahedron(): { vertices: THREE.Vector3[]; faces: [number, number, number][] } {
  const ringLat = Math.atan(0.5); // ~26.57°, the standard icosahedron ring latitude
  const ringY = Math.sin(ringLat);
  const ringR = Math.cos(ringLat);

  // Vertex layout: 0 = N, 1-5 = upper ring (U0..U4), 6-10 = lower ring (L0..L4), 11 = S
  const rawVertices: [number, number, number][] = [[0, 1, 0]];
  for (let i = 0; i < 5; i++) {
    const lon = (i * 2 * Math.PI) / 5;
    rawVertices.push([ringR * Math.cos(lon), ringY, ringR * Math.sin(lon)]);
  }
  for (let i = 0; i < 5; i++) {
    const lon = (i * 2 * Math.PI) / 5 + Math.PI / 5;
    rawVertices.push([ringR * Math.cos(lon), -ringY, ringR * Math.sin(lon)]);
  }
  rawVertices.push([0, -1, 0]);

  const vertices = rawVertices.map((v) => new THREE.Vector3(...v).normalize());

  const N = 0;
  const U = (i: number) => 1 + (((i % 5) + 5) % 5);
  const L = (i: number) => 6 + (((i % 5) + 5) % 5);
  const S = 11;

  const faces: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) faces.push([N, U(i), U(i + 1)]); // 0-4: north cap
  for (let i = 0; i < 5; i++) faces.push([L(i), U(i), U(i + 1)]); // 5-9: upper band
  for (let i = 0; i < 5; i++) faces.push([U(i + 1), L(i), L(i + 1)]); // 10-14: lower band
  for (let i = 0; i < 5; i++) faces.push([S, L(i), L(i + 1)]); // 15-19: south cap

  return { vertices, faces };
}

// Computed once and reused by the standalone cell-address functions below, so callers
// don't need a full DGGSStructure (and its 1,280-cell table) just to look up one cell.
const BASE_ICOSAHEDRON = createBaseIcosahedron();

/**
 * True if this triangle's vertex-corner sits at a higher latitude (closer to the
 * north pole) than the midpoint of its west/east base — i.e. it points north rather
 * than south. Works for any [vertex, west, east] triangle, at any depth.
 */
export function trianglePointsNorth(
  vertexCorner: THREE.Vector3,
  westCorner: THREE.Vector3,
  eastCorner: THREE.Vector3,
): boolean {
  return vertexCorner.y > (westCorner.y + eastCorner.y) / 2;
}

/**
 * Recursively descends from a base icosahedron face through an aperture-4 path
 * (0=medial, 1=vertex corner, 2=west corner, 3=east corner) and returns the resulting
 * cell's [vertex, west, east] triangle — in O(depth), without building the full cell
 * table. Mirrors DGGSStructure's own subdivision step exactly, so it always agrees
 * with the cells that class generates.
 */
export function getCellVertices(
  faceIndex: number,
  path: number[],
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const [i1, i2, i3] = BASE_ICOSAHEDRON.faces[faceIndex];
  let tri: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    BASE_ICOSAHEDRON.vertices[i1].clone(),
    BASE_ICOSAHEDRON.vertices[i2].clone(),
    BASE_ICOSAHEDRON.vertices[i3].clone(),
  ];

  for (const step of path) {
    const [v, w, e] = tri;
    const ab = new THREE.Vector3().addVectors(v, w).normalize();
    const bc = new THREE.Vector3().addVectors(w, e).normalize();
    const ca = new THREE.Vector3().addVectors(e, v).normalize();

    switch (step) {
      case 0:
        tri = [bc, ca, ab]; // medial — bc is its true apex, an exact 180° flip of [v,w,e]
        break;
      case 1:
        tri = [v, ab, ca]; // vertex corner
        break;
      case 2:
        tri = [w, bc, ab]; // west corner
        break;
      case 3:
        tri = [e, ca, bc]; // east corner
        break;
      default:
        throw new Error(`Invalid DGGS sub-cell index ${step}, expected 0-3`);
    }
  }

  return tri;
}

/** The cell's center as a unit direction from the planet's origin. */
export function getCellCenterDirection(faceIndex: number, path: number[]): THREE.Vector3 {
  const [v, w, e] = getCellVertices(faceIndex, path);
  return new THREE.Vector3().add(v).add(w).add(e).normalize();
}

/** The cell's center in degrees latitude/longitude. */
export function getCellPolarCoordinates(faceIndex: number, path: number[]): { lat: number; lon: number } {
  const dir = getCellCenterDirection(faceIndex, path);
  return {
    lat: (Math.asin(dir.y) * 180) / Math.PI,
    lon: (Math.atan2(dir.z, dir.x) * 180) / Math.PI,
  };
}

// Procedural biome generator based on spherical position & noise
export function getBiomeForNormal(n: THREE.Vector3): { name: string; color: THREE.Color } {
  const lat = Math.asin(n.y); // -PI/2 to PI/2
  const lon = Math.atan2(n.z, n.x); // -PI to PI
  const absLat = Math.abs(lat);

  // Procedural noise approximation
  const n1 = Math.sin(lat * 5 + Math.cos(lon * 4));
  const n2 = Math.cos(lat * 3 - Math.sin(lon * 6));
  const feature = n1 * 0.5 + n2 * 0.5;

  if (absLat > 1.25) {
    // Polar Calcite Frost
    return { name: 'Calcite Polar Glade', color: new THREE.Color('#dbeafe') };
  } else if (feature < -0.35 && absLat < 0.8) {
    // Basalt Basin / Deep Sea flats
    return { name: 'Basalt Abyssal Basin', color: new THREE.Color('#1e293b') };
  } else if (feature < 0.1) {
    // Geodesic Steppes
    return { name: 'Geodesic Moss Steppes', color: new THREE.Color('#15803d') };
  } else if (feature < 0.45) {
    // Amber Quartz Dunes
    return { name: 'Amber Quartz Plateau', color: new THREE.Color('#b45309') };
  } else {
    // Crystal Mountain Crags
    return { name: 'Crystalline Crags', color: new THREE.Color('#64748b') };
  }
}

export const DEFAULT_DGGS_DEPTH = 3;

/** Leaf-cell (or any-depth) face count: 20 base faces, x4 per aperture-4 subdivision level. */
export function faceCountAtDepth(depth: number): number {
  return 20 * 4 ** depth;
}

export class DGGSStructure {
  public baseVertices: THREE.Vector3[];
  public baseFaces: [number, number, number][];
  public cellsByDepth: Map<number, DGGSCell[]> = new Map();
  public leafCells: DGGSCell[] = []; // Depth `maxDepth`
  public maxDepth: number;
  public tessellationFactor = 4; // Aperture 4

  constructor(depth: number = DEFAULT_DGGS_DEPTH) {
    const { vertices, faces } = createBaseIcosahedron();
    this.baseVertices = vertices;
    this.baseFaces = faces;
    this.maxDepth = depth;
    this.generateDGGS(depth);
  }

  private getMidpoint(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3().addVectors(a, b).normalize();
  }

  private generateDGGS(targetDepth: number) {
    this.maxDepth = targetDepth;
    const depth0Cells: DGGSCell[] = [];

    // Depth 0: Base 20 icosahedral faces
    for (let f = 0; f < this.baseFaces.length; f++) {
      const [i1, i2, i3] = this.baseFaces[f];
      const v1 = this.baseVertices[i1].clone();
      const v2 = this.baseVertices[i2].clone();
      const v3 = this.baseVertices[i3].clone();
      const center = new THREE.Vector3().add(v1).add(v2).add(v3).normalize();
      const normal = center.clone();
      const e1 = new THREE.Vector3().subVectors(v2, v1);
      const e2 = new THREE.Vector3().subVectors(v3, v1);
      const tileNormal = new THREE.Vector3().crossVectors(e1, e2).normalize();
      if (tileNormal.dot(center) < 0) tileNormal.negate();
      const biomeInfo = getBiomeForNormal(normal);

      depth0Cells.push({
        id: `F${f}`,
        faceIndex: f,
        path: [],
        depth: 0,
        vertices: [v1, v2, v3],
        center,
        normal,
        tileNormal,
        biome: biomeInfo.name,
      });
    }
    this.cellsByDepth.set(0, depth0Cells);

    // Recursively subdivide with aperture 4 up to depth 3
    let currentCells = depth0Cells;
    for (let d = 1; d <= targetDepth; d++) {
      const nextCells: DGGSCell[] = [];
      for (const parent of currentCells) {
        const [a, b, c] = parent.vertices;
        const ab = this.getMidpoint(a, b);
        const bc = this.getMidpoint(b, c);
        const ca = this.getMidpoint(c, a);

        // 4 sub-triangles (Aperture 4 subdivision): 0=medial, 1=vertex corner, 2=west corner, 3=east corner.
        // Medial's own "vertex" is bc (the base-edge midpoint) — it's the true apex of the
        // inverted medial triangle, an exact 180° point-reflection of the parent. Putting ab
        // first here instead would be geometrically meaningless (an arbitrary ~60° offset, not
        // a real flip) and break the north/south-orientation parity rule for deeper cells.
        const subTriangles: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
          [bc, ca, ab],
          [a, ab, ca],
          [b, bc, ab],
          [c, ca, bc],
        ];

        for (let s = 0; s < 4; s++) {
          const verts = subTriangles[s];
          const center = new THREE.Vector3().add(verts[0]).add(verts[1]).add(verts[2]).normalize();
          const normal = center.clone();
          const subE1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
          const subE2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
          const tileNormal = new THREE.Vector3().crossVectors(subE1, subE2).normalize();
          if (tileNormal.dot(center) < 0) tileNormal.negate();
          const biomeInfo = getBiomeForNormal(normal);
          const path = [...parent.path, s];
          const id = `F${parent.faceIndex}.${path.join('.')}`;

          nextCells.push({
            id,
            faceIndex: parent.faceIndex,
            path,
            depth: d,
            vertices: verts,
            center,
            normal,
            tileNormal,
            biome: biomeInfo.name,
          });
        }
      }
      this.cellsByDepth.set(d, nextCells);
      currentCells = nextCells;
    }

    this.leafCells = currentCells; // Depth 3 (1280 cells)
  }

  /**
   * Fast spherical point containment lookup: returns the exact DGGS cell at depth 3 for a given normalized point.
   */
  public findCellAtPosition(posOnUnitSphere: THREE.Vector3): DGGSCell {
    // 1. Find the closest base icosahedron face
    let bestFace = 0;
    let maxDot = -Infinity;
    const depth0Cells = this.cellsByDepth.get(0)!;

    for (let f = 0; f < depth0Cells.length; f++) {
      const dot = depth0Cells[f].center.dot(posOnUnitSphere);
      if (dot > maxDot) {
        maxDot = dot;
        bestFace = f;
      }
    }

    // 2. Descend down depth 1, 2, 3
    let currentCell = depth0Cells[bestFace];

    for (let d = 1; d <= this.maxDepth; d++) {
      const depthCells = this.cellsByDepth.get(d)!;
      // Filter direct children of currentCell
      const children = depthCells.filter(
        (c) => c.faceIndex === currentCell.faceIndex && c.path.slice(0, d - 1).every((v, i) => v === currentCell.path[i]),
      );

      let bestChild = children[0] || currentCell;
      let childMaxDot = -Infinity;
      for (const child of children) {
        const dot = child.center.dot(posOnUnitSphere);
        if (dot > childMaxDot) {
          childMaxDot = dot;
          bestChild = child;
        }
      }
      currentCell = bestChild;
    }

    return currentCell;
  }
}
