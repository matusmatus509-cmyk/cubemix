import * as THREE from 'three';
import { RubiksCube, ForceCubieSnapshot } from './RubiksCube';
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

  // Force mode
  private forceSnapshot: ForceCubieSnapshot[] | null = null;
  private forceModeActive = false;
  private initialVisibleFaces: Set<FaceKey> = new Set();
  private forcedFaces: Set<FaceKey> = new Set();
  private faceNormals: Record<FaceKey, THREE.Vector3> = {
    U: new THREE.Vector3(0, 1, 0),
    D: new THREE.Vector3(0, -1, 0),
    F: new THREE.Vector3(0, 0, 1),
    B: new THREE.Vector3(0, 0, -1),
    L: new THREE.Vector3(-1, 0, 0),
    R: new THREE.Vector3(1, 0, 0),
  };

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

      // Force mode: check if initially visible faces have become hidden
      if (this.forceModeActive) {
        this.checkAndForceNewlyHidden();
      }

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
    const solved = createSolvedState();
    this.cube.setState(solved);
    this.forceModeActive = false;
    this.initialVisibleFaces.clear();
    this.forcedFaces.clear();
    this.onForceActiveChange?.(false);
  }

  executeMove(move: MoveType) {
    this.cube.executeMove(move);
  }

  resetRotation() {
    this.cubeGroup.rotation.x = 0.52;
    this.cubeGroup.rotation.y = 0.75;
    this.cubeGroup.rotation.z = 0;
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

  // ─── Force Mode ──────────────────────────────────────────────

  /** Clear force snapshot and reset all force state */
  clearForceSnapshot() {
    this.forceSnapshot = null;
    this.forceModeActive = false;
    this.initialVisibleFaces.clear();
    this.forcedFaces.clear();
    this.onForceActiveChange?.(false);
  }

  /** Capture the current live state as a ForceCubieSnapshot array (for saving to presets) */
  takeForceSnapshot(): ForceCubieSnapshot[] {
    return this.cube.takeForceSnapshot();
  }

  /** Store complete cube snapshot from current live state */
  setForceSnapshot() {
    this.forceSnapshot = this.cube.takeForceSnapshot();
  }

  /** Set force snapshot directly from previously saved data (does NOT change the cube's visual state) */
  setForceSnapshotFromData(snapshots: ForceCubieSnapshot[]) {
    this.forceSnapshot = snapshots;
  }

  getForceSnapshot(): ForceCubieSnapshot[] | null {
    return this.forceSnapshot;
  }

  /** Activate force mode */
  activateForceMode() {
    if (this.isForceModeActive() || !this.forceSnapshot) return;

    this.forceModeActive = true;
    this.forcedFaces.clear();

    // Record which faces are currently visible
    const currentVis = this.computeFaceVisibility();
    this.initialVisibleFaces.clear();
    for (const [face, isVisible] of Object.entries(currentVis)) {
      if (isVisible) this.initialVisibleFaces.add(face as FaceKey);
    }

    // Immediately force the currently hidden faces
    this.applyForceToCurrentlyHiddenFaces();

    this.onForceActiveChange?.(true);
  }

  /** Deactivate force mode */
  deactivateForceMode() {
    this.forceModeActive = false;
    this.onForceActiveChange?.(false);
  }

  isForceModeActive(): boolean { return this.forceModeActive; }

  /** Immediately apply force to faces currently hidden */
  private applyForceToCurrentlyHiddenFaces() {
    if (!this.forceSnapshot) return;

    const currentVis = this.computeFaceVisibility();
    const facesToForce: FaceKey[] = [];

    for (const [face, isVisible] of Object.entries(currentVis)) {
      if (!isVisible && !this.forcedFaces.has(face as FaceKey)) {
        facesToForce.push(face as FaceKey);
      }
    }

    if (facesToForce.length > 0) {
      this.cube.applyForceSnapshot(this.forceSnapshot, facesToForce);
      facesToForce.forEach(f => this.forcedFaces.add(f));
    }
  }

  private computeFaceVisibility(): Record<FaceKey, boolean> {
    this.camera.updateMatrixWorld(true);
    this.cubeGroup.updateMatrixWorld(true);

    const camForward = new THREE.Vector3(0, 0, -1).transformDirection(this.camera.matrixWorld).normalize();

    const result: Record<FaceKey, boolean> = {} as any;

    for (const [face, localNormal] of Object.entries(this.faceNormals)) {
      const worldNormal = localNormal.clone().transformDirection(this.cubeGroup.matrixWorld).normalize();
      result[face as FaceKey] = worldNormal.dot(camForward) < 0;
    }

    return result;
  }

  /** Called each frame while force mode is active (Phase 1 running) */
  private checkAndForceNewlyHidden() {
    if (!this.forceSnapshot || !this.forceModeActive) return;

    const currentVis = this.computeFaceVisibility();
    const newlyHidden: FaceKey[] = [];

    // Each initially-visible face that has rotated away from camera gets forced
    // while it is hidden so the swap is never seen by the user.
    for (const face of this.initialVisibleFaces) {
      if (!currentVis[face] && !this.forcedFaces.has(face)) {
        newlyHidden.push(face);
      }
    }

    if (newlyHidden.length > 0) {
      for (const face of newlyHidden) {
        this.cube.applyForceSnapshot(this.forceSnapshot, [face]);
        this.forcedFaces.add(face);
      }
    }

    // Safety: if all 6 faces are forced, clean up
    if (this.forcedFaces.size >= 6) {
      this.forceModeActive = false;
      this.initialVisibleFaces.clear();
      this.forcedFaces.clear();
      this.onForceActiveChange?.(false);
    }
  }

  private handleMoveExecuted(move: MoveType) {
    // Notify listeners of every executed move (used for the move counter).
    this.onUserMove?.(move);

    if (!this.forceModeActive || !this.forceSnapshot) return;

    // After every move, check if all remaining unforced faces are currently
    // visible. If so, they will never rotate away unseen — trigger Phase 2
    // automatically to force them visibly (the user sees the change happen).
    const unforcedFaces = (['U', 'D', 'F', 'B', 'L', 'R'] as FaceKey[]).filter(
      f => !this.forcedFaces.has(f)
    );

    if (unforcedFaces.length === 0) return;

    const currentVis = this.computeFaceVisibility();
    const allUnforcedAreVisible = unforcedFaces.every(f => currentVis[f]);

    if (allUnforcedAreVisible) {
      // All remaining faces are visible — Phase 1 can't do anything more.
      // Automatically trigger Phase 2 (force remaining visible faces directly).
      setTimeout(() => this.executePhase2(), 80);
    }
  }

  private executePhase2() {
    if (!this.forceSnapshot) return;

    // Force all faces that still haven't been forced yet (the ones that were
    // visible when force activated and haven't rotated away during Phase 1).
    const allFaces: FaceKey[] = ['U', 'D', 'F', 'B', 'L', 'R'];
    for (const face of allFaces) {
      if (!this.forcedFaces.has(face)) {
        this.cube.applyForceSnapshot(this.forceSnapshot, [face]);
        this.forcedFaces.add(face);
      }
    }

    // Force complete — deactivate and reset all flags
    this.forceModeActive = false;
    this.initialVisibleFaces.clear();
    this.forcedFaces.clear();
    this.onForceActiveChange?.(false);
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
