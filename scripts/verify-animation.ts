import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RubiksCube, snapshotToCubeState, ForceCubieSnapshot } from '../src/cube/RubiksCube';
import { applyMove, createSolvedState, MoveType } from '../src/cube/CubeState';
import { assertCubeState } from '../src/cube/CubeValidity';

let frames: FrameRequestCallback[] = [];
let time = performance.now();
globalThis.requestAnimationFrame = (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; };
const flush = () => {
  for (let i = 0; frames.length && i < 10000; i++) {
    const batch = frames; frames = []; time += 1000;
    batch.forEach(fn => fn(time));
  }
  assert.equal(frames.length, 0, 'animations must finish');
};
const group = new THREE.Group();
group.rotation.set(0.52, 0.75, 0);
const scene = new THREE.Scene(); scene.add(group);
const cube = new RubiksCube(scene, group, createSolvedState());
function renderedState() {
  const snapshots: ForceCubieSnapshot[] = cube.cubies.map(c => {
    const stickerColors: Record<string, string> = {};
    for (const child of c.mesh.children) {
      if (child instanceof THREE.Mesh && child.userData.isSticker) {
        stickerColors[child.userData.face] = '#' + (child.material as THREE.MeshPhongMaterial).color.getHexString();
      }
    }
    return {logicalPos: {...c.logicalPos}, position: {...c.mesh.position}, quaternion: {x:c.mesh.quaternion.x,y:c.mesh.quaternion.y,z:c.mesh.quaternion.z,w:c.mesh.quaternion.w}, stickerColors} as unknown as ForceCubieSnapshot;
  });
  return snapshotToCubeState(snapshots);
}
const moves: MoveType[] = ['R', "R'", 'L', "L'", 'U', "U'", 'D', "D'", 'F', "F'", 'B', "B'", 'M', "M'", 'E', "E'", 'S', "S'"];
let expected = createSolvedState();
for (const move of moves) {
  cube.executeMove(move); flush();
  expected = applyMove(expected, move);
  assert.deepEqual(cube.getState(), expected);
  assert.deepEqual(renderedState(), expected, `rendered stickers after ${move}`);
}
// Hidden commits repaint complete legal states; later moves must still agree with geometry.
const hidden = createSolvedState();
[hidden.D[7],hidden.B[7]] = [hidden.B[7],hidden.D[7]];
[hidden.B[5],hidden.L[3]] = [hidden.L[3],hidden.B[5]];
cube.commitHiddenState(hidden);
expected = structuredClone(hidden);
assert.deepEqual(renderedState(), expected);
// Queue many turns together, then verify geometry independently of getState().
for (let i = 0; i < 100; i++) { const move = moves[(i * 7) % 18]; cube.executeMove(move); expected = applyMove(expected, move); }
flush(); assert.deepEqual(renderedState(), expected);
for (const axis of ['x','y','z'] as const) for (const layer of [-1,0,1]) {
  const v = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  for (const dir of [-1,1]) {
    assert.ok(cube.beginDrag(axis, layer, v));
    cube.setDragAngle(dir * Math.PI / 2); cube.endDrag(); flush();
    assertCubeState(cube.getState());
    assert.deepEqual(renderedState(), cube.getState(), `drag ${axis} ${layer} ${dir}`);
  }
}
// Block simultaneous drag/programmatic motion during snap settling.
const v = new THREE.Vector3(1,0,0);
cube.beginDrag('x',1,v); cube.setDragAngle(0.5); cube.endDrag();
assert.equal(cube.beginDrag('x',1,v), null);
cube.executeMove('F'); flush();
assert.deepEqual(renderedState(), cube.getState());
// Reset in the middle of either animation must discard stale RAF callbacks.
cube.beginDrag('x',1,v); cube.setDragAngle(1); cube.endDrag();
cube.setState(createSolvedState()); flush();
assert.deepEqual(renderedState(), createSolvedState());
cube.executeMove('R'); cube.executeMove('U'); cube.setState(createSolvedState()); flush();
assert.deepEqual(renderedState(), createSolvedState());
assert.equal(group.children.length, 27, 'no abandoned pivot groups after reset');
const copy = cube.getState(); copy.U[0] = 'X';
assert.deepEqual(cube.getState(), createSolvedState());
cube.destroy(); flush(); assert.equal(group.children.length,0);
console.log('Animation: all 18 moves and drags, 100 queued turns, snap exclusion, reset cancellation, rendered state and disposal passed.');
