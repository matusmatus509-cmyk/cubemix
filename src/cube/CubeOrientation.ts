import { applyMove, CubeStateData, MoveType } from './CubeState';
export const applyMoves = (s: CubeStateData, moves: MoveType[]) => moves.reduce(applyMove, s);
export const centerKey = (s: CubeStateData) => (['U','R','F','D','L','B'] as const).map(f => s[f][4]).join('');
const rotations: MoveType[][] = [['R', "L'", "M'"], ['U', "D'", "E'"], ['F', "B'", 'S']];
export function orientCenters(state: CubeStateData, desired = 'URFDLB'): {state: CubeStateData; moves: MoveType[]} {
  const queue = [{state, moves: [] as MoveType[]}], seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i], key = centerKey(item.state);
    if (key === desired) return item;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const r of rotations) queue.push({state: applyMoves(item.state, r), moves: [...item.moves, ...r]});
  }
  throw new Error('Neplatné rozloženie stredov.');
}
