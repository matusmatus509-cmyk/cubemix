// Rubik's Cube State Management
// Faces: 0=U(white), 1=D(yellow), 2=F(green), 3=B(blue), 4=L(orange), 5=R(red)

export const FACE_COLORS: Record<string, string> = {
  U: '#ffffff', // white
  D: '#ffd500', // yellow — classic bright golden-yellow
  F: '#009b48', // green
  B: '#0051ad', // blue
  L: '#ff5800', // orange — vivid classic orange
  R: '#c41e3a', // red — classic deeper red
  X: '#111111', // black (inner)
};

export type FaceColor = 'U' | 'D' | 'F' | 'B' | 'L' | 'R' | 'X';

// Each face has 9 stickers indexed 0-8 (top-left to bottom-right)
export interface CubeStateData {
  U: FaceColor[]; // top
  D: FaceColor[]; // bottom
  F: FaceColor[]; // front
  B: FaceColor[]; // back
  L: FaceColor[]; // left
  R: FaceColor[]; // right
}

export type MoveType =
  | 'U' | "U'" | 'D' | "D'" | 'F' | "F'" | 'B' | "B'"
  | 'L' | "L'" | 'R' | "R'"
  | 'M' | "M'" | 'E' | "E'" | 'S' | "S'";

function makeFace(color: FaceColor): FaceColor[] {
  return Array(9).fill(color);
}

export function createSolvedState(): CubeStateData {
  return {
    U: makeFace('U'),
    D: makeFace('D'),
    F: makeFace('F'),
    B: makeFace('B'),
    L: makeFace('L'),
    R: makeFace('R'),
  };
}

function rotateFaceCW(face: FaceColor[]): FaceColor[] {
  return [
    face[6], face[3], face[0],
    face[7], face[4], face[1],
    face[8], face[5], face[2],
  ];
}

function rotateFaceCCW(face: FaceColor[]): FaceColor[] {
  return [
    face[2], face[5], face[8],
    face[1], face[4], face[7],
    face[0], face[3], face[6],
  ];
}

function cloneState(state: CubeStateData): CubeStateData {
  return {
    U: [...state.U],
    D: [...state.D],
    F: [...state.F],
    B: [...state.B],
    L: [...state.L],
    R: [...state.R],
  };
}

// Move implementations

// U face clockwise (seen from above): the top rows travel F → L → B → R → F,
// the same direction rotateFaceCW turns the U grid itself.
function moveU(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.U = rotateFaceCW(state.U);
  [s.L[0], s.L[1], s.L[2]] = [state.F[0], state.F[1], state.F[2]];
  [s.B[0], s.B[1], s.B[2]] = [state.L[0], state.L[1], state.L[2]];
  [s.R[0], s.R[1], s.R[2]] = [state.B[0], state.B[1], state.B[2]];
  [s.F[0], s.F[1], s.F[2]] = [state.R[0], state.R[1], state.R[2]];
  return s;
}

function moveUPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.U = rotateFaceCCW(state.U);
  [s.R[0], s.R[1], s.R[2]] = [state.F[0], state.F[1], state.F[2]];
  [s.B[0], s.B[1], s.B[2]] = [state.R[0], state.R[1], state.R[2]];
  [s.L[0], s.L[1], s.L[2]] = [state.B[0], state.B[1], state.B[2]];
  [s.F[0], s.F[1], s.F[2]] = [state.L[0], state.L[1], state.L[2]];
  return s;
}

// D face clockwise (seen from below): the bottom rows travel F → R → B → L → F.
function moveD(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.D = rotateFaceCW(state.D);
  [s.R[6], s.R[7], s.R[8]] = [state.F[6], state.F[7], state.F[8]];
  [s.B[6], s.B[7], s.B[8]] = [state.R[6], state.R[7], state.R[8]];
  [s.L[6], s.L[7], s.L[8]] = [state.B[6], state.B[7], state.B[8]];
  [s.F[6], s.F[7], s.F[8]] = [state.L[6], state.L[7], state.L[8]];
  return s;
}

function moveDPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.D = rotateFaceCCW(state.D);
  [s.L[6], s.L[7], s.L[8]] = [state.F[6], state.F[7], state.F[8]];
  [s.B[6], s.B[7], s.B[8]] = [state.L[6], state.L[7], state.L[8]];
  [s.R[6], s.R[7], s.R[8]] = [state.B[6], state.B[7], state.B[8]];
  [s.F[6], s.F[7], s.F[8]] = [state.R[6], state.R[7], state.R[8]];
  return s;
}

