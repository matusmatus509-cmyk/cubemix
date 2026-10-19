import assert from 'node:assert/strict';
import { ForceLayer, MIN_TURNS_BEFORE_ROTATION } from '../src/cube/ForceLayer';
import { applyMove, createSolvedState } from '../src/cube/CubeState';
import { applyMoves } from '../src/cube/CubeOrientation';
import { planTransition } from '../src/cube/CubeSolver';
import { assertCubeState } from '../src/cube/CubeValidity';
import { FACE_KEYS } from '../src/cube/CubeLayout';
import { completeHiddenState, FaceDots, isFaceHidden } from '../src/cube/HiddenForce';

const force = new ForceLayer();
const target = applyMoves(createSolvedState(), ['R', 'U', "F'", 'M', 'E']);
const original = structuredClone(target);
force.arm(target);
target.F[0] = 'X';
assert.deepEqual(force.configuredState(), original);
assert.equal(force.isRotationLocked(), false);
const dots: FaceDots = {U:-0.6,F:-0.6,R:-0.6,D:0.6,B:0.6,L:0.6};
assert.equal(force.evaluate(createSolvedState(), dots), null, 'no force before mixing');
for (let i = 0; i < MIN_TURNS_BEFORE_ROTATION; i++) force.noteTurn();
assert.equal(force.isReady(), true);
let seed = 0x12345678;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2**32; };
const choices = ['U', "D'", 'R', 'L', 'F', "B'", 'M', 'E', 'S'] as const;
let changed = 0;
for (let run = 0; run < 80; run++) {
  let state = createSolvedState();
  let destination = createSolvedState();
  for (let i = 0; i < 20; i++) {
    state = applyMove(state, choices[Math.floor(random()*choices.length)]);
    destination = applyMove(destination, choices[Math.floor(random()*choices.length)]);
  }
  // Perspective camera may see one, two or three faces, including edge-on faces.
  const facing: FaceDots = {U:random() < 0.5 ? -.5 : .5,D:0,F:random() < 0.5 ? -.5 : .5,B:0,L:random() < 0.5 ? -.5 : .5,R:0};
  facing.D = -facing.U; facing.B = -facing.F; facing.R = -facing.L;
  if (run % 3 === 0) { facing.U = 0; facing.D = .02; }
  const before = structuredClone(state);
  const next = completeHiddenState(state, destination, facing);
  assertCubeState(next);
  for (const f of FACE_KEYS) if (!isFaceHidden(facing[f])) assert.deepEqual(next[f], before[f], 'visible/edge-on stickers must never change');
  if (JSON.stringify(next) !== JSON.stringify(before)) changed++;
  assert.deepEqual(completeHiddenState(next, destination, facing), next, 'same view must be stable');
  if (run < 8) {
    const solve = planTransition(next);
    assert.deepEqual(applyMoves(next, solve), createSolvedState(), 'Solve works after hidden force commits');
  }
}
assert.ok(changed > 0, 'force must make useful hidden progress');
// Construct an exactly reachable hidden force: two unobserved edges can flip together.
const reachable = createSolvedState();
[reachable.D[7],reachable.B[7]] = [reachable.B[7],reachable.D[7]];
[reachable.B[5],reachable.L[3]] = [reachable.L[3],reachable.B[5]];
assertCubeState(reachable);
const start = createSolvedState();
force.arm(reachable);
for (let i = 0; i < 5; i++) force.noteTurn();
assert.deepEqual(force.evaluate(start,dots), reachable, 'deliver an exactly compatible preset');
assert.equal(force.isArmed(), false);
force.noteTurn(); assert.equal(force.isArmed(), true);
assert.equal(force.isReady(), false);
const bad = createSolvedState();
[bad.U[5], bad.R[1]] = [bad.R[1], bad.U[5]];
assert.throws(() => force.arm(bad));
assert.deepEqual(force.configuredState(), reachable, 'rejected target preserves force');
force.clear(); assert.equal(force.isConfigured(), false);
console.log(`Force: 80 legal hidden completions (${changed} made progress), visible/edge-on invariance, stability, exact delivery, re-arm and post-force solving passed.`);
