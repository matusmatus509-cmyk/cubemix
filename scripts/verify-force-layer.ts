/**
 * Behaviour check for the two-layer force system.
 *
 * Models exactly what the renderer does — for every face, read the colours from
 * either the real state or the force layer, according to ForceLayer's decision —
 * and then walks through a full performance: mix the cube, turn it around, mix
 * some more. The real ForceLayer and the real applyMove are used, so this covers
 * the actual decision logic rather than a restatement of it.
 *
 * Run: bun scripts/verify-force-layer.ts
 */
import { applyMove, createSolvedState, type CubeStateData, type FaceColor, type FaceKey, type MoveType } from '../src/cube/CubeState';
import { FACE_KEYS, cloneCubeState } from '../src/cube/CubeLayout';
import { ForceLayer } from '../src/cube/ForceLayer';

/** Facing values for a cube seen from a given corner: three faces in view. */
function dotsFor(visible: FaceKey[]): Record<FaceKey, number> {
  const dots = {} as Record<FaceKey, number>;
  for (const face of FACE_KEYS) dots[face] = visible.includes(face) ? -0.6 : 0.6;
  return dots;
}

const OPPOSITE: Record<FaceKey, FaceKey> = {
  U: 'D', D: 'U', F: 'B', B: 'F', L: 'R', R: 'L',
};

/** A cube on a screen: the real state plus the force layer painted over it. */
class Model {
  real: CubeStateData = createSolvedState();
  force = new ForceLayer();
  visible: FaceKey[] = ['U', 'F', 'R'];
  /** Faces committed so far, tracked here purely so the test can assert on it. */
  revealed: Set<FaceKey> = new Set();

  /** What is actually on screen for one face. */
  displayed(face: FaceKey): FaceColor[] {
    const forced = this.force.modeOf(face) === 'force' ? this.force.targetColors(face) : null;
    return forced ?? [...this.real[face]];
  }

  arm(state: CubeStateData) {
    this.force.arm(state, dotsFor(this.visible));
  }

  /** One frame of CubeScene.updateForceLayer. */
  tick() {
    if (!this.force.isArmed()) return;
    const update = this.force.evaluate(dotsFor(this.visible));
    for (const face of update.commit) {
      const colors = this.force.targetColors(face);
      if (colors) this.real[face] = colors;
      this.revealed.add(face);
    }
    if (update.finished) this.force.retire();
  }

  turn(move: MoveType) {
    this.real = applyMove(this.real, move);
    this.tick();
  }

