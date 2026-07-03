import * as THREE from 'three';
import { RubiksCube, AxisKey } from './RubiksCube';

/**
 * Drag-to-rotate interaction for the Rubik's Cube.
 *
 * Algorithm:
 *  1. On pointer-down: raycast to find the hit point on the cube.
 *  2. From the hit normal, determine the two candidate rotation axes.
 *  3. For each candidate, compute screen-space swipe direction.
 *  4. While dragging, whichever candidate first exceeds threshold wins.
 *  5. The layer follows the finger in real time.
 *  6. On pointer-up, snap to nearest 90°.
 *  7. Drags that start outside the cube rotate the whole cube group.
 */

interface CandidateDrag {
  swipeAxis: THREE.Vector3;
  rotAxis: THREE.Vector3;
  screenDir: { x: number; y: number };
}

interface DragState {
  screenDir: { x: number; y: number };
  angle: number;
  chosenCandidate: CandidateDrag;
  // For flick detection: last angle + timestamp and smoothed angular velocity (rad/ms)
  lastAngle: number;
  lastTime: number;
  velocity: number;
}

interface PointerState {
  down: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  hitPoint: THREE.Vector3 | null;
  hitNormalLocal: THREE.Vector3 | null;
  hitCubiePos: THREE.Vector3 | null;
  onCube: boolean;
  candidates: CandidateDrag[] | null;
  drag: DragState | null;
  cubeGroupRotating: boolean;
  // Force trigger
  forceTriggerTimer: number | null;
  forceTriggerStart: { x: number; y: number } | null;
}

export class CubeInteraction {
  private cube: RubiksCube;
  private camera: THREE.PerspectiveCamera;
  private raycaster: THREE.Raycaster;
  private renderer: THREE.WebGLRenderer;
  private cubeGroup: THREE.Group;
  private ptr: PointerState;

  private readonly MIN_DRAG_PX = 8;
  private readonly ORBIT_SENSITIVITY = 0.008;
  private readonly FORCE_TRIGGER_DELAY = 300; // ms
  private readonly CORNER_THRESHOLD = 50;     // px from corner

  // Callback for force trigger
  onForceTrigger?: () => void;

  constructor(
    cube: RubiksCube,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    cubeGroup: THREE.Group,
  ) {
    this.cube = cube;
    this.camera = camera;
    this.renderer = renderer;
    this.cubeGroup = cubeGroup;
    this.raycaster = new THREE.Raycaster();
    this.ptr = this.fresh();
    this.bindEvents();
  }

  /* ── helpers ── */

  private fresh(): PointerState {
    return {
      down: false, startX: 0, startY: 0, lastX: 0, lastY: 0,
      hitPoint: null, hitNormalLocal: null, hitCubiePos: null,
      onCube: false, candidates: null, drag: null, cubeGroupRotating: false,
      forceTriggerTimer: null,
      forceTriggerStart: null,
    };
  }

