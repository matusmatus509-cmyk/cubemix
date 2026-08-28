import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CubeStateData, FACE_COLORS, applyMove, MoveType, FaceKey, FaceColor, createSolvedState } from './CubeState';
import {
  FACE_KEYS,
  FACE_NORMAL,
  cloneCubeState,
  cubieOnFace,
  faceCubiePositions,
  stickerIndexOnFace,
} from './CubeLayout';
import { ForceLayer } from './ForceLayer';

export const CUBIE_SIZE = 1;
export const GAP = 0.055;
export const TOTAL = CUBIE_SIZE + GAP;
const STICKER_SCALE = 0.86;
const STICKER_DEPTH = 0.006;
// Rounded body corner radius + smoothing segments
const BODY_RADIUS = 0.08;
const BODY_SEGMENTS = 5;
// Corner radius of the rounded sticker (as a fraction of the sticker size)
const STICKER_CORNER_RADIUS = 0.12;
const SNAP_ANIM_DURATION = 220; // ms for snap animation after release

/** Complete snapshot of a single cubie for Force Cube storage */
export interface ForceCubieSnapshot {
  logicalPos: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  stickerColors: Record<string, string>; // face -> color hex
}

export interface Cubie {
  mesh: THREE.Group;
  logicalPos: THREE.Vector3;
}

export type AxisKey = 'x' | 'y' | 'z';

export interface DragSession {
  axis: AxisKey;
  layer: number;
  axisVec: THREE.Vector3;
  pivot: THREE.Group;
  cubies: Cubie[];
  targetAngle: number;
  currentAngle: number;
}

/** Build a centered rounded-rectangle plane geometry for a sticker. */
const createRoundedStickerGeometry = (size: number, radius: number): THREE.ShapeGeometry => {
  const half = size / 2;
  const r = Math.min(radius, half);
  const shape = new THREE.Shape();
  shape.moveTo(-half + r, -half);
  shape.lineTo(half - r, -half);
  shape.quadraticCurveTo(half, -half, half, -half + r);
  shape.lineTo(half, half - r);
  shape.quadraticCurveTo(half, half, half - r, half);
  shape.lineTo(-half + r, half);
  shape.quadraticCurveTo(-half, half, -half, half - r);
  shape.lineTo(-half, -half + r);
  shape.quadraticCurveTo(-half, -half, -half + r, -half);
  return new THREE.ShapeGeometry(shape, 6);
};

export function faceNormalVec(face: FaceKey): THREE.Vector3 {
  const [x, y, z] = FACE_NORMAL[face];
  return new THREE.Vector3(x, y, z);
}

/** Nearest palette entry for a stored hex colour (presets keep raw hex). */
function colorKeyFromHex(hex: string): FaceColor {
  const target = new THREE.Color(hex);
  let best: FaceColor = 'X';
  let bestDist = Infinity;
  for (const [key, value] of Object.entries(FACE_COLORS)) {
    const c = new THREE.Color(value);
    const d = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (d < bestDist) { bestDist = d; best = key as FaceColor; }
  }
  return best;
}

/**
 * Convert a stored per-cubie snapshot into a per-face cube state.
 *
 * Presets are persisted as cubie snapshots (sticker colours keyed by the label
 * the sticker was born with, plus the rotation the cubie had at capture time),
 * so for every face slot we rotate each sticker normal by the snapshot
 * quaternion and keep the one that ends up pointing at that face.
 */
export function snapshotToCubeState(snapshots: ForceCubieSnapshot[]): CubeStateData {
  const state = createSolvedState();
  for (const face of FACE_KEYS) {
    const colors: FaceColor[] = Array(9).fill('X');
    const targetNormal = faceNormalVec(face);
    for (const pos of faceCubiePositions(face)) {
      const snap = snapshots.find(s =>
        s.logicalPos.x === pos.x && s.logicalPos.y === pos.y && s.logicalPos.z === pos.z);
      if (!snap) continue;
      const quat = new THREE.Quaternion(
        snap.quaternion.x, snap.quaternion.y, snap.quaternion.z, snap.quaternion.w,
      );
      for (const [label, hex] of Object.entries(snap.stickerColors)) {
        if (!(label in FACE_NORMAL)) continue;
        const dir = faceNormalVec(label as FaceKey).applyQuaternion(quat).normalize();
        if (dir.dot(targetNormal) > 0.9) {
          colors[stickerIndexOnFace(pos.x, pos.y, pos.z, face)] = colorKeyFromHex(hex);
          break;
        }
      }
    }
    state[face] = colors;
  }
  return state;
}

