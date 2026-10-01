import * as THREE from 'three';

/**
 * Unfolded flat layout of the icosahedron ("net"): all 20 faces as
 * non-overlapping 2D triangles, oriented around the two middle bands
 * (5-9, 10-14) as a horizontal zigzag strip, with the north cap (0-4)
 * fanned above it and the south cap (15-19) fanned below.
 *
 * Every face is a flat equilateral triangle here (no spherical curvature
 * to account for), so subdividing it is exact plane geometry — no
 * per-level renormalization, unlike the real 3D cells in icosahedron.ts.
 * The subdivision step mirrors that file's corrected medial/vertex/west
 * /east convention exactly, so a (faceIndex, path) address always means
 * the same cell in both the sphere and the net.
 *
 * Net-space uses an edge length of 1; scale by NET_EDGE_CHORD * radius
 * to match a DGGSPlanet's actual world units.
 */

// Chord length of one base-face edge on a unit sphere (computed from the
// same icosahedron construction as icosahedron.ts's createBaseIcosahedron).
export const NET_EDGE_CHORD = 1.0514622242382672;

const H = Math.sqrt(3) / 2; // height of a unit equilateral triangle

// Center of the net's bounding box in net-space units (x:[0,5.5], y:[-H,2H]).
export const NET_LAYOUT_CENTER = new THREE.Vector2(2.75, H / 2);

export interface NetTriangle {
  vertex: THREE.Vector2;
  west: THREE.Vector2;
  east: THREE.Vector2;
}

// Reading-order layout: faces 0-4 left to right in the top row, 5-9 next, 10-14 next,
// 15-19 last. Face numbers increase eastward on the sphere, so this is the view of the
// sphere from outside (north up, east right) — same handedness as the 3D cells.
function baseFaceNetTriangle(faceIndex: number): NetTriangle {
  const band = Math.floor(faceIndex / 5);
  const i = faceIndex % 5;

  if (band === 0) {
    // North cap: vertex = N, folded up above the strip.
    return {
      vertex: new THREE.Vector2(i + 0.5, 2 * H),
      west: new THREE.Vector2(i, H),
      east: new THREE.Vector2(i + 1, H),
    };
  } else if (band === 1) {
    // Upper band: vertex = L(i), apex at the bottom of the strip.
    return {
      vertex: new THREE.Vector2(i + 0.5, 0),
      west: new THREE.Vector2(i, H),
      east: new THREE.Vector2(i + 1, H),
    };
  } else if (band === 2) {
    // Lower band: vertex = U(i+1), apex at the top of the strip.
    return {
      vertex: new THREE.Vector2(i + 1, H),
      west: new THREE.Vector2(i + 0.5, 0),
      east: new THREE.Vector2(i + 1.5, 0),
    };
  } else {
    // South cap: vertex = S, folded down below the strip.
    return {
      vertex: new THREE.Vector2(i + 1, -H),
      west: new THREE.Vector2(i + 0.5, 0),
      east: new THREE.Vector2(i + 1.5, 0),
    };
  }
}

function subdivideNetTriangle(tri: NetTriangle, step: number): NetTriangle {
  const { vertex: a, west: b, east: c } = tri;
  const ab = a.clone().add(b).multiplyScalar(0.5);
  const bc = b.clone().add(c).multiplyScalar(0.5);
  const ca = c.clone().add(a).multiplyScalar(0.5);

  switch (step) {
    case 0:
      return { vertex: bc, west: ca, east: ab }; // medial — bc is its true apex, matches icosahedron.ts
    case 1:
      return { vertex: a, west: ab, east: ca }; // vertex corner
    case 2:
      return { vertex: b, west: bc, east: ab }; // west corner
    case 3:
      return { vertex: c, west: ca, east: bc }; // east corner
    default:
      throw new Error(`Invalid DGGS sub-cell index ${step}, expected 0-3`);
  }
}

/** Recursively resolves a (faceIndex, path) DGGS address to its flat net-space triangle. */
export function getNetTriangle(faceIndex: number, path: number[]): NetTriangle {
  let tri = baseFaceNetTriangle(faceIndex);
  for (const step of path) {
    tri = subdivideNetTriangle(tri, step);
  }
  return tri;
}
