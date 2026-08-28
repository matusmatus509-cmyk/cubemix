import * as THREE from 'three';
import {
  RubiksCube,
  ForceCubieSnapshot,
  TOTAL,
  faceNormalVec,
  snapshotToCubeState,
} from './RubiksCube';
import { FACE_KEYS } from './CubeLayout';
import { CubeInteraction } from './CubeInteraction';
import { CubeStateData, createSolvedState, MoveType, inverseMove, FaceKey } from './CubeState';

export class CubeScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private cube: RubiksCube;
  private cubeGroup: THREE.Group;
  private interaction: CubeInteraction;
  private animFrameId: number = 0;
  private container: HTMLElement;
  private ro: ResizeObserver | null = null;

  onForceActiveChange?: (active: boolean) => void;
  /** Fires for every executed move (drag, button, scramble, solve). */
  onUserMove?: (move: MoveType) => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = null;

    // Camera — aspect will be corrected on first resize
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0, 13.0);

    // Renderer — let CSS control the canvas size (width/height 100% in CSS).
    // We pass 1×1 initially and call onResize() immediately after mount so the
    // camera aspect + renderer drawingBuffer match the CSS-computed size.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(1, 1, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // Lighting
    this.setupLights();

    // Cube group (for whole-cube rotation by dragging)
    this.cubeGroup = new THREE.Group();
    this.scene.add(this.cubeGroup);

    // Isometric tilt matching the classic Rubik's cube photo angle:
    // x-tilt shows the top face clearly, y-tilt shows both left and right faces
    this.cubeGroup.rotation.x = 0.52;
    this.cubeGroup.rotation.y = 0.75;
    // Offset cube upward slightly to compensate for the x-tilt visual shift
    this.cubeGroup.position.y = 0.3;

    // Create cube
    const initialState = createSolvedState();
    this.cube = new RubiksCube(this.scene, this.cubeGroup, initialState);

    // Interaction
    this.interaction = new CubeInteraction(
      this.cube,
      this.camera,
      this.renderer,
      this.cubeGroup
    );

    // Connect move listener
    this.cube.setOnMove((move) => this.handleMoveExecuted(move));

    // Resize handler
    window.addEventListener('resize', this.onResize);
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.container);

    // Sync camera + renderer to the CSS-computed canvas size right away
    // (deferred one frame so the browser has finished layout)
    requestAnimationFrame(() => this.onResize());

    // Start render loop
    this.startRenderLoop();
  }

  private setupLights() {
    // Soft ambient so shadow faces aren't pitch-black
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    // Main key light from upper-left front — lights the top and left faces brightest
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-4, 9, 7);
    this.scene.add(key);

    // Fill light from right side — adds separation to the right face
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(7, 2, 4);
    this.scene.add(fill);

    // Subtle back/bottom rim to keep the cube from merging with the dark bg
    const rim = new THREE.DirectionalLight(0xffffff, 0.15);
    rim.position.set(0, -5, -6);
    this.scene.add(rim);
  }

  private startRenderLoop() {
    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);

      // Smoothly interpolate any in-progress drag
      this.cube.tickDragSmoothing();

      // Keep the force layer on whatever the viewer cannot see right now.
      this.updateForceLayer();

      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private onResize = () => {
    // Read CSS-computed size of the canvas element (set by .canvas-wrap CSS)
    const el = this.renderer.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    // Update the WebGL drawing buffer to match the CSS size (scaled by DPR)
    const dpr = Math.min(window.devicePixelRatio, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (this.renderer.domElement.width !== bw || this.renderer.domElement.height !== bh) {
      this.renderer.setSize(w, h, false);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  setOnStateChange(fn: (state: CubeStateData) => void) {
    this.cube.setOnStateChange(fn);
  }

  reset() {
    // Orientation first: arming reads which faces are out of sight, so the cube
    // has to be sitting at its default angle before the force goes on.
    this.resetRotation();
    this.cube.setState(createSolvedState());
    // The loaded force survives a reset (even one that has already been fully
    // revealed) — the cube is simply armed again from a solved start.
    const configured = this.cube.force.configuredState();
    if (configured) this.armForce(configured);
  }

  executeMove(move: MoveType) {
    this.cube.executeMove(move);
  }

  /** Back to the default isometric angle (Euler and quaternion stay in sync). */
  resetRotation() {
    this.cubeGroup.rotation.set(0.52, 0.75, 0);
  }

  getState(): CubeStateData {
    return this.cube.getState();
  }

  /** Get the sequence of inverse moves that will solve the cube */
  getSolveSequence(): MoveType[] {
    const history = this.cube.getMoveHistory();
    const solution: MoveType[] = [];
    for (let i = history.length - 1; i >= 0; i--) {
      solution.push(inverseMove(history[i]));
    }
    return solution;
  }

  /** Execute a move without recording it in the history */
  executeSolveMove(move: MoveType) {
    this.cube.executeMove(move, undefined, true);
  }

  clearHistory() {
    this.cube.clearHistory();
  }

  // ─── Force layer ─────────────────────────────────────────────

  /** True when a force is configured (whether or not it is still hidden). */
  hasForce(): boolean {
    return this.cube.force.isConfigured();
  }

  /** True while the force layer is still riding on the unseen faces. */
  isForceLive(): boolean {
    return this.cube.force.isArmed();
  }

  /** True once at least one face has been revealed wearing the force. */
  isForceInProgress(): boolean {
    return this.cube.force.isRevealing();
  }

  /** True while the cube may not be turned around — not mixed enough yet. */
  isRotationLocked(): boolean {
    return this.cube.force.isRotationLocked();
  }

  /** Load a force layer from a saved preset. It is live from this moment on. */
  setForceSnapshotFromData(snapshots: ForceCubieSnapshot[]) {
    this.armForce(snapshotToCubeState(snapshots));
  }

  /** Freeze the cube's current real state as the force layer. */
  setForceSnapshot() {
    this.armForce(this.cube.getState());
  }

  /** Current real cube state in the persisted preset format. */
  takeForceSnapshot(): ForceCubieSnapshot[] {
    return this.cube.takeForceSnapshot();
  }

  /** Remove the force layer — the cube goes back to being an ordinary cube. */
  clearForceSnapshot() {
    this.cube.force.clear();
    this.cube.repaintStickers();
    this.onForceActiveChange?.(false);
  }

  /** Load a force and drop it straight onto every face that is out of sight. */
  private armForce(state: CubeStateData) {
    this.cube.force.arm(state, this.computeFaceDots());
    this.cube.repaintStickers();
    this.onForceActiveChange?.(true);
  }

  /**
   * How each face is turned relative to the viewer.
   *
   * Negative = the face points at the camera (visible), positive = it is turned
   * away (hidden). A cube face is flat, so the sign measured at its centre holds
   * for every point on it — this test is exact, not an approximation.
   */
  private computeFaceDots(): Record<FaceKey, number> {
    this.camera.updateMatrixWorld(true);
    this.cubeGroup.updateMatrixWorld(true);

    const camPos = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const dots = {} as Record<FaceKey, number>;

    for (const face of FACE_KEYS) {
      const normal = faceNormalVec(face)
        .transformDirection(this.cubeGroup.matrixWorld)
        .normalize();
      const center = faceNormalVec(face)
        .multiplyScalar(1.5 * TOTAL)
        .applyMatrix4(this.cubeGroup.matrixWorld);
      dots[face] = normal.dot(center.sub(camPos).normalize());
    }

    return dots;
  }

  /**
   * Runs every frame. Two things happen here, both driven purely by how the
   * cube is turned:
   *
   *  - a face that turns out of sight gets the force layer put on it, unseen;
   *  - a forced face that turns back into view has its colours committed as the
   *    real ones. Nothing changes on screen at that instant (the face already
   *    shows them), but from then on that face is an honest part of the cube and
   *    is never forced again.
   *
   * Once all six faces have been through this the cube genuinely *is* the force
   * state and the layer retires itself.
   */
  private updateForceLayer() {
    // Mid-turn the moving layer is deliberately showing real colours; leave
    // everything alone until it has settled.
    if (!this.cube.force.isArmed() || this.cube.isBusy()) return;

    const update = this.cube.force.evaluate(this.computeFaceDots());

    // Committed faces must be written into the real state before repainting,
    // otherwise the repaint would put the real (old) colours back on screen.
    for (const face of update.commit) this.cube.commitForceFace(face);

    if (update.commit.length > 0 || update.hidden.length > 0) {
      this.cube.repaintStickers();
    }

    if (update.finished) {
      this.cube.force.retire();
      // The cube is now the force state, which the recorded history no longer
      // describes — replaying it backwards would not solve anything.
      this.cube.clearHistory();
      this.onForceActiveChange?.(false);
    }
  }

  private handleMoveExecuted(move: MoveType) {
    // Notify listeners of every executed move (used for the move counter).
    this.onUserMove?.(move);

    // A force that has already been delivered goes back on as soon as the cube
    // is mixed away from it, so the same force can be performed again and again.
    // Re-arm before counting, so this turn already counts toward the lock.
    if (this.cube.force.needsRearm()) {
      const configured = this.cube.force.configuredState();
      if (configured) this.armForce(configured);
    }

    this.cube.force.noteTurn();
  }

  destroy() {
    cancelAnimationFrame(this.animFrameId);
    this.interaction.destroy();
    this.ro?.disconnect();
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