/** Convert a per-face cube state into the persisted snapshot format. */
export function cubeStateToSnapshot(state: CubeStateData): ForceCubieSnapshot[] {
  const snapshots: ForceCubieSnapshot[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const stickerColors: Record<string, string> = {};
        for (const face of FACE_KEYS) {
          if (!cubieOnFace(x, y, z, face)) continue;
          const key = state[face][stickerIndexOnFace(x, y, z, face)];
          stickerColors[face] = FACE_COLORS[key] ?? FACE_COLORS['X'];
        }
        snapshots.push({
          logicalPos: { x, y, z },
          position: { x: x * TOTAL, y: y * TOTAL, z: z * TOTAL },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          stickerColors,
        });
      }
    }
  }
  return snapshots;
}

export class RubiksCube {
  scene: THREE.Scene;
  cubeGroup: THREE.Group;
  cubies: Cubie[] = [];
  private isAnimating = false;
  private animQueue: Array<() => void> = [];
  private onStateChangeCb?: (state: CubeStateData) => void;
  private onMoveCb?: (move: MoveType) => void;
  private cubeState: CubeStateData;
  private activeDrag: DragSession | null = null;
  private activePivot: THREE.Group | null = null;
  private moveHistory: MoveType[] = [];
  // True while a released layer is animating to its snapped position. During
  // this window the cubies are still parented to a pivot, so no new drag may
  // begin until finalizeDrag reparents them.
  private isSettling = false;

  // ── Force layer ──
  // The second, hidden layer of colours. It is pinned to cube-local face slots
  // rather than to cubies, so a face showing the force always shows exactly the
  // programmed target no matter how much mixing has happened. `cubeState` above
  // stays the honest cube the whole time.
  readonly force = new ForceLayer();
  // Cubies that are mid-turn. A turning layer can swing a hidden sticker into
  // view, so those cubies always render the real state — that is what keeps
  // ordinary layer turns looking like an ordinary cube.
  private movingCubies: Set<Cubie> = new Set();

  constructor(scene: THREE.Scene, cubeGroup: THREE.Group, initialState: CubeStateData) {
    this.scene = scene;
    this.cubeGroup = cubeGroup;
    this.cubeState = initialState;
    this.buildCube(initialState);
  }

  setOnStateChange(fn: (state: CubeStateData) => void) {
    this.onStateChangeCb = fn;
  }

  setOnMove(fn: (move: MoveType) => void) {
    this.onMoveCb = fn;
  }

  getState() { return this.cubeState; }
  isCurrentlyAnimating() { return this.isAnimating; }
  isDragging() { return this.activeDrag !== null; }
  /** True if any drag, snap-settle, or programmatic animation is in progress. */
  isBusy() { return this.isAnimating || this.activeDrag !== null || this.isSettling; }

  private buildCube(state: CubeStateData) {
    this.cubies.forEach(c => this.cubeGroup.remove(c.mesh));
    this.cubies = [];

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const group = new THREE.Group();
          group.position.set(x * TOTAL, y * TOTAL, z * TOTAL);

          // Black body (rounded edges for a softer, real-cube look)
          const bodyGeo = new RoundedBoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, BODY_SEGMENTS, BODY_RADIUS);
          const bodyMat = new THREE.MeshPhongMaterial({
            color: 0x080808,
            shininess: 0,
            specular: new THREE.Color(0x000000),
          });
          const body = new THREE.Mesh(bodyGeo, bodyMat);
          group.add(body);

          // Stickers
          this.createCubieStickers(group, x, y, z, state);

