import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CubeStateData, FACE_COLORS, applyMove, MoveType, FaceKey, FaceColor } from './CubeState';

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

// World-space normals for each logical face (in the cube's default orientation)
const FACE_WORLD_NORMALS: Record<FaceKey, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, -1, 0),
  F: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(0, 0, -1),
  L: new THREE.Vector3(-1, 0, 0),
  R: new THREE.Vector3(1, 0, 0),
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
  // The Force Cube — starts as the saved snapshot and receives every move
  // applied to the Real Cube, keeping both states orientation-synchronized.
  private forceCubeState: CubeStateData | null = null;
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

  // ─── Force Cube API ───────────────────────────────────────────

  /** Set the Force Cube state (snapshot taken by the operator). */
  setForceCubeState(state: CubeStateData | null) {
    this.forceCubeState = state ? { ...state, U: [...state.U], D: [...state.D], F: [...state.F], B: [...state.B], L: [...state.L], R: [...state.R] } : null;
  }

  getForceCubeState(): CubeStateData | null {
    return this.forceCubeState;
  }

  /**
   * Render force colors: for each visible sticker, determine whether the face
   * it belongs to is currently visible to the camera. If visible, display the
   * Real Cube color; if hidden, display the Force Cube color.
   *
   * This method NEVER modifies either cube state.
   *
   * @param camera  The perspective camera used for visibility testing.
   */
  renderForceColors(camera: THREE.PerspectiveCamera) {
    if (!this.forceCubeState) return;

    // Compute which logical faces are currently visible to the camera.
    const visibleFaces = this.computeVisibleFaces(camera);

    // For every cubie, update each sticker's displayed color.
    for (const cubie of this.cubies) {
      const { x, y, z } = cubie.logicalPos;

      for (const child of cubie.mesh.children) {
        if (!child.userData.isSticker) continue;

        // Determine which logical face this sticker currently faces by
        // rotating its local normal through the cubie's current quaternion.
        const localNormal: THREE.Vector3 = child.userData.normal;
        const worldNormal = localNormal.clone().applyQuaternion(cubie.mesh.quaternion).normalize();
        const logicalFace = this.worldNormalToFaceKey(worldNormal);
        if (!logicalFace) continue;

        // Pick source state based on visibility.
        const state = visibleFaces.has(logicalFace) ? this.cubeState : this.forceCubeState!;
        const colorKey = this.getColorKeyFromState(state, x, y, z, logicalFace);
        const colorHex = FACE_COLORS[colorKey] ?? FACE_COLORS['X'];

        const mesh = child as THREE.Mesh;
        if (mesh.material instanceof THREE.MeshPhongMaterial) {
          mesh.material.color.set(colorHex);
        }
      }
    }
  }

  /**
   * Compute which logical faces are currently visible to the camera.
   * A face is visible when its world-space normal has a negative dot product
   * with the camera's forward direction (i.e. it faces the camera).
   */
  private computeVisibleFaces(camera: THREE.PerspectiveCamera): Set<FaceKey> {
    camera.updateMatrixWorld(true);
    this.cubeGroup.updateMatrixWorld(true);

    const camForward = new THREE.Vector3(0, 0, -1)
      .transformDirection(camera.matrixWorld)
      .normalize();

    const visible = new Set<FaceKey>();
    for (const [face, localNormal] of Object.entries(FACE_WORLD_NORMALS) as [FaceKey, THREE.Vector3][]) {
      const worldNormal = localNormal.clone().transformDirection(this.cubeGroup.matrixWorld).normalize();
      if (worldNormal.dot(camForward) < 0) {
        visible.add(face);
      }
    }
    return visible;
  }

  /**
   * Map a world-space normal (in cubie-local space after quaternion applied)
   * to the logical face key it best matches.
   */
  private worldNormalToFaceKey(normal: THREE.Vector3): FaceKey | null {
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
   * Get the color key (U/D/F/B/L/R/X) for a sticker on the given face
   * of the cubie at (x, y, z) from the provided state.
   */
  private getColorKeyFromState(state: CubeStateData, x: number, y: number, z: number, face: FaceKey): FaceColor {
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
    return state[face][idx] ?? 'X';
  }

  // ─── Build / stickers ────────────────────────────────────────

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

  // ─── Interactive drag API ────────────────────────────────────

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
   * Kept for API compatibility; finger tracking is applied directly in setDragAngle.
   */
  tickDragSmoothing() {
    return;
  }

  /**
   * Update the layer angle directly from the pointer — the layer follows the
   * finger exactly 1:1 with no smoothing lag.
   */
  setDragAngle(angle: number) {
    if (!this.activeDrag) return;
    this.activeDrag.targetAngle = angle;
    this.activeDrag.currentAngle = angle;
    this.activeDrag.pivot.quaternion.setFromAxisAngle(this.activeDrag.axisVec, angle);
  }

  /**
   * End drag: snap to nearest 90°.
   * Commit threshold: 45°.
   */
  endDrag(velocity = 0) {
    if (!this.activeDrag) return;
    const drag = this.activeDrag;
    this.activeDrag = null;

    const halfPi = Math.PI / 2;
    const commitThreshold = Math.PI / 4; // 45°
    const FLICK_VELOCITY = 0.004;
    const FLICK_MIN_ANGLE = Math.PI / 18; // 10°

    const decisionAngle = drag.targetAngle;

    let commit = Math.abs(decisionAngle) >= commitThreshold;
    let direction = decisionAngle >= 0 ? 1 : -1;

    if (!commit && Math.abs(velocity) >= FLICK_VELOCITY && Math.abs(decisionAngle) >= FLICK_MIN_ANGLE) {
      commit = true;
      direction = velocity > 0 ? 1 : -1;
    }

    if (commit) {
      const targetAngle = direction * halfPi;
      const move = this.getMoveFromDrag(drag.axis, drag.layer, direction);
      this.snapDragTo(drag, targetAngle, move);
    } else {
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
    this.isSettling = true;

    const startAngle = drag.currentAngle;
    const startQuat = new THREE.Quaternion().setFromAxisAngle(drag.axisVec, startAngle);
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(drag.axisVec, targetAngle);

    const diff = Math.abs(targetAngle - startAngle);
    if (diff < 0.01) {
      this.finalizeDrag(drag, targetAngle, move);
      return;
    }

    const startTime = performance.now();
    const duration = Math.max(60, SNAP_ANIM_DURATION * (diff / (Math.PI / 2)));

    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
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
    // Apply the move to BOTH states if there is one
    if (move) {
      this.cubeState = applyMove(this.cubeState, move);
      if (this.forceCubeState) {
        this.forceCubeState = applyMove(this.forceCubeState, move);
      }
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

    this.isSettling = false;

    this.onStateChangeCb?.(this.cubeState);
    if (move) {
      this.onMoveCb?.(move);
    }

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

      // Apply move to Real Cube state
      this.cubeState = applyMove(this.cubeState, move);
      // Mirror move to Force Cube state
      if (this.forceCubeState) {
        this.forceCubeState = applyMove(this.forceCubeState, move);
      }
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

  // ─── Misc helpers ─────────────────────────────────────────────

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

  clearQueue() {
    this.animQueue = [];
  }
}
