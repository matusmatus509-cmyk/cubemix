import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CubeStateData, FACE_COLORS, applyMove, MoveType, FaceKey, FaceColor, createSolvedState } from './CubeState';

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
  }

  private getStickerColor(state: CubeStateData, x: number, y: number, z: number, face: string): string {
    let row = 0, col = 0;
    switch (face) {
      case 'U': row = 1 - z; col = x + 1; break;
      case 'D': row = z + 1; col = x + 1; break;
      case 'F': row = 1 - y; col = x + 1; break;
      case 'B': row = 1 - y; col = 1 - x; break;
      case 'L': row = 1 - y; col = z + 1; break;
      case 'R': row = 1 - y; col = 1 - z; break;
    }
    const idx = row * 3 + col;
    const faceKey = face as keyof CubeStateData;
    const colorKey = state[faceKey][idx];
    return FACE_COLORS[colorKey] || FACE_COLORS['X'];
  }

  private createCubieStickers(group: THREE.Group, x: number, y: number, z: number, state: CubeStateData) {
    const half = CUBIE_SIZE / 2 + STICKER_DEPTH;

    type FaceConfig = { face: string; condition: boolean; pos: [number, number, number]; rot: [number, number, number] };
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

  /** Update stickers on a single cubie to match current state */
  refreshCubieStickers(cubieIndex: number) {
    const cubie = this.cubies[cubieIndex];
    const { x, y, z } = cubie.logicalPos;

    // Remove old stickers
    const stickersToRemove: THREE.Mesh[] = [];
    cubie.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData.isSticker) {
        stickersToRemove.push(child);
      }
    });
    stickersToRemove.forEach(s => {
      cubie.mesh.remove(s);
      s.geometry.dispose();
      if (s.material instanceof THREE.Material) s.material.dispose();
    });

    // Create new stickers
    this.createCubieStickers(cubie.mesh, x, y, z, this.cubeState);
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

  // ─── Force Mode ─────────────────────────────────────────────

  /**
   * Get the sticker index (0-8) on a given face for a cubie at logicalPos
   */
  private getStickerIndexOnFace(logicalPos: THREE.Vector3, face: FaceKey): number {
    const { x, y, z } = logicalPos;
    let row = 0, col = 0;
    switch (face) {
      case 'U': row = 1 - z; col = x + 1; break;
      case 'D': row = z + 1; col = x + 1; break;
      case 'F': row = 1 - y; col = x + 1; break;
      case 'B': row = 1 - y; col = 1 - x; break;
      case 'L': row = 1 - y; col = z + 1; break;
      case 'R': row = 1 - y; col = 1 - z; break;
    }
    return row * 3 + col;
  }

  /**
   * Apply a complete force snapshot to the current cube.
   * Only replaces cubies on the specified faces (hidden faces).
   *
   * BUG FIX: Edge and corner cubies belong to multiple faces.
   * When a cubie sits on both a hidden face and a visible face,
   * we must only update the sticker(s) that belong to the hidden face(s),
   * leaving the visible-face stickers completely unchanged.
   */
  applyForceSnapshot(snapshots: ForceCubieSnapshot[], faces: FaceKey[]) {
    if (!snapshots || snapshots.length === 0) return;

    const facesSet = new Set<FaceKey>(faces);

    // Build a map of which logical positions belong to each face
    const facePositions = new Set<string>();
    for (const face of faces) {
      const positions = this.getFaceCubiePositions(face);
      for (const pos of positions) {
        facePositions.add(`${pos.x},${pos.y},${pos.z}`);
      }
    }

    // Replace cubies that are on the target faces
    for (let i = 0; i < this.cubies.length; i++) {
      const cubie = this.cubies[i];
      const key = `${cubie.logicalPos.x},${cubie.logicalPos.y},${cubie.logicalPos.z}`;

      if (!facePositions.has(key)) continue;

      // Find matching snapshot cubie by logical position
      const snap = snapshots.find(s =>
        s.logicalPos.x === cubie.logicalPos.x &&
        s.logicalPos.y === cubie.logicalPos.y &&
        s.logicalPos.z === cubie.logicalPos.z
      );

      if (snap) {
        // Determine which faces of THIS cubie are being forced.
        // A cubie's faces are determined by its logical position:
        // e.g. cubie at (1,-1,1) has faces R, D, F.
        // Only update stickers for faces in the `facesSet`.
        const cubieVisibleFaces = this.getCubieFaceKeys(cubie);
        const forcedFacesForCubie = cubieVisibleFaces.filter(f => facesSet.has(f));

        if (forcedFacesForCubie.length === cubieVisibleFaces.length) {
          // ALL faces of this cubie are being forced — full replacement is safe
          this.replaceCubieWithSnapshot(i, snap);
        } else {
          // Only SOME faces are forced — selectively update only those stickers
          this.partialReplaceCubieStickers(cubie, snap, forcedFacesForCubie);
        }
      }
    }

    // Rebuild cubeState from visuals
    this.rebuildCubeStateFromVisuals();
    this.onStateChangeCb?.(this.cubeState);
  }

  /**
   * Get the 9 logical positions of cubies on a given face.
   */
  private getFaceCubiePositions(face: FaceKey): { x: number; y: number; z: number }[] {
    const positions: { x: number; y: number; z: number }[] = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          let onFace = false;
          switch (face) {
            case 'U': onFace = y === 1; break;
            case 'D': onFace = y === -1; break;
            case 'F': onFace = z === 1; break;
            case 'B': onFace = z === -1; break;
            case 'L': onFace = x === -1; break;
            case 'R': onFace = x === 1; break;
          }
          if (onFace) positions.push({ x, y, z });
        }
      }
    }
    return positions;
  }

  /**
   * Get the list of face keys that a cubie contributes stickers to,
   * based on its logical position.
   * E.g. cubie at (1, -1, 1) → ['R', 'D', 'F']
   */
  private getCubieFaceKeys(cubie: Cubie): FaceKey[] {
    const result: FaceKey[] = [];
    const { x, y, z } = cubie.logicalPos;
    if (x === 1) result.push('R');
    if (x === -1) result.push('L');
    if (y === 1) result.push('U');
    if (y === -1) result.push('D');
    if (z === 1) result.push('F');
    if (z === -1) result.push('B');
    return result;
  }

  /**
   * Partially update a cubie's stickers: only replace the sticker colors
   * for the specified faces, leaving all other stickers unchanged.
   * Does NOT change the cubie's quaternion or position.
   */
  private partialReplaceCubieStickers(cubie: Cubie, snapshot: ForceCubieSnapshot, facesToReplace: FaceKey[]) {
    const facesSet = new Set<string>(facesToReplace);

    for (const child of cubie.mesh.children) {
      if (!child.userData.isSticker) continue;

      // We need to figure out which cube face this sticker currently represents.
      // The sticker's userData.face stores its ORIGINAL face label (at creation time).
      // But after rotations, the cubie's quaternion has changed, so the sticker
      // may now face a different direction.
      //
      // However, in the snapshot, the sticker colors are keyed by the ORIGINAL face label too.
      // And the snapshot was taken when the cube was in a certain state.
      //
      // The face label on the sticker is the direction it was created for (e.g. 'R', 'U', 'F').
      // Since the cubie has been rotated, this sticker now physically points in a different
      // direction. We need to find which CUBE face this sticker is currently facing.
      
      const localNormal: THREE.Vector3 = child.userData.normal;
      const currentNormal = localNormal.clone().applyQuaternion(cubie.mesh.quaternion).normalize();

      // Find which cube face this sticker currently faces
      const currentFace = this.normalToFaceKey(currentNormal);
      if (!currentFace) continue;

      // Only update if this sticker faces one of the faces we're forcing
      if (facesSet.has(currentFace)) {
        // Find what color this sticker should have from the snapshot.
        // In the snapshot, sticker colors are keyed by the ORIGINAL face label.
        // We need to find the snapshot sticker that, when the snapshot quaternion is applied,
        // would face the same direction (currentFace).
        //
        // The snapshot stores: stickerColors keyed by original face label,
        // and the quaternion the cubie had at snapshot time.
        // At snapshot time, a sticker with label 'X' and normal for 'X',
        // when rotated by snapshot.quaternion, faces some cube direction.
        //
        // We need: which snapshot sticker label, when rotated by snapshot.quaternion,
        // gives us `currentFace`?
        
        const snapshotQuat = new THREE.Quaternion(
          snapshot.quaternion.x, snapshot.quaternion.y,
          snapshot.quaternion.z, snapshot.quaternion.w
        );

        let matchedColor: string | null = null;
        for (const [origLabel, color] of Object.entries(snapshot.stickerColors)) {
          // Compute which direction this snapshot sticker was facing
          const stickerNormal = this.faceKeyToNormal(origLabel);
          if (!stickerNormal) continue;
          const snapshotFacingDir = stickerNormal.clone().applyQuaternion(snapshotQuat).normalize();
          const snapshotFace = this.normalToFaceKey(snapshotFacingDir);
          if (snapshotFace === currentFace) {
            matchedColor = color;
            break;
          }
        }

        if (matchedColor && (child as THREE.Mesh).material instanceof THREE.MeshPhongMaterial) {
          ((child as THREE.Mesh).material as THREE.MeshPhongMaterial).color.set(matchedColor);
        }
      }
    }
  }

  /**
   * Convert a world-space normal vector to a FaceKey.
   * Returns null if the normal doesn't closely match any face.
   */
  private normalToFaceKey(normal: THREE.Vector3): FaceKey | null {
    const threshold = 0.9;
    if (normal.y > threshold) return 'U';
    if (normal.y < -threshold) return 'D';
    if (normal.z > threshold) return 'F';
    if (normal.z < -threshold) return 'B';
    if (normal.x < -threshold) return 'L';
    if (normal.x > threshold) return 'R';
    return null;
  }

  /**
   * Get the local normal vector for a sticker originally created for a given face.
   */
  private faceKeyToNormal(face: string): THREE.Vector3 | null {
    switch (face) {
      case 'R': return new THREE.Vector3(1, 0, 0);
      case 'L': return new THREE.Vector3(-1, 0, 0);
      case 'U': return new THREE.Vector3(0, 1, 0);
      case 'D': return new THREE.Vector3(0, -1, 0);
      case 'F': return new THREE.Vector3(0, 0, 1);
      case 'B': return new THREE.Vector3(0, 0, -1);
      default: return null;
    }
  }

  /**
   * Replace a cubie's stickers with those from a snapshot.
   */
  private replaceCubieWithSnapshot(cubieIndex: number, snapshot: ForceCubieSnapshot) {
    const cubie = this.cubies[cubieIndex];

    // Remove old stickers
    const stickersToRemove: THREE.Mesh[] = [];
    cubie.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.userData.isSticker) {
        stickersToRemove.push(child);
      }
    });
    stickersToRemove.forEach(s => {
      cubie.mesh.remove(s);
      s.geometry.dispose();
      if (s.material instanceof THREE.Material) s.material.dispose();
    });

    // Reset quaternion to identity (snapshot was taken when cubie was at identity rotation)
    cubie.mesh.quaternion.set(
      snapshot.quaternion.x,
      snapshot.quaternion.y,
      snapshot.quaternion.z,
      snapshot.quaternion.w,
    );

    // Create new stickers from snapshot
    this.createStickersFromSnapshot(cubie.mesh, snapshot.stickerColors);
  }

  /**
   * Create stickers on a cubie group from a snapshot's stored colors.
   */
  private createStickersFromSnapshot(group: THREE.Group, stickerColors: Record<string, string>) {
    const half = CUBIE_SIZE / 2 + STICKER_DEPTH;

    for (const [face, colorHex] of Object.entries(stickerColors)) {
      let pos: [number, number, number], rot: [number, number, number];
      switch (face) {
        case 'R': pos = [half, 0, 0]; rot = [0, Math.PI / 2, 0]; break;
        case 'L': pos = [-half, 0, 0]; rot = [0, -Math.PI / 2, 0]; break;
        case 'U': pos = [0, half, 0]; rot = [-Math.PI / 2, 0, 0]; break;
        case 'D': pos = [0, -half, 0]; rot = [Math.PI / 2, 0, 0]; break;
        case 'F': pos = [0, 0, half]; rot = [0, 0, 0]; break;
        case 'B': pos = [0, 0, -half]; rot = [0, Math.PI, 0]; break;
        default: continue;
      }

      const geo = createRoundedStickerGeometry(STICKER_SCALE, STICKER_SCALE * STICKER_CORNER_RADIUS);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(colorHex),
        shininess: 0,
        specular: new THREE.Color(0x000000),
      });
      const sticker = new THREE.Mesh(geo, mat);
      sticker.position.set(...pos);
      sticker.rotation.set(...rot);
      sticker.userData.isSticker = true;
      sticker.userData.face = face;
      const localNormal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...rot));
      sticker.userData.normal = localNormal;
      group.add(sticker);
    }
  }

  /**
   * Rebuild internal cubeState by reading current visual sticker colors.
   */
  private rebuildCubeStateFromVisuals(): CubeStateData {
    const newState = createSolvedState();

    const faces: FaceKey[] = ['U', 'D', 'F', 'B', 'L', 'R'];
    for (const face of faces) {
      const faceColors: FaceColor[] = [];
      const targetPositions = this.getFaceCubiePositions(face);

      // Sort positions to match sticker index order (0-8)
      targetPositions.sort((a, b) => {
        const idxA = this.getStickerIndexOnFace(new THREE.Vector3(a.x, a.y, a.z), face);
        const idxB = this.getStickerIndexOnFace(new THREE.Vector3(b.x, b.y, b.z), face);
        return idxA - idxB;
      });

      for (const pos of targetPositions) {
        const cubie = this.cubies.find(c =>
          c.logicalPos.x === pos.x &&
          c.logicalPos.y === pos.y &&
          c.logicalPos.z === pos.z
        );
        if (!cubie) { faceColors.push('X'); continue; }

        const sticker = this.getStickerOnFace(cubie, face);
        if (sticker && sticker.material instanceof THREE.MeshPhongMaterial) {
          const colorHex = '#' + sticker.material.color.getHexString();
          let matched: FaceColor = 'X';
          for (const [key, value] of Object.entries(FACE_COLORS)) {
            if (value.toLowerCase() === colorHex.toLowerCase()) {
              matched = key as FaceColor;
              break;
            }
          }
          faceColors.push(matched);
        } else {
          faceColors.push('X');
        }
      }
      newState[face] = faceColors;
    }
    this.cubeState = newState;
    return newState;
  }

  cubieHasFace(cubie: Cubie, face: FaceKey): boolean {
    const { x, y, z } = cubie.logicalPos;
    switch (face) {
      case 'R': return x === 1;
      case 'L': return x === -1;
      case 'U': return y === 1;
      case 'D': return y === -1;
      case 'F': return z === 1;
      case 'B': return z === -1;
      default: return false;
    }
  }

  /**
   * Find the sticker on a cubie that currently faces the specified face direction.
   */
  private getStickerOnFace(cubie: Cubie, face: FaceKey): THREE.Mesh | null {
    const faceNormals: Record<string, THREE.Vector3> = {
      'U': new THREE.Vector3(0, 1, 0),
      'D': new THREE.Vector3(0, -1, 0),
      'F': new THREE.Vector3(0, 0, 1),
      'B': new THREE.Vector3(0, 0, -1),
      'L': new THREE.Vector3(-1, 0, 0),
      'R': new THREE.Vector3(1, 0, 0),
    };

    const targetNormal = faceNormals[face];

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
    this.cubeState = { ...state };
    this.isAnimating = false;
    this.activeDrag = null;
    this.activePivot = null;
    this.animQueue = [];
    this.moveHistory = [];
    this.buildCube(state);
  }

  getMoveHistory(): MoveType[] { return [...this.moveHistory]; }
  clearHistory() { this.moveHistory = []; }

  /**
   * Take a complete snapshot of all 27 cubies.
   */
  takeForceSnapshot(): ForceCubieSnapshot[] {
    const snapshots: ForceCubieSnapshot[] = [];
    for (const cubie of this.cubies) {
      const stickerColors: Record<string, string> = {};
      for (const child of cubie.mesh.children) {
        if (child.userData.isSticker && (child as THREE.Mesh).material instanceof THREE.MeshPhongMaterial) {
          const face = child.userData.face;
          const colorHex = '#' + ((child as THREE.Mesh).material as THREE.MeshPhongMaterial).color.getHexString();
          stickerColors[face] = colorHex;
        }
      }
      snapshots.push({
        logicalPos: {
          x: Math.round(cubie.logicalPos.x),
          y: Math.round(cubie.logicalPos.y),
          z: Math.round(cubie.logicalPos.z),
        },
        position: {
          x: cubie.mesh.position.x,
          y: cubie.mesh.position.y,
          z: cubie.mesh.position.z,
        },
        quaternion: {
          x: cubie.mesh.quaternion.x,
          y: cubie.mesh.quaternion.y,
          z: cubie.mesh.quaternion.z,
          w: cubie.mesh.quaternion.w,
        },
        stickerColors,
      });
    }
    return snapshots;
  }

  clearQueue() {
    this.animQueue = [];
  }
}
