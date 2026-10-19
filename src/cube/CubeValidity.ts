import { CubeStateData, FaceKey } from './CubeState';
import { FACE_KEYS, FACE_NORMAL } from './CubeLayout';

export type Sticker = [FaceKey, number];
export const CORNERS: Sticker[][] = [
  [['U',8],['R',0],['F',2]], [['U',6],['F',0],['L',2]],
  [['U',0],['L',0],['B',2]], [['U',2],['B',0],['R',2]],
  [['D',2],['F',8],['R',6]], [['D',0],['L',8],['F',6]],
  [['D',6],['B',8],['L',6]], [['D',8],['R',8],['B',6]],
];
export const EDGES: Sticker[][] = [
  [['U',5],['R',1]], [['U',7],['F',1]], [['U',3],['L',1]], [['U',1],['B',1]],
  [['D',5],['R',7]], [['D',1],['F',7]], [['D',3],['L',7]], [['D',7],['B',7]],
  [['F',5],['R',3]], [['F',3],['L',5]], [['B',5],['L',3]], [['B',3],['R',5]],
];
const parity = (p: number[]) => p.reduce((n, v, i) =>
  n + p.slice(i + 1).filter(w => v > w).length, 0) % 2;

/** Includes slice moves: centres may rotate together, but cannot be reflected. */
export function cubeStateError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'Chýba stav kocky.';
  const s = value as CubeStateData;
  const counts = new Map<string, number>();
  for (const f of FACE_KEYS) {
    if (!Array.isArray(s[f]) || s[f].length !== 9) return 'Každá stena musí mať 9 nálepiek.';
    for (const c of s[f]) {
      if (!FACE_KEYS.includes(c as FaceKey)) return 'Neplatná farba nálepky.';
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  if (FACE_KEYS.some(f => counts.get(f) !== 9)) return 'Každá farba musí byť na kocke práve 9-krát.';
  const centers = FACE_KEYS.map(f => s[f][4] as FaceKey);
  if (new Set(centers).size !== 6) return 'Stredy stien sa nesmú opakovať.';
  const dot = (a: number[], b: number[]) => a.reduce((n, x, i) => n + x * b[i], 0);
  for (const a of FACE_KEYS) for (const b of FACE_KEYS) {
    if (dot(FACE_NORMAL[a], FACE_NORMAL[b]) !==
        dot(FACE_NORMAL[s[a][4] as FaceKey], FACE_NORMAL[s[b][4] as FaceKey])) {
      return 'Nesprávne protiľahlé stredy.';
    }
  }
  const r = FACE_NORMAL[s.R[4] as FaceKey];
  const u = FACE_NORMAL[s.U[4] as FaceKey];
  const f = FACE_NORMAL[s.F[4] as FaceKey];
  if (dot([r[1]*u[2]-r[2]*u[1], r[2]*u[0]-r[0]*u[2], r[0]*u[1]-r[1]*u[0]], f) !== 1) {
    return 'Zrkadlové rozloženie stredov nie je možné.';
  }
  const names = Object.fromEntries(FACE_KEYS.map(f => [s[f][4], f]));
  const read = (slots: Sticker[]) => slots.map(([f,i]) => names[s[f][i]]);
  const cp: number[] = [], ep: number[] = [];
  let twist = 0, flip = 0;
  for (const slots of CORNERS) {
    const colors = read(slots);
    const ori = colors.findIndex(c => c === 'U' || c === 'D');
    if (ori < 0) return 'Neplatný rohový dielik.';
    const piece = CORNERS.findIndex(p => p.every(([f], i) => f === colors[(i + ori) % 3]));
    if (piece < 0) return 'Neplatný alebo zrkadlový rohový dielik.';
    cp.push(piece);
    twist += ori;
  }
  for (const slots of EDGES) {
    const colors = read(slots);
    let piece = EDGES.findIndex(p => p.every(([f], i) => f === colors[i]));
    if (piece < 0) {
      piece = EDGES.findIndex(p => p.every(([f], i) => f === colors[1-i]));
      flip++;
    }
    if (piece < 0) return 'Neplatný hranový dielik.';
    ep.push(piece);
  }
  if (new Set(cp).size !== 8 || new Set(ep).size !== 12) return 'Dieliky kocky sa nesmú opakovať.';
  if (twist % 3) return 'Samostatne pretočený roh nie je dosiahnuteľný ťahmi.';
  if (flip % 2) return 'Samostatne prevrátená hrana nie je dosiahnuteľná ťahmi.';
  if (parity(cp) !== parity(ep)) return 'Nesprávna parita rohov a hrán.';
  return null;
}

export function assertCubeState(value: unknown): asserts value is CubeStateData {
  const error = cubeStateError(value);
  if (error) throw new Error(error);
}