  /** Rotate the whole cube so a different set of three faces is in view. */
  lookAt(visible: FaceKey[]) {
    this.visible = visible;
    this.tick();
  }
}

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ''}`);
  }
}

function faceEq(a: FaceColor[], b: FaceColor[]): boolean {
  return a.join('') === b.join('');
}

function statesEqual(a: CubeStateData, b: CubeStateData): boolean {
  return FACE_KEYS.every(f => faceEq(a[f], b[f]));
}

/** A force target that is clearly not a solved cube. */
function makeForce(): CubeStateData {
  let s = createSolvedState();
  for (const move of ['R', 'U', "F'", 'L', 'D', "B'", 'R', 'U'] as MoveType[]) s = applyMove(s, move);
  return s;
}

console.log('\nNo force loaded — the cube must behave like an ordinary cube');
{
  const m = new Model();
  m.turn('R');
  m.turn('U');
  const allReal = FACE_KEYS.every(f => faceEq(m.displayed(f), m.real[f]));
  check('every face shows the real state', allReal);
  m.lookAt(['D', 'B', 'L']);
  check('turning the cube around changes nothing', FACE_KEYS.every(f => faceEq(m.displayed(f), m.real[f])));
}

console.log('\nForce armed on a solved cube');
{
  const m = new Model();
  const force = makeForce();
  m.arm(force);

  const visibleAreReal = m.visible.every(f => faceEq(m.displayed(f), m.real[f]));
  check('the three faces in view show real colours', visibleAreReal);

  const hidden = FACE_KEYS.filter(f => !m.visible.includes(f));
  check('the three hidden faces already carry the force',
    hidden.every(f => faceEq(m.displayed(f), force[f])));
  check('no face was committed yet', m.revealed.size === 0);
}

console.log('\nMixing while the force sits on the unseen faces');
{
  const m = new Model();
  const force = makeForce();
  m.arm(force);

  const before = m.visible.map(f => m.displayed(f).join(''));
  for (const move of ['R', "U'", 'F', 'R', "D'", 'L'] as MoveType[]) m.turn(move);

  check('faces in view keep showing the real cube',
    m.visible.every(f => faceEq(m.displayed(f), m.real[f])));
  check('mixing actually changed what is on screen',
    m.visible.some((f, i) => m.displayed(f).join('') !== before[i]));
  check('the force target is untouched by the mixing',
    FACE_KEYS.filter(f => !m.visible.includes(f)).every(f => faceEq(m.displayed(f), force[f])));
  check('still nothing committed', m.revealed.size === 0);
}

console.log('\nTurning the cube around reveals the force');
{
  const m = new Model();
  const force = makeForce();
  m.arm(force);
  for (const move of ['R', "U'", 'F'] as MoveType[]) m.turn(move);

  const nowVisible: FaceKey[] = m.visible.map(f => OPPOSITE[f]);
  const shownBefore = nowVisible.map(f => m.displayed(f).join(''));
  m.lookAt(nowVisible);
  const shownAfter = nowVisible.map(f => m.displayed(f).join(''));

  check('the revealed faces look identical before and after the commit',
    shownBefore.join('|') === shownAfter.join('|'),
    `${shownBefore.join('|')}\n          ${shownAfter.join('|')}`);
  check('the revealed faces show the force target',
    nowVisible.every(f => faceEq(m.displayed(f), force[f])));
  check('the force became part of the real cube',
    nowVisible.every(f => faceEq(m.real[f], force[f])));
  check('the faces that just went out of sight took the rest of the force on',
    FACE_KEYS.filter(f => !nowVisible.includes(f)).every(f => faceEq(m.displayed(f), force[f])));
}

console.log('\nA full turn-around leaves the cube equal to the force');
{
  const m = new Model();
  const force = makeForce();
  m.arm(force);
  for (const move of ['R', "U'", 'F', 'L', "D'"] as MoveType[]) m.turn(move);

  m.lookAt(['D', 'B', 'L']);
  m.lookAt(['U', 'F', 'R']);

  check('all six faces were revealed', m.revealed.size === 6);
  check('the real cube now IS the force', statesEqual(m.real, force),
    FACE_KEYS.map(f => `${f} real=${m.real[f].join('')} force=${force[f].join('')}`).join('\n          '));
  check('the force layer retired itself', !m.force.isArmed());
  check('the force is still remembered for the next reset', m.force.isConfigured());
}

console.log('\nAfter the reveal the cube is honest again');
{
  const m = new Model();
  const force = makeForce();
  m.arm(force);
  m.lookAt(['D', 'B', 'L']);
  m.lookAt(['U', 'F', 'R']);

  const expected = applyMove(cloneCubeState(m.real), 'R');
  m.turn('R');
  check('a turn after the reveal shows exactly the real state',
    FACE_KEYS.every(f => faceEq(m.displayed(f), expected[f])));
  m.lookAt(['D', 'B', 'L']);
  check('turning the cube around no longer changes anything',
    FACE_KEYS.every(f => faceEq(m.displayed(f), expected[f])));
}

console.log('\nA face is never re-forced after it has been shown');
{
  const m = new Model();
  const force = makeForce();
  m.arm(force);
  m.lookAt(['D', 'B', 'L']);       // D, B, L revealed and committed
  m.turn('R');                     // honest turn, mixes committed + armed faces
  const afterTurn = FACE_KEYS.map(f => m.displayed(f).join(''));
  m.lookAt(['D', 'B', 'L']);       // look at the same faces again
  const revisited = ['D', 'B', 'L'].map(f => m.displayed(f as FaceKey).join(''));
  const expected = ['D', 'B', 'L'].map(f => afterTurn[FACE_KEYS.indexOf(f as FaceKey)]);
  check('an already revealed face keeps whatever the honest turn did to it',
    revisited.join('|') === expected.join('|'),
    `${revisited.join('|')}\n          ${expected.join('|')}`);
}

console.log(failures === 0
  ? '\nForce layer behaves as specified.\n'
  : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
