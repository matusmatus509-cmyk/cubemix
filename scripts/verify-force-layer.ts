import assert from 'node:assert/strict';
import { ForceLayer, FaceDots, isFaceHidden } from '../src/cube/ForceLayer';
import { applyMove, createSolvedState, CubeStateData, MoveType } from '../src/cube/CubeState';
import { applyMoves } from '../src/cube/CubeOrientation';
import { planTransition } from '../src/cube/CubeSolver';
import { assertCubeState } from '../src/cube/CubeValidity';
import { FACE_KEYS } from '../src/cube/CubeLayout';

const front: FaceDots = {U:-.6,F:-.6,R:-.6,D:.6,B:.6,L:.6};
const back = Object.fromEntries(FACE_KEYS.map(f => [f,-front[f]])) as FaceDots;
const force = new ForceLayer();
let real = createSolvedState();
let moving = false;
const displayed = (f: keyof CubeStateData) => !moving && force.modeOf(f) === 'force' ? force.targetColors(f)! : real[f];
function look(dots: FaceDots) {
  const before = Object.fromEntries(FACE_KEYS.map(f => [f,[...displayed(f)]]));
  const update = force.evaluate(dots);
  // Switching display layers is permitted only on hidden faces.
  for (const f of FACE_KEYS) if (!isFaceHidden(dots[f])) assert.deepEqual(displayed(f), before[f]);
  if (update.baseline) {
    const shown = Object.fromEntries(FACE_KEYS.map(f => [f,[...displayed(f)]]));
    assertCubeState(update.baseline);
    real = update.baseline;
    force.retire();
    for (const f of FACE_KEYS) assert.deepEqual(displayed(f), shown[f], 'baseline adoption is invisible on all six faces');
  }
}
const moves: MoveType[] = ['R','U',"F'",'L','M','E','S',"B'",'D'];
for (let preset = 0; preset < 12; preset++) {
  const target = applyMoves(createSolvedState(), moves.slice(0,preset % moves.length + 1));
  const input = structuredClone(target);
  force.arm(input, front);
  input.U[0] = 'X';
  assert.deepEqual(force.configuredState(), target, 'independent target copy');
  let dots = front;
  for (let cycle = 0; cycle < 8; cycle++) {
    for (const move of moves) {
      const before = structuredClone(real);
      force.prepareMix(dots);
      moving = true;
      for (const f of FACE_KEYS) assert.deepEqual(displayed(f), before[f], 'motion shows only the real layer, including hidden stickers');
      real = applyMove(real,move);
      assertCubeState(real);
      for (const f of FACE_KEYS) assert.deepEqual(displayed(f), real[f]);
      moving = false;
      for (const f of FACE_KEYS) {
        assert.deepEqual(displayed(f), isFaceHidden(dots[f]) ? target[f] : real[f], 'three hidden force faces coexist with three ordinary faces');
      }
      assert.deepEqual(force.configuredState(), target, 'mixing must not mutate the target');
    }
    const beforeOrbit = structuredClone(real);
    look(dots);
    assert.deepEqual(real, beforeOrbit, 'force must not change reality while the same faces remain visible');
    // A partial reveal keeps the real state intact and marks the orbit phase.
    look({...dots,F:-dots.F,B:-dots.B});
    assert.equal(force.isRevealing(),true);
    assert.deepEqual(real,beforeOrbit);
    // Edge-on faces remain protected. No partial real-state commits.
    const partial = {...dots, U:0.02, D:0.02};
    look(partial);
    assert.deepEqual(real, beforeOrbit);
    dots = dots === front ? back : front;
    look(dots);
    assert.deepEqual(real, target, 'opposite view must deliver the exact arbitrary preset');
    assert.equal(force.isArmed(), false);
    assert.equal(force.isConfigured(), true);
  }
  const solution = planTransition(real);
  assert.deepEqual(applyMoves(real,solution), createSolvedState(), 'new baseline is solvable');
}
// Invalid force is rejected without destroying a working preset.
const saved = force.configuredState();
const bad = createSolvedState();
[bad.U[5],bad.R[1]] = [bad.R[1],bad.U[5]];
assert.throws(() => force.arm(bad,front));
assert.deepEqual(force.configuredState(),saved);
force.prepareMix(front);
const copy = force.targetColors('D')!; copy[0] = 'X';
assert.notEqual(force.targetColors('D')![0], 'X');
force.clear();
assert.equal(force.isConfigured(),false);
assert.equal(force.evaluate(back).baseline,null);
for (const f of FACE_KEYS) assert.equal(force.modeOf(f),'real');
console.log('Two-layer force: 12 arbitrary presets × 8 repeat cycles; legal real turns, three hidden force faces, edge-on protection, exact reveal, atomic new baseline and post-force Solve passed.');
