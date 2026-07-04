import * as THREE from 'three';
import { RubiksCube } from './RubiksCube';
import { CubeInteraction } from './CubeInteraction';
import { CubeStateData, createSolvedState, MoveType, inverseMove } from './CubeState';

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

  // The stored Force Cube state (set by the operator).
  // When non-null, renderForceColors runs every frame.
  private forceState: CubeStateData | null = null;

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

    // Isometric tilt matching the classic Rubik's cube photo angle
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
    requestAnimationFrame(() => this.onResize());

    // Start render loop
    this.startRenderLoop();
  }

  private setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-4, 9, 7);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(7, 2, 4);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.15);
    rim.position.set(0, -5, -6);
    this.scene.add(rim);
  }

  private startRenderLoop() {
    const animate = () => {
      this.animFrameId = requestAnimationFrame(animate);

      // Smoothly interpolate any in-progress drag
      this.cube.tickDragSmoothing();

      // Force system: update sticker colors every frame based on visibility.
      // renderForceColors is a no-op when forceState is null.
      if (this.forceState) {
        this.cube.renderForceColors(this.camera);
      }

      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private onResize = () => {
    const el = this.renderer.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
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
    // Keep the force snapshot active across resets so force always works.
    if (this.forceState) {
      this.cube.setForceCubeState(this.forceState);
    }
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

  // ─── Force System ────────────────────────────────────────────

  /**
   * Save the current cube's logical state as the Force Cube.
   * From this point on, every move applied to the Real Cube is also mirrored
   * to the Force Cube, keeping both orientation-synchronized.
   * Hidden faces will always display Force Cube colors; visible faces always
   * display Real Cube colors.
   */
  setForceSnapshot() {
    this.forceState = this.cube.getState();
    this.cube.setForceCubeState(this.forceState);
  }

  /**
   * Load a previously saved CubeStateData as the Force Cube without changing
   * the visual cube state. Used when loading a preset.
   */
  setForceSnapshotFromData(state: CubeStateData) {
    this.forceState = state;
    this.cube.setForceCubeState(state);
  }

  /** Return the current Force Cube state (or null if none is set). */
  getForceSnapshot(): CubeStateData | null {
    return this.forceState;
  }

  /** Remove the Force Cube snapshot entirely. */
  clearForceSnapshot() {
    this.forceState = null;
    this.cube.setForceCubeState(null);
  }

  /**
   * Capture the current live cube state as a CubeStateData for saving to a preset.
   */
  takeForceSnapshot(): CubeStateData {
    return this.cube.getState();
  }

  // isForceModeActive kept for API compatibility — force is always "active"
  // when a snapshot is present, so this just reflects snapshot presence.
  isForceModeActive(): boolean {
    return this.forceState !== null;
  }

  private handleMoveExecuted(move: MoveType) {
    this.onUserMove?.(move);
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
