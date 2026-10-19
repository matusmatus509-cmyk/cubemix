import * as THREE from 'three';
import {
  RubiksCube,
  ForceCubieSnapshot,
  TOTAL,
  faceNormalVec,
  snapshotToCubeState,
} from './RubiksCube';
import { FACE_KEYS } from './CubeLayout';
import { FaceDots } from './HiddenForce';
import { CubeInteraction } from './CubeInteraction';
import { CubeStateData, createSolvedState, MoveType } from './CubeState';

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
  private destroyed = false;
  private forceTick = 0;
  private operation = 0;
  private running = false;
  private worker: Worker | null = null;
  private cancelWait: (() => void) | null = null;
  onBusyChange?: (busy: boolean) => void;
  onError?: (message: string) => void;

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
    requestAnimationFrame(() => { if (!this.destroyed) this.onResize(); });

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
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  setOnStateChange(fn: (state: CubeStateData) => void) {
    this.cube.setOnStateChange(fn);
  }

  reset() {
    this.cancelOperation();
    this.interaction.cancel();
    // Cancel every pending animation before restoring the solved orientation.
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

  isBusy() { return this.running || this.cube.isBusy(); }

  private setRunning(value: boolean) {
    this.running = value;
    this.interaction.setEnabled(!value);
    this.onBusyChange?.(value);
  }

  private cancelOperation() {
    this.operation++;
    this.worker?.terminate();
    this.worker = null;
    this.cancelWait?.();
    this.cancelWait = null;
    this.setRunning(false);
  }

  private plan(target: CubeStateData): Promise<MoveType[]> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {type: 'module'});
      this.worker = worker;
      this.cancelWait = () => resolve([]);
      const finish = () => { worker.terminate(); this.worker = null; this.cancelWait = null; };
      worker.onmessage = ({data}) => {
        if (this.worker !== worker) return;
        finish();
        if (data.error) reject(new Error(data.error)); else resolve(data.moves);
      };
      worker.onerror = () => { if (this.worker !== worker) return; finish(); reject(new Error('Riešič kocky sa nepodarilo spustiť.')); };
      worker.postMessage({from: this.cube.getState(), to: target});
    });
  }

  private async play(moves: MoveType[], token: number) {
    for (const move of moves) {
      if (token !== this.operation || this.destroyed) return;
      await new Promise<void>(resolve => {
        this.cancelWait = resolve;
        this.cube.executeMove(move, () => { this.cancelWait = null; resolve(); });
      });
    }
  }

  async runMoves(moves: MoveType[]) {
    if (this.isBusy()) return;
    const token = ++this.operation;
    this.setRunning(true);
    try {
      await this.play(moves, token);
    } finally {
      if (token === this.operation) this.setRunning(false);
    }
    if (token === this.operation) for (let i = 0; i < moves.length; i++) this.cube.force.noteTurn();
  }

  async solve() {
    if (this.isBusy()) return;
    await this.transition(createSolvedState());
  }

  private async transition(target: CubeStateData) {
    const token = ++this.operation;
    this.setRunning(true);
    try {
      const moves = await this.plan(target);
      if (token !== this.operation || this.destroyed) return;
      await this.play(moves, token);
      if (token !== this.operation) return;
      // Explicit Solve must stay solved; mixing can re-arm the retained preset.
      this.cube.force.retire();
      this.onForceActiveChange?.(false);
    } catch (error) {
      if (token === this.operation) this.onError?.(error instanceof Error ? error.message : 'Operácia zlyhala.');
    } finally {
      if (token === this.operation) this.setRunning(false);
    }
  }

  // ─── Force layer ─────────────────────────────────────────────

  /** True when a force is configured (whether or not it is still hidden). */
  hasForce(): boolean {
    return this.cube.force.isConfigured();
  }

  /** True while hidden legal completions are active. */
  isForceLive(): boolean {
    return this.cube.force.isArmed();
  }

  /** True while an operation is running. */
  isForceInProgress(): boolean {
    return this.running && this.cube.force.isReady();
  }

  /** Orbit is unrestricted: force never relies on hiding an illegal state. */
  isRotationLocked(): boolean {
    return this.cube.force.isRotationLocked();
  }

  /** Load a force layer from a saved preset. It is live from this moment on. */
  setForceSnapshotFromData(snapshots: ForceCubieSnapshot[]): boolean {
    try {
      if (this.isBusy()) throw new Error('Počkaj na dokončenie ťahu.');
      this.armForce(snapshotToCubeState(snapshots));
      return true;
    } catch (error) {
      this.onError?.(error instanceof Error ? error.message : 'Neplatný preset.');
      return false;
    }
  }

  /** Freeze the cube's current real state as the force layer. */
  setForceSnapshot() {
    if (!this.isBusy()) this.armForce(this.cube.getState());
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

  /** Configure a target without changing any stickers. */
  private armForce(state: CubeStateData) {
    this.cube.force.arm(state);
    this.cube.repaintStickers();
    this.onForceActiveChange?.(true);
  }

  private computeFaceDots(): FaceDots {
    this.camera.updateMatrixWorld(true);
    this.cubeGroup.updateMatrixWorld(true);
    const camera = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const dots = {} as FaceDots;
    for (const face of FACE_KEYS) {
      const normal = faceNormalVec(face).transformDirection(this.cubeGroup.matrixWorld).normalize();
      const center = faceNormalVec(face).multiplyScalar(1.5 * TOTAL).applyMatrix4(this.cubeGroup.matrixWorld);
      dots[face] = normal.dot(center.sub(camera).normalize());
    }
    return dots;
  }

  private updateForceLayer() {
    if (this.isBusy() || !this.cube.force.isReady() || performance.now() - this.forceTick < 80) return;
    this.forceTick = performance.now();
    try {
      const wasArmed = this.cube.force.isArmed();
      const state = this.cube.force.evaluate(this.cube.getState(), this.computeFaceDots());
      if (state) this.cube.commitHiddenState(state);
      if (wasArmed && !this.cube.force.isArmed()) this.onForceActiveChange?.(false);
    } catch (error) {
      this.cube.force.clear();
      this.onError?.(error instanceof Error ? error.message : 'Force sa nepodarilo vyhodnotiť.');
    }
  }

  private handleMoveExecuted(move: MoveType) {
    this.onUserMove?.(move);
    // Solver moves never re-arm a force or count as spectator mixing.
    if (this.running) return;
    this.cube.force.noteTurn();
  }

  destroy() {
    this.destroyed = true;
    this.cancelOperation();
    this.cube.destroy();
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