  private pos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    if (e instanceof TouchEvent) {
      const t = e.touches[0] ?? e.changedTouches[0];
      return { x: t.clientX, y: t.clientY };
    }
    return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
  }

  private ndc(x: number, y: number): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((x - r.left) / r.width) * 2 - 1,
      -((y - r.top) / r.height) * 2 + 1,
    );
  }

  private raycast(x: number, y: number): THREE.Intersection | null {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const meshes: THREE.Object3D[] = [];
    this.cubeGroup.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length > 0 ? hits[0] : null;
  }

  private snapNormal(worldN: THREE.Vector3): THREE.Vector3 {
    const inv = new THREE.Matrix4().copy(this.cubeGroup.matrixWorld).invert();
    const loc = worldN.clone().transformDirection(inv).normalize();
    const ax = Math.abs(loc.x), ay = Math.abs(loc.y), az = Math.abs(loc.z);
    if (ax >= ay && ax >= az) return new THREE.Vector3(Math.sign(loc.x), 0, 0);
    if (ay >= ax && ay >= az) return new THREE.Vector3(0, Math.sign(loc.y), 0);
    return new THREE.Vector3(0, 0, Math.sign(loc.z));
  }

  private candidateAxes(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ay >= ax && ay >= az) return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
    if (ax >= ay && ax >= az) return [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)];
  }

  private computeScreenDir(
    _hitPointWorld: THREE.Vector3,
    hitPointLocal: THREE.Vector3,
    swipeAxisLocal: THREE.Vector3,
    rotAxisLocal: THREE.Vector3,
  ): { x: number; y: number } {
    const swipeAxisWorld = swipeAxisLocal.clone().transformDirection(this.cubeGroup.matrixWorld).normalize();
    const camMatrix = this.camera.matrixWorld;
    const camRight = new THREE.Vector3().setFromMatrixColumn(camMatrix, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(camMatrix, 1);

    const screenX = swipeAxisWorld.dot(camRight);
    const screenY = -swipeAxisWorld.dot(camUp);

    const len = Math.sqrt(screenX * screenX + screenY * screenY);
    if (len < 0.0001) return { x: 1, y: 0 };
    const dx = screenX / len;
    const dy = screenY / len;

    const velocityLocal = new THREE.Vector3().crossVectors(rotAxisLocal, hitPointLocal);
    const sign = velocityLocal.dot(swipeAxisLocal) > 0 ? 1 : -1;

    return { x: dx * sign, y: dy * sign };
  }

  private signedDist(start: { x: number; y: number }, cur: { x: number; y: number }, dir: { x: number; y: number }): number {
    return (cur.x - start.x) * dir.x + (cur.y - start.y) * dir.y;
  }

  /** Find the logical cubie position from a hit intersection */
  private getCubieLogicalPos(hit: THREE.Intersection): THREE.Vector3 | null {
    let obj: THREE.Object3D | null = hit.object;
    while (obj && obj.parent !== this.cubeGroup) {
      obj = obj.parent;
    }
    if (!obj) return null;
    const cubie = this.cube.cubies.find(c => c.mesh === obj);
    return cubie ? cubie.logicalPos.clone() : null;
  }

  /** Get the layer value for a given axis from a cubie position */
  private getLayer(cubiePos: THREE.Vector3, axis: AxisKey): number {
    return Math.round(cubiePos[axis]);
  }

  /**
   * Compute a sensitivity that maps one full swipe across the cube's
   * screen-space size to exactly 90°.
   * This ensures one natural swipe = one layer turn.
   */
  private computeSensitivity(): number {
    // The cube spans roughly 3 units (from -1.5 to +1.5 in local space).
    const cubeHalfSize = 1.5;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();

    // Measure the cube's screen size along the CAMERA's right axis (always
    // parallel to the screen) instead of the cube's local X axis. This makes
    // the measurement independent of how the cube is currently rotated, so the
    // swipe→angle ratio stays identical whether the cube (or force mode) has
    // moved it into any orientation.
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();

    const center = new THREE.Vector3(0, 0, 0);
    center.applyMatrix4(this.cubeGroup.matrixWorld);
    const edge = center.clone().add(camRight.multiplyScalar(cubeHalfSize));

    const toPx = (v: THREE.Vector3) => {
      const p = v.clone().project(this.camera);
      return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height };
    };
    const cPx = toPx(center);
    const ePx = toPx(edge);
    // Full 2D screen distance so the measure never collapses due to projection.
    const cubeScreenRadius = Math.hypot(ePx.x - cPx.x, ePx.y - cPx.y);

    // The layer follows the finger at a 1:1-ish ratio: a full 90° turn
    // requires a swipe of roughly 1.4× the cube diameter — fast and direct.
    const swipeForFullTurn = cubeScreenRadius * 2 * 1.4;
    if (swipeForFullTurn < 10) return 0.004; // fallback
    return (Math.PI / 2) / swipeForFullTurn;
  }

  /**
   * Rotate the whole cube in screen-space
   */
  private rotateCubeByScreenDelta(dx: number, dy: number) {
    this.camera.updateMatrixWorld();

    const camMatrix = this.camera.matrixWorld;
    const camRight = new THREE.Vector3().setFromMatrixColumn(camMatrix, 0).normalize();
    const camUp = new THREE.Vector3().setFromMatrixColumn(camMatrix, 1).normalize();

    const yaw = dx * this.ORBIT_SENSITIVITY;
    const pitch = dy * this.ORBIT_SENSITIVITY;

    const qYaw = new THREE.Quaternion().setFromAxisAngle(camUp, yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(camRight, pitch);

    this.cubeGroup.quaternion.premultiply(qYaw);
    this.cubeGroup.quaternion.premultiply(qPitch);
    this.cubeGroup.quaternion.normalize();
  }

  /* ── Event binding ── */

  private onPointerDown = (e: MouseEvent | TouchEvent) => {
    // Block new input while a drag, snap-settle, or programmatic animation
    // is still in progress — prevents a second turn from starting mid-snap.
    if (this.cube.isBusy()) return;
    e.preventDefault();

    const p = this.pos(e);
    this.ptr = this.fresh();
    this.ptr.down = true;
    this.ptr.startX = p.x;
    this.ptr.startY = p.y;
    this.ptr.lastX = p.x;
    this.ptr.lastY = p.y;

    // Check for corner long-press (force trigger)
    const rect = this.renderer.domElement.getBoundingClientRect();
    const isInCorner =
      (p.x - rect.left < this.CORNER_THRESHOLD || rect.right - p.x < this.CORNER_THRESHOLD) &&
      (p.y - rect.top < this.CORNER_THRESHOLD || rect.bottom - p.y < this.CORNER_THRESHOLD);

    if (isInCorner) {
      this.ptr.forceTriggerStart = { x: p.x, y: p.y };
      this.ptr.forceTriggerTimer = window.setTimeout(() => {
        this.onForceTrigger?.();
        this.ptr.forceTriggerTimer = null;
      }, this.FORCE_TRIGGER_DELAY);
    }

    // Raycast
    const hit = this.raycast(p.x, p.y);
    if (hit && hit.face) {
      this.ptr.onCube = true;
      this.ptr.hitPoint = hit.point.clone();
      const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      this.ptr.hitNormalLocal = this.snapNormal(worldNormal);
      this.ptr.hitCubiePos = this.getCubieLogicalPos(hit);

      // Compute candidates
      const [axis1, axis2] = this.candidateAxes(this.ptr.hitNormalLocal);
      const hitLocal = hit.point.clone();
      const inv = new THREE.Matrix4().copy(this.cubeGroup.matrixWorld).invert();
      hitLocal.applyMatrix4(inv);

      const swipe1 = axis2.clone();
      const swipe2 = axis1.clone();

      this.ptr.candidates = [
        {
          rotAxis: axis1,
          swipeAxis: swipe1,
          screenDir: this.computeScreenDir(hit.point, hitLocal, swipe1, axis1),
        },
        {
          rotAxis: axis2,
          swipeAxis: swipe2,
          screenDir: this.computeScreenDir(hit.point, hitLocal, swipe2, axis2),
        },
      ];
    } else {
      this.ptr.onCube = false;
    }
  };

  private onPointerMove = (e: MouseEvent | TouchEvent) => {
    if (!this.ptr.down) return;
    e.preventDefault();

    const p = this.pos(e);
    const dx = p.x - this.ptr.lastX;
    const dy = p.y - this.ptr.lastY;

    // Cancel force trigger if moved too far
    if (this.ptr.forceTriggerTimer && this.ptr.forceTriggerStart) {
      const dist = Math.sqrt(
        Math.pow(p.x - this.ptr.forceTriggerStart.x, 2) +
        Math.pow(p.y - this.ptr.forceTriggerStart.y, 2)
      );
      if (dist > 15) {
        clearTimeout(this.ptr.forceTriggerTimer);
        this.ptr.forceTriggerTimer = null;
      }
    }

    if (!this.ptr.onCube) {
      // Whole-cube rotation
      this.ptr.cubeGroupRotating = true;
      this.rotateCubeByScreenDelta(dx, dy);
      this.ptr.lastX = p.x;
      this.ptr.lastY = p.y;
      return;
    }

    // Layer drag — axis decision
    if (!this.ptr.drag && this.ptr.candidates && this.ptr.hitCubiePos) {
      const totalDx = p.x - this.ptr.startX;
      const totalDy = p.y - this.ptr.startY;
      const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

      if (totalDist >= this.MIN_DRAG_PX) {
        // Pick the candidate with largest projection
        let bestIdx = 0;
        let bestProj = 0;
        for (let i = 0; i < this.ptr.candidates.length; i++) {
          const c = this.ptr.candidates[i];
          const proj = Math.abs(this.signedDist(
            { x: this.ptr.startX, y: this.ptr.startY },
            p,
            c.screenDir
          ));
          if (proj > bestProj) {
            bestProj = proj;
            bestIdx = i;
          }
        }

        const winner = this.ptr.candidates[bestIdx];
        const axisKey: AxisKey = winner.rotAxis.x !== 0 ? 'x' : winner.rotAxis.y !== 0 ? 'y' : 'z';
        const layer = this.getLayer(this.ptr.hitCubiePos, axisKey);

        const session = this.cube.beginDrag(axisKey, layer, winner.rotAxis);
        if (session) {
          this.ptr.drag = {
            screenDir: winner.screenDir,
            angle: 0,
            chosenCandidate: winner,
            lastAngle: 0,
            lastTime: performance.now(),
            velocity: 0,
          };
        }

        // Cancel force trigger when dragging
        if (this.ptr.forceTriggerTimer) {
          clearTimeout(this.ptr.forceTriggerTimer);
          this.ptr.forceTriggerTimer = null;
        }
      }
    }

    // Layer drag — continuous angle update
    if (this.ptr.drag) {
      const sens = this.computeSensitivity();
      const dist = this.signedDist(
        { x: this.ptr.startX, y: this.ptr.startY },
        p,
        this.ptr.drag.screenDir
      );
      // Clamp to ±90° so the layer can never overshoot a quarter turn
      const halfPi = Math.PI / 2;
      const rawAngle = dist * sens;
      const clampedAngle = Math.max(-halfPi, Math.min(halfPi, rawAngle));
      this.cube.setDragAngle(clampedAngle);

      // Track angular velocity (rad/ms) with light smoothing for flick detection.
      const nowT = performance.now();
      const dtA = nowT - this.ptr.drag.lastTime;
      if (dtA > 0) {
        const instV = (clampedAngle - this.ptr.drag.lastAngle) / dtA;
        this.ptr.drag.velocity = this.ptr.drag.velocity * 0.6 + instV * 0.4;
        this.ptr.drag.lastAngle = clampedAngle;
        this.ptr.drag.lastTime = nowT;
      }
    }

    this.ptr.lastX = p.x;
    this.ptr.lastY = p.y;
  };

  private onPointerUp = (_e: MouseEvent | TouchEvent) => {
    if (!this.ptr.down) return;

    // Cancel force trigger timer
    if (this.ptr.forceTriggerTimer) {
      clearTimeout(this.ptr.forceTriggerTimer);
      this.ptr.forceTriggerTimer = null;
    }

    if (this.cube.isDragging()) {
      // If the finger paused before lifting, the flick is stale — ignore it.
      let releaseVelocity = 0;
      if (this.ptr.drag) {
        const idle = performance.now() - this.ptr.drag.lastTime;
        releaseVelocity = idle < 90 ? this.ptr.drag.velocity : 0;
      }
      this.cube.endDrag(releaseVelocity);
    }

    this.ptr = this.fresh();
  };

  private bindEvents() {
    const el = this.renderer.domElement;
    // Prevent the browser from stealing touch events for scroll/zoom
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';
    el.addEventListener('mousedown', this.onPointerDown, { passive: false });
    el.addEventListener('mousemove', this.onPointerMove, { passive: false });
    window.addEventListener('mouseup', this.onPointerUp);
    el.addEventListener('touchstart', this.onPointerDown, { passive: false });
    el.addEventListener('touchmove', this.onPointerMove, { passive: false });
    window.addEventListener('touchend', this.onPointerUp);
    window.addEventListener('touchcancel', this.onPointerUp);
  }

  destroy() {
    const el = this.renderer.domElement;
    el.removeEventListener('mousedown', this.onPointerDown);
    el.removeEventListener('mousemove', this.onPointerMove);
    window.removeEventListener('mouseup', this.onPointerUp);
    el.removeEventListener('touchstart', this.onPointerDown);
    el.removeEventListener('touchmove', this.onPointerMove);
    window.removeEventListener('touchend', this.onPointerUp);
    window.removeEventListener('touchcancel', this.onPointerUp);
  }
}