          this.cubeGroup.add(group);
          this.cubies.push({
            mesh: group,
            logicalPos: new THREE.Vector3(x, y, z),
          });
        }
      }
    }

    this.repaintStickers();
  }

  private getStickerColor(state: CubeStateData, x: number, y: number, z: number, face: FaceKey): string {
    const colorKey = state[face][stickerIndexOnFace(x, y, z, face)];
    return FACE_COLORS[colorKey] || FACE_COLORS['X'];
  }

  private createCubieStickers(group: THREE.Group, x: number, y: number, z: number, state: CubeStateData) {
    const half = CUBIE_SIZE / 2 + STICKER_DEPTH;

    type FaceConfig = { face: FaceKey; condition: boolean; pos: [number, number, number]; rot: [number, number, number] };
    const faces: FaceConfig[] = [
      { face: 'R', condition: x === 1,  pos: [half, 0, 0],  rot: [0, Math.PI / 2, 0] },
      { face: 'L', condition: x === -1, pos: [-half, 0, 0], rot: [0, -Math.PI / 2, 0] },
      { face: 'U', condition: y === 1,  pos: [0, half, 0],  rot: [-Math.PI / 2, 0, 0] },
      { face: 'D', condition: y === -1, pos: [0, -half, 0], rot: [Math.PI / 2, 0, 0] },
      { face: 'F', condition: z === 1,  pos: [0, 0, half],  rot: [0, 0, 0] },
      { face: 'B', condition: z === -1, pos: [0, 0, -half], rot: [0, Math.PI, 0] },
    ];

    for (const fc of faces) {
      if (!fc.condition) continue;
      const color = this.getStickerColor(state, x, y, z, fc.face);
      const geo = createRoundedStickerGeometry(STICKER_SCALE, STICKER_SCALE * STICKER_CORNER_RADIUS);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(color),
        shininess: 0,
        specular: new THREE.Color(0x000000),
      });
      const sticker = new THREE.Mesh(geo, mat);
      sticker.position.set(...fc.pos);
      sticker.rotation.set(...fc.rot);
      sticker.userData.isSticker = true;
      sticker.userData.face = fc.face;
      const localNormal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...fc.rot));
      sticker.userData.normal = localNormal;
      group.add(sticker);
    }
  }

  getCubiesInLayer(axis: AxisKey, value: number): Cubie[] {
    return this.cubies.filter(c => Math.round(c.logicalPos[axis]) === value);
  }

  // ─── Interactive drag API ────────────────────────────

  /** Begin a drag: detach the layer into a pivot so it can be rotated freely */
  beginDrag(axis: AxisKey, layer: number, axisVec: THREE.Vector3): DragSession | null {
    if (this.isAnimating || this.activeDrag) return null;
    const cubies = this.getCubiesInLayer(axis, layer);
    if (cubies.length === 0) return null;

    const pivot = new THREE.Group();
    this.cubeGroup.add(pivot);

    for (const cubie of cubies) {
      const lp = cubie.mesh.position.clone();
      const lq = cubie.mesh.quaternion.clone();
      this.cubeGroup.remove(cubie.mesh);
      pivot.add(cubie.mesh);
      cubie.mesh.position.copy(lp);
      cubie.mesh.quaternion.copy(lq);
    }

    this.activeDrag = {
      axis, layer,
      axisVec: axisVec.clone(),
      pivot, cubies,
      targetAngle: 0,
      currentAngle: 0,
    };

    // The layer is about to swing: strip the force layer off every cubie in it
    // before it moves, so nothing forced can ever rotate into view.
    this.beginCubieMotion(cubies);

    return this.activeDrag;
  }


  /**
   * Called every animation frame while dragging.
   * Smoothly interpolates `currentAngle` toward `targetAngle`.
   * Frame-rate independent exponential smoothing.
   */
  tickDragSmoothing() {
    // Finger tracking is now applied directly in setDragAngle (event-driven,
    // decoupled from the render loop) so the drag feel is identical whether or
    // not force mode is running per-frame work. Nothing to do here while a
    // drag is active; kept for API compatibility.
    return;
  }

  /**
   * Update the layer angle directly from the pointer — the layer follows the
   * finger exactly 1:1 with no smoothing lag. Applied on every pointermove so
   * the motion is instant and its speed never depends on the render-loop frame
   * rate (and therefore never changes when force mode is active or has run).
   */
  setDragAngle(angle: number) {
    if (!this.activeDrag) return;
    this.activeDrag.targetAngle = angle;
    this.activeDrag.currentAngle = angle;
    this.activeDrag.pivot.quaternion.setFromAxisAngle(this.activeDrag.axisVec, angle);
  }

  /**
   * End drag: snap to nearest 90°.
   * Decision uses targetAngle (where the finger intended to go),
   * but the snap animation starts from currentAngle (where the layer
   * visually is right now) — so the motion is always seamless.
   * Commit threshold: 45°.
   */
  endDrag(velocity = 0) {
    if (!this.activeDrag) return;
    const drag = this.activeDrag;
    this.activeDrag = null;

    const halfPi = Math.PI / 2;
    const commitThreshold = Math.PI / 4; // 45°
    // A quick flick commits a turn even if the finger didn't travel far.
    // velocity is in rad/ms; ~0.004 rad/ms ≈ a 90° turn in ~390ms.
    const FLICK_VELOCITY = 0.004;
    const FLICK_MIN_ANGLE = Math.PI / 18; // 10° — ignore accidental micro-flicks

    // Use targetAngle for the decision — it reflects the finger's intent
    // even if the visual (currentAngle) hasn't caught up yet due to lerp.
    const decisionAngle = drag.targetAngle;

    let commit = Math.abs(decisionAngle) >= commitThreshold;
    // Direction from the dragged distance by default.
    let direction = decisionAngle >= 0 ? 1 : -1;

    // Flick override: a fast release past a small minimum commits one turn
    // in the direction of the flick, so a single quick swipe = one turn.
    if (!commit && Math.abs(velocity) >= FLICK_VELOCITY && Math.abs(decisionAngle) >= FLICK_MIN_ANGLE) {
      commit = true;
      direction = velocity > 0 ? 1 : -1;
    }

    if (commit) {
      const targetAngle = direction * halfPi;
      const move = this.getMoveFromDrag(drag.axis, drag.layer, direction);
      this.snapDragTo(drag, targetAngle, move);
    } else {
      // Snap back to 0
      this.snapDragTo(drag, 0, null);
    }
  }

  /** Cancel drag (snap back to 0, no move applied) */
  cancelDrag() {
    if (!this.activeDrag) return;
    const drag = this.activeDrag;
    this.activeDrag = null;
    this.snapDragTo(drag, 0, null);
  }

  private getMoveFromDrag(axis: AxisKey, layer: number, steps: number): MoveType | null {
    const dir = steps > 0 ? 1 : -1;
    type MoveInfo = { pos: MoveType; neg: MoveType };
    const layerMoves: Record<string, MoveInfo> = {
      'x_1':  { pos: "R'", neg: 'R' },
      'x_-1': { pos: 'L',  neg: "L'" },
      'x_0':  { pos: 'M',  neg: "M'" },
      'y_1':  { pos: "U'", neg: 'U' },
      'y_-1': { pos: 'D',  neg: "D'" },
      'y_0':  { pos: 'E',  neg: "E'" },
      'z_1':  { pos: "F'", neg: 'F' },
      'z_-1': { pos: 'B',  neg: "B'" },
      'z_0':  { pos: "S'", neg: 'S' },
    };
    const key = `${axis}_${layer}`;
    const info = layerMoves[key];
    if (!info) return null;
    return dir > 0 ? info.pos : info.neg;
  }

  private snapDragTo(drag: DragSession, targetAngle: number, move: MoveType | null) {
    // Lock out new interactions until the layer finishes settling.
    this.isSettling = true;

    const startAngle = drag.currentAngle;
    const startQuat = new THREE.Quaternion().setFromAxisAngle(drag.axisVec, startAngle);
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(drag.axisVec, targetAngle);

    // If already at target, finalize immediately
    const diff = Math.abs(targetAngle - startAngle);
    if (diff < 0.01) {
      this.finalizeDrag(drag, targetAngle, move);
      return;
    }

    const startTime = performance.now();
    // Duration proportional to remaining angle, minimum 140ms for a smooth feel
    const duration = Math.max(60, SNAP_ANIM_DURATION * (diff / (Math.PI / 2)));

    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      // easeOutCubic — carries the swipe momentum forward and gently
      // decelerates into the final snapped position for a smooth completion.
      const eased = 1 - Math.pow(1 - t, 3);
      drag.pivot.quaternion.slerpQuaternions(startQuat, targetQuat, eased);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        this.finalizeDrag(drag, targetAngle, move);
      }
    };
    requestAnimationFrame(tick);
  }

  private finalizeDrag(drag: DragSession, _finalAngle: number, move: MoveType | null) {
    // Apply the move to state if there is one
    if (move) {
      this.cubeState = applyMove(this.cubeState, move);
      this.moveHistory.push(move);
    }

    // Reparent cubies back to cubeGroup
    const q = drag.pivot.quaternion.clone();
    for (const cubie of drag.cubies) {
      const worldPos = new THREE.Vector3();
      cubie.mesh.getWorldPosition(worldPos);
      const worldQuat = new THREE.Quaternion();
      cubie.mesh.getWorldQuaternion(worldQuat);

      drag.pivot.remove(cubie.mesh);
      this.cubeGroup.add(cubie.mesh);

      // Convert world back to cubeGroup local
      const invGroupMat = new THREE.Matrix4().copy(this.cubeGroup.matrixWorld).invert();
      const localPos = worldPos.applyMatrix4(invGroupMat);
      cubie.mesh.position.copy(localPos);

      const invGroupQuat = this.cubeGroup.quaternion.clone().invert();
      cubie.mesh.quaternion.copy(worldQuat.premultiply(invGroupQuat));

      // Snap position
      cubie.mesh.position.x = Math.round(cubie.mesh.position.x / TOTAL) * TOTAL;
      cubie.mesh.position.y = Math.round(cubie.mesh.position.y / TOTAL) * TOTAL;
      cubie.mesh.position.z = Math.round(cubie.mesh.position.z / TOTAL) * TOTAL;

      // Update logical position
      if (move) {
        cubie.logicalPos.applyQuaternion(q);
        cubie.logicalPos.x = Math.round(cubie.logicalPos.x);
        cubie.logicalPos.y = Math.round(cubie.logicalPos.y);
        cubie.logicalPos.z = Math.round(cubie.logicalPos.z);
      }
    }

    this.cubeGroup.remove(drag.pivot);

    // Layer is fully reparented and snapped — safe to accept new input again.
    this.isSettling = false;

    // The layer has come to rest: whatever landed on a hidden face gets the
    // force layer back (invisible), whatever landed in view keeps real colours.
    this.endCubieMotion();

    this.onStateChangeCb?.(this.cubeState);
    if (move) {
      this.onMoveCb?.(move);
    }

    // Process queue
    if (this.animQueue.length > 0) {
      const next = this.animQueue.shift()!;
      next();
    }
  }

  // ─── Programmatic move (for scramble, button presses) ────────

  private animateLayer(
    cubies: Cubie[],
    axisVec: THREE.Vector3,
    totalAngle: number,
    duration: number,
    onComplete: () => void
  ) {
    const pivot = new THREE.Group();
    this.activePivot = pivot;
    this.cubeGroup.add(pivot);

    for (const cubie of cubies) {
      const lp = cubie.mesh.position.clone();
      const lq = cubie.mesh.quaternion.clone();
      this.cubeGroup.remove(cubie.mesh);
      pivot.add(cubie.mesh);
      cubie.mesh.position.copy(lp);
      cubie.mesh.quaternion.copy(lq);
    }

    const startTime = performance.now();
    const startQuat = new THREE.Quaternion();
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(axisVec, totalAngle);

    const tick = (now: number) => {
      if (this.activePivot !== pivot) {
        // Animation was aborted — cleanup pivot
        if (pivot.parent) {
          for (const cubie of cubies) {
            if (cubie.mesh.parent === pivot) pivot.remove(cubie.mesh);
          }
          this.cubeGroup.remove(pivot);
        }
        return;
      }
      const t = Math.min((now - startTime) / duration, 1);
      const eased = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;
      pivot.quaternion.slerpQuaternions(startQuat, targetQuat, eased);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        this.activePivot = null;
        // Reparent
        for (const cubie of cubies) {
          const worldPos = new THREE.Vector3();
          cubie.mesh.getWorldPosition(worldPos);
          const worldQuat = new THREE.Quaternion();
          cubie.mesh.getWorldQuaternion(worldQuat);
          pivot.remove(cubie.mesh);
          this.cubeGroup.add(cubie.mesh);

          const invGroupMat = new THREE.Matrix4().copy(this.cubeGroup.matrixWorld).invert();
          cubie.mesh.position.copy(worldPos.applyMatrix4(invGroupMat));

          const invGroupQuat = this.cubeGroup.quaternion.clone().invert();
          cubie.mesh.quaternion.copy(worldQuat.premultiply(invGroupQuat));

          cubie.mesh.position.x = Math.round(cubie.mesh.position.x / TOTAL) * TOTAL;
          cubie.mesh.position.y = Math.round(cubie.mesh.position.y / TOTAL) * TOTAL;
          cubie.mesh.position.z = Math.round(cubie.mesh.position.z / TOTAL) * TOTAL;
        }
        this.cubeGroup.remove(pivot);
        this.endCubieMotion();
        onComplete();
      }
    };
    requestAnimationFrame(tick);
  }

  executeMove(move: MoveType, callback?: () => void, skipHistory = false) {
    const ANIM_DURATION = 100;
    const moveMap: Record<MoveType, { axis: AxisKey; layer: number; dir: number }> = {
      'R':  { axis: 'x', layer:  1, dir: -1 },
      "R'": { axis: 'x', layer:  1, dir:  1 },
      'L':  { axis: 'x', layer: -1, dir:  1 },
      "L'": { axis: 'x', layer: -1, dir: -1 },
      'U':  { axis: 'y', layer:  1, dir: -1 },
      "U'": { axis: 'y', layer:  1, dir:  1 },
      'D':  { axis: 'y', layer: -1, dir:  1 },
      "D'": { axis: 'y', layer: -1, dir: -1 },
      'F':  { axis: 'z', layer:  1, dir: -1 },
      "F'": { axis: 'z', layer:  1, dir:  1 },
      'B':  { axis: 'z', layer: -1, dir:  1 },
      "B'": { axis: 'z', layer: -1, dir: -1 },
      'M':  { axis: 'x', layer:  0, dir:  1 },
      "M'": { axis: 'x', layer:  0, dir: -1 },
      'E':  { axis: 'y', layer:  0, dir:  1 },
      "E'": { axis: 'y', layer:  0, dir: -1 },
      'S':  { axis: 'z', layer:  0, dir: -1 },
      "S'": { axis: 'z', layer:  0, dir:  1 },
    };

    const doMove = () => {
      const { axis, layer, dir } = moveMap[move];
      const axisVec = new THREE.Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0,
      );
      const angle = (Math.PI / 2) * dir;
      const cubies = this.getCubiesInLayer(axis, layer);
      const q = new THREE.Quaternion().setFromAxisAngle(axisVec, angle);

      // Strip the force layer off the cubies that are about to swing, while they
      // are still in their old slots — this has to happen before the state and
      // the logical positions move, otherwise the wrong stickers get recoloured.
      this.beginCubieMotion(cubies);

      for (const cubie of cubies) {
        cubie.logicalPos.applyQuaternion(q);
        cubie.logicalPos.x = Math.round(cubie.logicalPos.x);
        cubie.logicalPos.y = Math.round(cubie.logicalPos.y);
        cubie.logicalPos.z = Math.round(cubie.logicalPos.z);
      }

      this.cubeState = applyMove(this.cubeState, move);
      if (!skipHistory) {
        this.moveHistory.push(move);
      }

      this.isAnimating = true;
      this.animateLayer(cubies, axisVec, angle, ANIM_DURATION, () => {
        this.isAnimating = false;
        this.onStateChangeCb?.(this.cubeState);
        this.onMoveCb?.(move);
        callback?.();
        if (this.animQueue.length > 0) {
          const next = this.animQueue.shift()!;
          next();
        }
      });
    };

    if (this.isAnimating || this.activeDrag) {
      this.animQueue.push(doMove);
    } else {
      doMove();
    }
  }

  // ─── Force layer ────────────────────────────────────────────
  //
  // The cube carries two independent colour layers at all times:
  //
  //   1. the real state (`cubeState`) — the honest cube. Every turn, scramble
  //      and solve acts on it and only on it.
  //   2. the force layer (`force`) — the programmed target, pinned to cube-local
  //      face slots so it survives any amount of mixing.
  //
  // A face shows the force while it is out of sight and the real state while it
  // faces the viewer; CubeScene feeds the layer the cube's orientation each
  // frame. Turning layers therefore looks like a perfectly ordinary cube, yet
  // every face the viewer cannot see is already carrying the force.

  /**
   * Copy the force colours of one face into the real state.
   *
   * Called the moment a forced face rotates into view: the colours the viewer is
   * now looking at become the truth, so they can never change back. The swap
   * itself is invisible — the face already displays exactly these colours — only
   * the bookkeeping underneath changes.
   */
  commitForceFace(face: FaceKey) {
    const colors = this.force.targetColors(face);
    if (!colors) return;
    this.cubeState = cloneCubeState(this.cubeState);
    this.cubeState[face] = colors;
  }

  /** Mark cubies as mid-turn — while moving they always render real colours. */
  private beginCubieMotion(cubies: Cubie[]) {
    if (!this.force.isArmed()) return;
    this.movingCubies = new Set(cubies);
    this.repaintStickers();
  }

  /** The turn has come to rest — go back to the normal per-face rule. */
  private endCubieMotion() {
    if (this.movingCubies.size === 0) return;
    this.movingCubies.clear();
    this.repaintStickers();
  }

  /**
   * Recolour all 54 stickers from the two layers.
   *
   * For every face slot we resolve which cubie sits there and which of its
   * stickers points outward, then paint it from the real state or the force
   * layer depending on that face's render mode.
   */
  repaintStickers() {
    const byPos = new Map<string, Cubie>();
    for (const cubie of this.cubies) {
      const key = `${Math.round(cubie.logicalPos.x)},${Math.round(cubie.logicalPos.y)},${Math.round(cubie.logicalPos.z)}`;
      byPos.set(key, cubie);
    }

    for (const face of FACE_KEYS) {
      const forceColors = this.force.modeOf(face) === 'force'
        ? this.force.targetColors(face)
        : null;

      for (const pos of faceCubiePositions(face)) {
        const cubie = byPos.get(`${pos.x},${pos.y},${pos.z}`);
        if (!cubie) continue;
        const sticker = this.getStickerOnFace(cubie, face);
        if (!sticker) continue;
        const material = sticker.material;
        if (!(material instanceof THREE.MeshPhongMaterial)) continue;

        // A cubie in motion can swing into view mid-turn, so it never wears the
        // force layer — that is the second layer showing through underneath.
        const source = forceColors && !this.movingCubies.has(cubie)
          ? forceColors
          : this.cubeState[face];

        const colorKey = source[stickerIndexOnFace(pos.x, pos.y, pos.z, face)];
        material.color.set(FACE_COLORS[colorKey] ?? FACE_COLORS['X']);
      }
    }
  }

  /**
   * Find the sticker on a cubie that currently faces the specified face
   * direction. Cubies keep their own rotation, so this follows the sticker
   * wherever earlier turns have carried it.
   */
  private getStickerOnFace(cubie: Cubie, face: FaceKey): THREE.Mesh | null {
    const targetNormal = faceNormalVec(face);

    for (const child of cubie.mesh.children) {
      if (!child.userData.isSticker) continue;

      const localNormal: THREE.Vector3 = child.userData.normal;
      const currentNormal = localNormal.clone().applyQuaternion(cubie.mesh.quaternion).normalize();

      if (currentNormal.dot(targetNormal) > 0.9) {
        return child as THREE.Mesh;
      }
    }
    return null;
  }

  setState(state: CubeStateData) {
    this.cubeState = cloneCubeState(state);
    this.isAnimating = false;
    this.activeDrag = null;
    this.activePivot = null;
    this.animQueue = [];
    this.moveHistory = [];
    this.movingCubies.clear();
    this.buildCube(state);
  }

  getMoveHistory(): MoveType[] { return [...this.moveHistory]; }
  clearHistory() { this.moveHistory = []; }

  /**
   * Snapshot of the cube in the persisted preset format.
   *
   * Built from the real state, never from what is on screen: hidden faces on
   * screen may already be showing a force layer, which must never leak into a
   * saved preset.
   */
  takeForceSnapshot(): ForceCubieSnapshot[] {
    return cubeStateToSnapshot(this.cubeState);
  }

  clearQueue() {
    this.animQueue = [];
  }
}