// F face clockwise
function moveF(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.F = rotateFaceCW(state.F);
  [s.R[0], s.R[3], s.R[6]] = [state.U[6], state.U[7], state.U[8]];
  [s.D[2], s.D[1], s.D[0]] = [state.R[0], state.R[3], state.R[6]];
  [s.L[8], s.L[5], s.L[2]] = [state.D[2], state.D[1], state.D[0]];
  [s.U[6], s.U[7], s.U[8]] = [state.L[8], state.L[5], state.L[2]];
  return s;
}

function moveFPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.F = rotateFaceCCW(state.F);
  [s.L[8], s.L[5], s.L[2]] = [state.U[6], state.U[7], state.U[8]];
  [s.D[2], s.D[1], s.D[0]] = [state.L[8], state.L[5], state.L[2]];
  [s.R[0], s.R[3], s.R[6]] = [state.D[2], state.D[1], state.D[0]];
  [s.U[6], s.U[7], s.U[8]] = [state.R[0], state.R[3], state.R[6]];
  return s;
}

// B face clockwise
function moveB(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.B = rotateFaceCW(state.B);
  [s.L[0], s.L[3], s.L[6]] = [state.U[2], state.U[1], state.U[0]];
  [s.D[6], s.D[7], s.D[8]] = [state.L[0], state.L[3], state.L[6]];
  [s.R[8], s.R[5], s.R[2]] = [state.D[6], state.D[7], state.D[8]];
  [s.U[2], s.U[1], s.U[0]] = [state.R[8], state.R[5], state.R[2]];
  return s;
}

function moveBPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.B = rotateFaceCCW(state.B);
  [s.R[8], s.R[5], s.R[2]] = [state.U[2], state.U[1], state.U[0]];
  [s.D[6], s.D[7], s.D[8]] = [state.R[8], state.R[5], state.R[2]];
  [s.L[0], s.L[3], s.L[6]] = [state.D[6], state.D[7], state.D[8]];
  [s.U[2], s.U[1], s.U[0]] = [state.L[0], state.L[3], state.L[6]];
  return s;
}

// L face clockwise
function moveL(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.L = rotateFaceCW(state.L);
  [s.F[0], s.F[3], s.F[6]] = [state.U[0], state.U[3], state.U[6]];
  [s.D[0], s.D[3], s.D[6]] = [state.F[0], state.F[3], state.F[6]];
  [s.B[8], s.B[5], s.B[2]] = [state.D[0], state.D[3], state.D[6]];
  [s.U[0], s.U[3], s.U[6]] = [state.B[8], state.B[5], state.B[2]];
  return s;
}

function moveLPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.L = rotateFaceCCW(state.L);
  [s.B[8], s.B[5], s.B[2]] = [state.U[0], state.U[3], state.U[6]];
  [s.D[0], s.D[3], s.D[6]] = [state.B[8], state.B[5], state.B[2]];
  [s.F[0], s.F[3], s.F[6]] = [state.D[0], state.D[3], state.D[6]];
  [s.U[0], s.U[3], s.U[6]] = [state.F[0], state.F[3], state.F[6]];
  return s;
}

// R face clockwise
function moveR(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.R = rotateFaceCW(state.R);
  [s.B[6], s.B[3], s.B[0]] = [state.U[2], state.U[5], state.U[8]];
  [s.D[2], s.D[5], s.D[8]] = [state.B[6], state.B[3], state.B[0]];
  [s.F[2], s.F[5], s.F[8]] = [state.D[2], state.D[5], state.D[8]];
  [s.U[2], s.U[5], s.U[8]] = [state.F[2], state.F[5], state.F[8]];
  return s;
}

function moveRPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  s.R = rotateFaceCCW(state.R);
  [s.F[2], s.F[5], s.F[8]] = [state.U[2], state.U[5], state.U[8]];
  [s.D[2], s.D[5], s.D[8]] = [state.F[2], state.F[5], state.F[8]];
  [s.B[6], s.B[3], s.B[0]] = [state.D[2], state.D[5], state.D[8]];
  [s.U[2], s.U[5], s.U[8]] = [state.B[6], state.B[3], state.B[0]];
  return s;
}

// Middle slice moves (M, E, S)
// M - middle slice (between L and R), same direction as L
function moveM(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  [s.F[1], s.F[4], s.F[7]] = [state.U[1], state.U[4], state.U[7]];
  [s.D[1], s.D[4], s.D[7]] = [state.F[1], state.F[4], state.F[7]];
  [s.B[7], s.B[4], s.B[1]] = [state.D[1], state.D[4], state.D[7]];
  [s.U[1], s.U[4], s.U[7]] = [state.B[7], state.B[4], state.B[1]];
  return s;
}

function moveMPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  [s.B[7], s.B[4], s.B[1]] = [state.U[1], state.U[4], state.U[7]];
  [s.D[1], s.D[4], s.D[7]] = [state.B[7], state.B[4], state.B[1]];
  [s.F[1], s.F[4], s.F[7]] = [state.D[1], state.D[4], state.D[7]];
  [s.U[1], s.U[4], s.U[7]] = [state.F[1], state.F[4], state.F[7]];
  return s;
}

// E - equatorial slice (between U and D), same direction as D: F → R → B → L → F
function moveE(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  [s.R[3], s.R[4], s.R[5]] = [state.F[3], state.F[4], state.F[5]];
  [s.B[3], s.B[4], s.B[5]] = [state.R[3], state.R[4], state.R[5]];
  [s.L[3], s.L[4], s.L[5]] = [state.B[3], state.B[4], state.B[5]];
  [s.F[3], s.F[4], s.F[5]] = [state.L[3], state.L[4], state.L[5]];
  return s;
}

function moveEPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  [s.L[3], s.L[4], s.L[5]] = [state.F[3], state.F[4], state.F[5]];
  [s.B[3], s.B[4], s.B[5]] = [state.L[3], state.L[4], state.L[5]];
  [s.R[3], s.R[4], s.R[5]] = [state.B[3], state.B[4], state.B[5]];
  [s.F[3], s.F[4], s.F[5]] = [state.R[3], state.R[4], state.R[5]];
  return s;
}

// S - standing slice (between F and B), same direction as F
function moveS(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  [s.R[1], s.R[4], s.R[7]] = [state.U[3], state.U[4], state.U[5]];
  [s.D[5], s.D[4], s.D[3]] = [state.R[1], state.R[4], state.R[7]];
  [s.L[7], s.L[4], s.L[1]] = [state.D[5], state.D[4], state.D[3]];
  [s.U[3], s.U[4], s.U[5]] = [state.L[7], state.L[4], state.L[1]];
  return s;
}

function moveSPrime(state: CubeStateData): CubeStateData {
  const s = cloneState(state);
  [s.L[7], s.L[4], s.L[1]] = [state.U[3], state.U[4], state.U[5]];
  [s.D[5], s.D[4], s.D[3]] = [state.L[7], state.L[4], state.L[1]];
  [s.R[1], s.R[4], s.R[7]] = [state.D[5], state.D[4], state.D[3]];
  [s.U[3], s.U[4], s.U[5]] = [state.R[1], state.R[4], state.R[7]];
  return s;
}

export function applyMove(state: CubeStateData, move: MoveType): CubeStateData {
  switch (move) {
    case 'U': return moveU(state);
    case "U'": return moveUPrime(state);
    case 'D': return moveD(state);
    case "D'": return moveDPrime(state);
    case 'F': return moveF(state);
    case "F'": return moveFPrime(state);
    case 'B': return moveB(state);
    case "B'": return moveBPrime(state);
    case 'L': return moveL(state);
    case "L'": return moveLPrime(state);
    case 'R': return moveR(state);
    case "R'": return moveRPrime(state);
    case 'M': return moveM(state);
    case "M'": return moveMPrime(state);
    case 'E': return moveE(state);
    case "E'": return moveEPrime(state);
    case 'S': return moveS(state);
    case "S'": return moveSPrime(state);
    default: return state;
  }
}

export function isSolved(state: CubeStateData): boolean {
  const faces: (keyof CubeStateData)[] = ['U', 'D', 'F', 'B', 'L', 'R'];
  for (const face of faces) {
    const color = state[face][0];
    for (let i = 1; i < 9; i++) {
      if (state[face][i] !== color) return false;
    }
  }
  return true;
}

export function inverseMove(move: MoveType): MoveType {
  const inverses: Record<MoveType, MoveType> = {
    'U': "U'", "U'": 'U',
    'D': "D'", "D'": 'D',
    'F': "F'", "F'": 'F',
    'B': "B'", "B'": 'B',
    'L': "L'", "L'": 'L',
    'R': "R'", "R'": 'R',
    'M': "M'", "M'": 'M',
    'E': "E'", "E'": 'E',
    'S': "S'", "S'": 'S',
  };
  return inverses[move];
}

export type FaceKey = 'U' | 'D' | 'F' | 'B' | 'L' | 'R';

export function setFaceColors(state: CubeStateData, face: FaceKey, colors: FaceColor[]): CubeStateData {
  const s = cloneState(state);
  s[face] = [...colors];
  return s;
}

export function getFaceColors(state: CubeStateData, face: FaceKey): FaceColor[] {
  return [...state[face]];
}
