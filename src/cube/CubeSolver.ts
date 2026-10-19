import Cube from 'cubejs';
import { createSolvedState, CubeStateData, inverseMove, MoveType } from './CubeState';
import { assertCubeState } from './CubeValidity';
import { applyMoves, orientCenters } from './CubeOrientation';
export { applyMoves } from './CubeOrientation';

let initialized = false;
export function solveState(state: CubeStateData): MoveType[] {
  assertCubeState(state);
  const oriented = orientCenters(state);
  if (!initialized) { Cube.initSolver(); initialized = true; }
  const facelets = (['U','R','F','D','L','B'] as const).map(f => oriented.state[f].join('')).join('');
  const algorithm = Cube.fromString(facelets).solve().trim();
  const moves = algorithm ? algorithm.split(/\s+/).flatMap(token => {
    if (!/^[URFDLB](2|')?$/.test(token)) throw new Error('Neplatný výsledok riešiča.');
    return token.endsWith('2') ? [token[0] as MoveType, token[0] as MoveType] : [token as MoveType];
  }) : [];
  const solution = [...oriented.moves, ...moves];
  if (JSON.stringify(applyMoves(state, solution)) !== JSON.stringify(createSolvedState())) {
    throw new Error('Riešenie neprešlo kontrolou.');
  }
  return solution;
}

export function planTransition(from: CubeStateData, to = createSolvedState()): MoveType[] {
  assertCubeState(from); assertCubeState(to);
  if (JSON.stringify(from) === JSON.stringify(to)) return [];
  const moves = [...solveState(from), ...solveState(to).reverse().map(inverseMove)];
  // Cancel adjacent inverse moves to avoid an unnecessary pause at solved.
  const result: MoveType[] = [];
  for (const move of moves) {
    if (result.at(-1) === inverseMove(move)) result.pop(); else result.push(move);
  }
  return result;
}
