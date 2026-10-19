import assert from 'node:assert/strict';
import { applyMove, createSolvedState, inverseMove, MoveType } from '../src/cube/CubeState';
import { assertCubeState, cubeStateError } from '../src/cube/CubeValidity';
import { cubeStateToSnapshot, snapshotToCubeState } from '../src/cube/RubiksCube';

const solved = createSolvedState();
assertCubeState(solved);
for (const malformed of [null, [], {}, {U: []}, {...solved, R: ['X']}, {...solved, U: Array(9).fill('R')}]) {
  assert.ok(cubeStateError(malformed));
}
const flipped = structuredClone(solved);
[flipped.U[5], flipped.R[1]] = [flipped.R[1], flipped.U[5]];
assert.match(cubeStateError(flipped)!, /hrana/);
const twisted = structuredClone(solved);
[twisted.U[8], twisted.R[0], twisted.F[2]] = [twisted.R[0], twisted.F[2], twisted.U[8]];
assert.match(cubeStateError(twisted)!, /roh/);
const mirrored = structuredClone(solved);
[mirrored.R[0], mirrored.F[2]] = [mirrored.F[2], mirrored.R[0]];
assert.ok(cubeStateError(mirrored));
const swapped = structuredClone(solved);
[swapped.R[1], swapped.F[1]] = [swapped.F[1], swapped.R[1]];
assert.match(cubeStateError(swapped)!, /parita/);
const reflectedCenters = structuredClone(solved);
[reflectedCenters.R, reflectedCenters.L] = [reflectedCenters.L, reflectedCenters.R];
assert.ok(cubeStateError(reflectedCenters));
let seed = 42;
const moves: MoveType[] = ['U', "U'", 'D', "D'", 'F', "F'", 'B', "B'", 'L', "L'", 'R', "R'", 'M', "M'", 'E', "E'", 'S', "S'"];
let state = solved;
for (let i = 0; i < 10000; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const move = moves[seed % moves.length];
  const before = structuredClone(state);
  state = applyMove(state, move);
  assertCubeState(state);
  assert.deepEqual(applyMove(state, inverseMove(move)), before);
  if (i % 50 === 0) assert.deepEqual(snapshotToCubeState(cubeStateToSnapshot(state)), state);
}
const snapshot = cubeStateToSnapshot(solved);
assert.throws(() => snapshotToCubeState(snapshot.slice(1)));
const duplicate = structuredClone(snapshot);
duplicate[0] = duplicate[1];
assert.throws(() => snapshotToCubeState(duplicate));
const badQuaternion = structuredClone(snapshot);
badQuaternion[0].quaternion.w = NaN;
assert.throws(() => snapshotToCubeState(badQuaternion));
console.log('Validity: 10,000 legal states/inverses, 200 snapshot round trips and impossible/corrupt states passed.');
