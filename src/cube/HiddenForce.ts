import { CubeStateData, FaceColor, FaceKey } from './CubeState';
import { cloneCubeState, FACE_KEYS } from './CubeLayout';
import { assertCubeState, CORNERS, EDGES, Sticker } from './CubeValidity';
import { centerKey, orientCenters } from './CubeOrientation';

export type FaceDots = Record<FaceKey, number>;
// Edge-on faces remain protected, including a margin for rounding/perspective.
export const isFaceHidden = (dot: number) => dot > 0.04;
interface Candidate { piece: number; orientation: number; colors: FaceColor[]; score: number }
interface Path { score: number; previous: Path | null; candidate: Candidate | null }

/** Constrained cubie assignment, with twist/flip sums and permutation parity. */
function completePieces(slots: Sticker[][], current: CubeStateData, target: CubeStateData, dots: FaceDots): [Path | undefined, Path | undefined] {
  const width = slots[0].length;
  const choices = slots.map(position => slots.flatMap((pieceSlots, piece) =>
    Array.from({length: width}, (_, orientation): Candidate | null => {
      const colors = Array<FaceColor>(width);
      pieceSlots.forEach(([face], i) => { colors[(i + orientation) % width] = current[face][4]; });
      if (position.some(([face,index], i) => !isFaceHidden(dots[face]) && current[face][index] !== colors[i])) return null;
      const score = position.reduce((n,[face,index],i) => n + (colors[i] === target[face][index] ? 100 : 0) + (colors[i] === current[face][index] ? 1 : 0), 0);
      return {piece, orientation, colors, score};
    }).filter((c): c is Candidate => c !== null)));
  // key = ((used-piece mask * width + orientation sum) * 2 + parity)
  let states = new Map<number, Path>([[0, {score:0, previous:null, candidate:null}]]);
  for (const candidates of choices) {
    const next = new Map<number, Path>();
    for (const [key, path] of states) {
      const parity = key % 2, sum = Math.floor(key / 2) % width, mask = Math.floor(key / (2 * width));
      for (const c of candidates) {
        if (mask & (1 << c.piece)) continue;
        let inversions = 0;
        for (let j = c.piece + 1; j < slots.length; j++) if (mask & (1 << j)) inversions++;
        const nextKey = (((mask | (1 << c.piece)) * width + (sum + c.orientation) % width) * 2 + ((parity + inversions) % 2));
        const score = path.score + c.score;
        if (!next.has(nextKey) || next.get(nextKey)!.score < score) next.set(nextKey, {score, previous:path, candidate:c});
      }
    }
    states = next;
  }
  const finalKey = ((1 << slots.length) - 1) * width * 2;
  return [states.get(finalKey), states.get(finalKey + 1)];
}

/** Closest reachable target completion that leaves every visible sticker intact. */
export function completeHiddenState(current: CubeStateData, target: CubeStateData, dots: FaceDots): CubeStateData {
  assertCubeState(current); assertCubeState(target);
  const aligned = orientCenters(target, centerKey(current)).state;
  const corners = completePieces(CORNERS, current, aligned, dots);
  const edges = completePieces(EDGES, current, aligned, dots);
  const scores = [0,1].map(p => corners[p] && edges[p] ? corners[p]!.score + edges[p]!.score : -Infinity);
  const p = scores[1] > scores[0] ? 1 : 0;
  if (!Number.isFinite(scores[p])) return cloneCubeState(current);
  const state = cloneCubeState(current);
  for (const [slots, end] of [[CORNERS, corners[p]], [EDGES, edges[p]]] as const) {
    let path = end!;
    for (let i = slots.length - 1; i >= 0; i--) {
      const colors = path.candidate!.colors;
      slots[i].forEach(([face,index], j) => { state[face][index] = colors[j]; });
      path = path.previous!;
    }
  }
  assertCubeState(state);
  // Defence in depth: no future optimisation may loosen visibility constraints.
  for (const f of FACE_KEYS) if (!isFaceHidden(dots[f]) && state[f].some((c,i) => c !== current[f][i])) {
    throw new Error('Force nesmie zmeniť viditeľné nálepky.');
  }
  return state;
}
