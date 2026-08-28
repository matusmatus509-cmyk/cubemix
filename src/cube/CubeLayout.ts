// Sticker layout of the cube: which cubie sits on which face, and which of the
// nine slots of that face it fills. Deliberately free of any three.js import so
// both the renderer and plain logic (and tests) can share one definition.

import { CubeStateData, FaceKey } from './CubeState';

export const FACE_KEYS: FaceKey[] = ['U', 'D', 'F', 'B', 'L', 'R'];

/** Outward normal of every cube face, in cube-local space. */
export const FACE_NORMAL: Record<FaceKey, [number, number, number]> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  L: [-1, 0, 0],
  R: [1, 0, 0],
};

export interface LogicalPos {
  x: number;
  y: number;
  z: number;
}

/** True when a cubie at this logical position carries a sticker on `face`. */
export function cubieOnFace(x: number, y: number, z: number, face: FaceKey): boolean {
  switch (face) {
    case 'U': return y === 1;
    case 'D': return y === -1;
    case 'F': return z === 1;
    case 'B': return z === -1;
    case 'L': return x === -1;
    case 'R': return x === 1;
  }
}

/**
 * Sticker slot (0-8) a cubie at this logical position occupies on `face`.
 *
 * This is the single source of truth for the layout, and it has to agree with
 * the layout CubeState's moves assume: U is read back row first and D front row
 * first, the way the two faces sit on an unfolded cube net. Getting either of
 * them backwards makes a turn permute the stickers one way and the state the
 * other, which shows up as scrambled colours the moment anything is repainted.
 *
 * `scripts/verify-move-consistency.ts` checks that agreement for all 18 moves.
 */
export function stickerIndexOnFace(x: number, y: number, z: number, face: FaceKey): number {
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

/** The 9 logical positions that make up `face`. */
export function faceCubiePositions(face: FaceKey): LogicalPos[] {
  const out: LogicalPos[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (cubieOnFace(x, y, z, face)) out.push({ x, y, z });
      }
    }
  }
  return out;
}

export function cloneCubeState(state: CubeStateData): CubeStateData {
  return {
    U: [...state.U], D: [...state.D], F: [...state.F],
    B: [...state.B], L: [...state.L], R: [...state.R],
  };
}
