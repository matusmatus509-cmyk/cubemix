/**
 * Consistency check between the two halves of the cube model.
 *
 * `applyMove` in CubeState permutes the 54 stickers. RubiksCube separately
 * rotates each cubie's logical position and mesh with a quaternion. The force
 * layer paints stickers by looking up (logical position → face slot → state),
 * so those two halves have to describe the exact same permutation, otherwise
 * every repaint would show wrong colours.
 *
 * Run: bun scripts/verify-move-consistency.ts
 */
import {
  applyMove,
  createSolvedState,
  type CubeStateData,
  type FaceColor,
  type MoveType,
} from '../src/cube/CubeState';

type Vec = [number, number, number];
type FaceKey = 'U' | 'D' | 'F' | 'B' | 'L' | 'R';

const FACES: FaceKey[] = ['U', 'D', 'F', 'B', 'L', 'R'];

const NORMAL: Record<FaceKey, Vec> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  L: [-1, 0, 0],
  R: [1, 0, 0],
};

/** Same move table RubiksCube.executeMove uses. */
const MOVE_GEOMETRY: Record<MoveType, { axis: 'x' | 'y' | 'z'; layer: number; dir: number }> = {
  'R': { axis: 'x', layer: 1, dir: -1 },
  "R'": { axis: 'x', layer: 1, dir: 1 },
  'L': { axis: 'x', layer: -1, dir: 1 },
  "L'": { axis: 'x', layer: -1, dir: -1 },
  'U': { axis: 'y', layer: 1, dir: -1 },
  "U'": { axis: 'y', layer: 1, dir: 1 },
  'D': { axis: 'y', layer: -1, dir: 1 },
  "D'": { axis: 'y', layer: -1, dir: -1 },
  'F': { axis: 'z', layer: 1, dir: -1 },
  "F'": { axis: 'z', layer: 1, dir: 1 },
  'B': { axis: 'z', layer: -1, dir: 1 },
  "B'": { axis: 'z', layer: -1, dir: -1 },
  'M': { axis: 'x', layer: 0, dir: 1 },
  "M'": { axis: 'x', layer: 0, dir: -1 },
  'E': { axis: 'y', layer: 0, dir: 1 },
  "E'": { axis: 'y', layer: 0, dir: -1 },
  'S': { axis: 'z', layer: 0, dir: -1 },
  "S'": { axis: 'z', layer: 0, dir: 1 },
};

/** Rotate a vector by ±90° around a principal axis (matches THREE's convention). */
function rotate(v: Vec, axis: 'x' | 'y' | 'z', dir: number): Vec {
  const [x, y, z] = v;
  const c = 0;
  const s = dir; // sin(dir · 90°)
  switch (axis) {
    case 'x': return [x, y * c - z * s, y * s + z * c];
    case 'y': return [x * c + z * s, y, -x * s + z * c];
    case 'z': return [x * c - y * s, x * s + y * c, z];
  }
}

function faceOfNormal(n: Vec): FaceKey | null {
  for (const face of FACES) {
    const m = NORMAL[face];
    if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) return face;
  }
  return null;
}

function onFace(p: Vec, face: FaceKey): boolean {
  switch (face) {
    case 'U': return p[1] === 1;
    case 'D': return p[1] === -1;
    case 'F': return p[2] === 1;
    case 'B': return p[2] === -1;
    case 'L': return p[0] === -1;
    case 'R': return p[0] === 1;
  }
}

/** Sticker slot 0-8, identical to RubiksCube's mapping. */
function slot(p: Vec, face: FaceKey): number {
  const [x, y, z] = p;
  let row = 0, col = 0;
  switch (face) {
    case 'U': row = z + 1; col = x + 1; break;
    case 'D': row = 1 - z; col = x + 1; break;
    case 'F': row = 1 - y; col = x + 1; break;
    case 'B': row = 1 - y; col = 1 - x; break;
    case 'L': row = 1 - y; col = z + 1; break;
    case 'R': row = 1 - y; col = 1 - z; break;
  }
  return row * 3 + col;
}

/**
 * A cubie: where it sits, and where each of its stickers now points.
 * `stickers` maps the sticker's colour to its current outward direction.
 */
interface Cubie {
  pos: Vec;
  stickers: { label: string; dir: Vec }[];
}

/**
 * Every one of the 54 stickers gets a unique label, so the comparison catches
 * stickers that land on the right face but in the wrong slot — a solved cube
 * would hide those.
 */
function labelledState(): CubeStateData {
  const state = createSolvedState();
  for (const face of FACES) {
    state[face] = Array.from({ length: 9 }, (_, i) => `${face}${i}` as unknown as FaceColor);
  }
  return state;
}

function labelledCubies(): Cubie[] {
  const out: Cubie[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const pos: Vec = [x, y, z];
        const stickers = FACES.filter(f => onFace(pos, f))
          .map(f => ({ label: `${f}${slot(pos, f)}`, dir: NORMAL[f] }));
        out.push({ pos, stickers });
      }
    }
  }
  return out;
}

/** Turn a set of cubies into the per-face state the renderer would read. */
function readState(cubies: Cubie[]): CubeStateData {
  const state = createSolvedState();
  for (const face of FACES) {
    const labels: string[] = Array(9).fill('--');
    for (const cubie of cubies) {
      if (!onFace(cubie.pos, face)) continue;
      const sticker = cubie.stickers.find(s => faceOfNormal(s.dir) === face);
      if (sticker) labels[slot(cubie.pos, face)] = sticker.label;
    }
    state[face] = labels as unknown as FaceColor[];
  }
  return state;
}

function applyGeometrically(cubies: Cubie[], move: MoveType): Cubie[] {
  const { axis, layer, dir } = MOVE_GEOMETRY[move];
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  return cubies.map(cubie => {
    if (cubie.pos[index] !== layer) return cubie;
    return {
      pos: rotate(cubie.pos, axis, dir),
      stickers: cubie.stickers.map(s => ({ label: s.label, dir: rotate(s.dir, axis, dir) })),
    };
  });
}

function diff(a: CubeStateData, b: CubeStateData): string[] {
  const problems: string[] = [];
  for (const face of FACES) {
    if (a[face].join(' ') !== b[face].join(' ')) {
      problems.push(`${face}\n            state    ${a[face].join(' ')}\n            geometry ${b[face].join(' ')}`);
    }
  }
  return problems;
}

let failures = 0;
for (const move of Object.keys(MOVE_GEOMETRY) as MoveType[]) {
  const fromState = applyMove(labelledState(), move);
  const fromGeometry = readState(applyGeometrically(labelledCubies(), move));
  const problems = diff(fromState, fromGeometry);
  if (problems.length === 0) {
    console.log(`  ok    ${move}`);
  } else {
    failures++;
    console.log(`  FAIL  ${move}`);
    for (const p of problems) console.log(`          ${p}`);
  }
}

console.log(failures === 0
  ? '\nAll 18 moves agree between CubeState and the cube geometry.'
  : `\n${failures} move(s) disagree — the force layer would paint wrong colours.`);
process.exit(failures === 0 ? 0 : 1);
